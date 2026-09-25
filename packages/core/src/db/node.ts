import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue, Statement } from "./driver.ts";

/** SQLite through Node's built-in node:sqlite, for tests and the CLI. */
export class NodeSqliteDriver implements SqlDriver {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async batch(statements: Statement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const s of statements) this.db.prepare(s.sql).run(...(s.params ?? []));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
