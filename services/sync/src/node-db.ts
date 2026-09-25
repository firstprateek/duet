import { DatabaseSync } from "node:sqlite";
import type { RelayDb, SqlParam } from "./relay.ts";

/** The relay's database through Node's node:sqlite, for tests and duet export. */
export function nodeRelayDb(path = ":memory:", options: { readOnly?: boolean } = {}): RelayDb {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  return {
    all: <T>(sql: string, ...params: SqlParam[]) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SqlParam[]) => db.prepare(sql).get(...params) as T | undefined,
    run: (sql: string, ...params: SqlParam[]) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
    exec: (sql: string) => db.exec(sql),
    transaction: <T>(fn: () => T): T => {
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
