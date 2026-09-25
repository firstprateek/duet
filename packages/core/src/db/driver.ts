/**
 * The one thing core needs from a database. The desktop app talks to SQLite through a small
 * Rust command, tests and the CLI use node:sqlite, and the web preview uses sql.js. All three
 * run the same SQL.
 */
export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDriver {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  /** Runs every statement in one transaction: all of them apply, or none. */
  batch(statements: Statement[]): Promise<void>;
}

/** Placeholders for an IN (...) list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
