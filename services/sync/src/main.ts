import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backupName, backupsToRemove } from "./backup.ts";
import { Relay, type RelayDb, type SqlParam } from "./relay.ts";

/**
 * duet-sync: the relay on the Mac mini, compiled into one binary with `bun build --compile`.
 *
 *   duet-sync serve            listen on 127.0.0.1:8787 (published over HTTPS by tailscale serve)
 *   duet-sync backup [folder]  copy the database and keep 30 daily + 12 monthly copies
 *   duet-sync version
 *
 * DUET_DATA is where the database lives (default ~/.duet-sync), and its app folder holds what
 * the relay hands to our Macs at /app; DUET_PORT and DUET_HOST change where it listens.
 */

const VERSION = "0.1.0";
const dataDir = process.env.DUET_DATA ?? join(process.env.HOME ?? ".", ".duet-sync");

function open(): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "relay.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return db;
}

function adapter(db: Database): RelayDb {
  return {
    all: <T>(sql: string, ...params: SqlParam[]) => db.query(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SqlParam[]) =>
      (db.query(sql).get(...params) ?? undefined) as T | undefined,
    run: (sql: string, ...params: SqlParam[]) => ({
      changes: db.query(sql).run(...params).changes,
    }),
    exec: (sql: string) => db.exec(sql),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

const [command = "serve", ...args] = process.argv.slice(2);

if (command === "serve") {
  const relay = new Relay({
    db: adapter(open()),
    version: VERSION,
    appFile: async (name) => {
      const file = Bun.file(join(dataDir, "app", name));
      return (await file.exists()) ? file : null;
    },
  });
  const server = Bun.serve({
    hostname: process.env.DUET_HOST ?? "127.0.0.1",
    port: Number(process.env.DUET_PORT ?? 8787),
    // Event streams stay open; they send a keep-alive every 25 seconds.
    idleTimeout: 120,
    fetch: (request) => relay.handle(request),
  });
  console.log(`duet-sync ${VERSION} is listening on ${server.url} (data in ${dataDir})`);
} else if (command === "backup") {
  const folder = args[0] ?? join(dataDir, "backups");
  mkdirSync(folder, { recursive: true });
  const target = join(folder, backupName(new Date()));
  rmSync(target, { force: true });
  open().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const removed = backupsToRemove(readdirSync(folder), new Date());
  for (const name of removed) rmSync(join(folder, name), { force: true });
  console.log(
    `Backed up to ${target}${removed.length ? `; removed ${removed.length} older copies` : ""}.`,
  );
} else if (command === "version") {
  console.log(VERSION);
} else {
  console.error("Usage: duet-sync [serve | backup [folder] | version]");
  process.exit(1);
}
