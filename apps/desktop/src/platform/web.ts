import type { SqlDriver, SqlValue, Statement } from "@duet/core";
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { sampleFiles } from "../demo/files.ts";
import type { PickedFile, Platform } from "./types.ts";

/**
 * The browser preview: the same app on an in-memory SQLite (sql.js), with sample data.
 * Used for development and screenshots; nothing is stored between reloads.
 */
class SqlJsDriver implements SqlDriver {
  constructor(private readonly db: Database) {}

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    this.db.run(sql, params);
  }

  async batch(statements: Statement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const s of statements) this.db.run(s.sql, s.params ?? []);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

async function readFiles(list: FileList | File[]): Promise<PickedFile[]> {
  const files = Array.from(list);
  return Promise.all(
    files.map(async (f) => ({
      name: f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
      path: null,
    })),
  );
}

export async function createWebPlatform(): Promise<Platform> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SqlJsDriver(new SQL.Database());
  const secrets = new Map<string, string>();
  return {
    kind: "web",
    db,
    pickFiles() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".csv,.xlsx,.xls,.ofx,.qfx,.qbo";
        input.addEventListener("change", async () =>
          resolve(input.files ? await readFiles(input.files) : []),
        );
        input.addEventListener("cancel", () => resolve([]));
        input.click();
      });
    },
    onFileDrop(handler) {
      const over = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      };
      const drop = async (e: DragEvent) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        handler(await readFiles(e.dataTransfer.files));
      };
      window.addEventListener("dragover", over);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("drop", drop);
      };
    },
    async readFileAt(path) {
      const bytes = sampleFiles.get(path);
      if (bytes) return bytes;
      throw new Error("Files can't be re-read in the browser preview.");
    },
    secret: {
      async get(key) {
        return secrets.get(key) ?? null;
      },
      async set(key, value) {
        secrets.set(key, value);
      },
      async delete(key) {
        secrets.delete(key);
      },
    },
    async appVersion() {
      return `${import.meta.env.VITE_APP_VERSION ?? "0.1.0"} (preview)`;
    },
    async checkForUpdate() {
      return null;
    },
  };
}
