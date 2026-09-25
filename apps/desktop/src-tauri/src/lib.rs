//! The only Rust in Duet. Everything the app does lives in TypeScript (`packages/core`);
//! this shell gives it three things the webview can't do on its own:
//!
//! - SQLite in a real file, on one connection, so a batch is one real transaction
//!   (`db_open`, `db_all`, `db_run`, `db_batch`).
//! - Reading a statement file again later, by its path (`read_statement_file`).
//! - The macOS keychain for secrets (`secret_get`, `secret_set`, `secret_delete`).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Value as Json};
use tauri::{Manager, State};

/// The database connection, opened by `db_open` once the app knows where its data lives.
pub struct Db(Mutex<Option<Connection>>);

/// One statement in a batch, as the TypeScript `SqlDriver` sends it.
#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

const DATABASE_FILE: &str = "duet.db";
const KEYCHAIN_SERVICE: &str = "app.duet.desktop";
const STATEMENT_EXTENSIONS: [&str; 6] = ["csv", "xlsx", "xls", "ofx", "qfx", "qbo"];
const MAX_STATEMENT_BYTES: u64 = 50 * 1024 * 1024;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// A value from TypeScript: text, a number or null (booleans arrive as 0 and 1).
fn to_sql(value: &Json) -> Result<Value, String> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Bool(b) => Ok(Value::Integer(i64::from(*b))),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Value::Real(f))
            } else {
                Err(format!("Can't store the number {n}."))
            }
        }
        Json::String(s) => Ok(Value::Text(s.clone())),
        _ => Err("Only text, numbers and null can be stored.".into()),
    }
}

fn to_sql_all(values: &[Json]) -> Result<Vec<Value>, String> {
    values.iter().map(to_sql).collect()
}

fn from_sql(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::from(*x)).collect()),
    }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;",
    )
    .map_err(err)?;
    Ok(conn)
}

fn with_conn<T>(
    db: &Db,
    f: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = db.0.lock().map_err(err)?;
    let conn = guard.as_mut().ok_or("The database isn't open yet.")?;
    f(conn)
}

/// Rows as objects keyed by column name, the way `SqlDriver.all` returns them.
fn query(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(to_sql_all(params)?)).map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut object = Map::new();
        for (i, name) in names.iter().enumerate() {
            object.insert(name.clone(), from_sql(row.get_ref(i).map_err(err)?));
        }
        out.push(object);
    }
    Ok(out)
}

fn execute(conn: &Connection, sql: &str, params: &[Json]) -> Result<(), String> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    stmt.execute(params_from_iter(to_sql_all(params)?)).map_err(err)?;
    Ok(())
}

/// Every statement applies, or none does.
fn execute_batch(conn: &mut Connection, statements: &[Statement]) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    for s in statements {
        execute(&tx, &s.sql, &s.params)?;
    }
    tx.commit().map_err(err)
}

#[tauri::command]
async fn db_open(app: tauri::AppHandle, db: State<'_, Db>) -> Result<(), String> {
    let mut guard = db.0.lock().map_err(err)?;
    if guard.is_some() {
        return Ok(());
    }
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    *guard = Some(open_connection(&dir.join(DATABASE_FILE))?);
    Ok(())
}

#[tauri::command]
async fn db_all(
    db: State<'_, Db>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    with_conn(&db, |conn| query(conn, &sql, &params))
}

#[tauri::command]
async fn db_run(db: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<(), String> {
    with_conn(&db, |conn| execute(conn, &sql, &params))
}

#[tauri::command]
async fn db_batch(db: State<'_, Db>, statements: Vec<Statement>) -> Result<(), String> {
    with_conn(&db, |conn| execute_batch(conn, &statements))
}

/// A statement file, by path: only statement formats, and nothing unreasonably large.
fn read_statement(path: &Path) -> Result<Vec<u8>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !STATEMENT_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Duet only opens statement files: CSV, XLSX, OFX or QFX.".into());
    }
    let meta = std::fs::metadata(path).map_err(err)?;
    if !meta.is_file() {
        return Err("That isn't a file.".into());
    }
    if meta.len() > MAX_STATEMENT_BYTES {
        return Err("That file is too large to be a statement.".into());
    }
    std::fs::read(path).map_err(err)
}

#[tauri::command]
async fn read_statement_file(path: String) -> Result<tauri::ipc::Response, String> {
    read_statement(Path::new(&path)).map(tauri::ipc::Response::new)
}

fn keychain(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(err)
}

#[tauri::command]
async fn secret_get(key: String) -> Result<Option<String>, String> {
    match keychain(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn secret_set(key: String, value: String) -> Result<(), String> {
    keychain(&key)?.set_password(&value).map_err(err)
}

#[tauri::command]
async fn secret_delete(key: String) -> Result<(), String> {
    match keychain(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Db(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            db_open,
            db_all,
            db_run,
            db_batch,
            read_statement_file,
            secret_get,
            secret_set,
            secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("Duet couldn't start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn values_round_trip() {
        let mut conn = memory();
        execute(&conn, "CREATE TABLE t (id TEXT, n INTEGER, r REAL, b INTEGER, z TEXT)", &[]).unwrap();
        execute_batch(
            &mut conn,
            &[Statement {
                sql: "INSERT INTO t VALUES (?, ?, ?, ?, ?)".into(),
                params: vec![json!("a"), json!(784200), json!(0.93), json!(true), Json::Null],
            }],
        )
        .unwrap();
        let rows = query(&conn, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!("a"));
        assert_eq!(rows[0]["n"], json!(784200));
        assert_eq!(rows[0]["r"], json!(0.93));
        assert_eq!(rows[0]["b"], json!(1));
        assert_eq!(rows[0]["z"], Json::Null);
    }

    #[test]
    fn a_failed_batch_changes_nothing() {
        let mut conn = memory();
        execute(&conn, "CREATE TABLE t (id TEXT PRIMARY KEY)", &[]).unwrap();
        let result = execute_batch(
            &mut conn,
            &[
                Statement { sql: "INSERT INTO t VALUES ('x')".into(), params: vec![] },
                Statement { sql: "INSERT INTO t VALUES ('x')".into(), params: vec![] },
            ],
        );
        assert!(result.is_err());
        assert!(query(&conn, "SELECT * FROM t", &[]).unwrap().is_empty());
    }

    #[test]
    fn only_statement_files_are_read() {
        let dir = std::env::temp_dir();
        let note = dir.join("duet-test-note.txt");
        std::fs::write(&note, b"hello").unwrap();
        assert!(read_statement(&note).is_err());
        let csv = dir.join("duet-test-statement.CSV");
        std::fs::write(&csv, b"Date,Amount\n").unwrap();
        assert_eq!(read_statement(&csv).unwrap(), b"Date,Amount\n");
    }

    #[test]
    fn objects_and_lists_are_refused() {
        assert!(to_sql(&json!({"a": 1})).is_err());
        assert!(to_sql(&json!([1, 2])).is_err());
    }
}
