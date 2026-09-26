import type { SqlDriver, SqlValue, Statement } from "@duet/core";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { PickedFile, Platform } from "./types.ts";

/**
 * The desktop app. SQLite lives in a real file in the app's data folder, reached through
 * three small Rust commands on one connection (so a batch is one real transaction).
 * Secrets go to the macOS keychain.
 */
class TauriDriver implements SqlDriver {
  all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return invoke<T[]>("db_all", { sql, params });
  }
  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    await invoke("db_run", { sql, params });
  }
  async batch(statements: Statement[]): Promise<void> {
    await invoke("db_batch", {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
  }
}

const STATEMENT_EXTENSIONS = ["csv", "xlsx", "xls", "ofx", "qfx", "qbo"];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function readAt(path: string): Promise<Uint8Array> {
  // The command answers with raw bytes (an ArrayBuffer), not a JSON list of numbers.
  const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>("read_statement_file", { path });
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function readPaths(paths: string[]): Promise<PickedFile[]> {
  const files: PickedFile[] = [];
  for (const path of paths) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!STATEMENT_EXTENSIONS.includes(ext)) continue;
    files.push({ name: baseName(path), bytes: await readAt(path), path });
  }
  return files;
}

export async function createTauriPlatform(): Promise<Platform> {
  await invoke("db_open");
  return {
    kind: "tauri",
    db: new TauriDriver(),
    async pickFiles() {
      const chosen = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "Statements", extensions: STATEMENT_EXTENSIONS }],
      });
      if (!chosen) return [];
      return readPaths(Array.isArray(chosen) ? chosen : [chosen]);
    },
    onFileDrop(handler) {
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (event.payload.type === "drop") handler(await readPaths(event.payload.paths));
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
    readFileAt: readAt,
    secret: {
      get: (key) => invoke<string | null>("secret_get", { key }),
      set: async (key, value) => {
        await invoke("secret_set", { key, value });
      },
      delete: async (key) => {
        await invoke("secret_delete", { key });
      },
    },
    appVersion: () => getVersion(),
    async checkForUpdate() {
      // The latest GitHub release; the updater checks its signature before installing.
      const update = await check();
      if (!update) return null;
      return {
        version: update.version,
        notes: update.body ?? null,
        async install() {
          await update.downloadAndInstall();
          await relaunch();
        },
      };
    },
    onJoinCode(handler) {
      const take = (urls: string[] | null) => {
        for (const url of urls ?? []) {
          const code = url.match(/DUET1-[A-Za-z0-9_-]+/)?.[0];
          if (url.startsWith("duet://join") && code) handler(code);
        }
      };
      let unlisten: (() => void) | null = null;
      let stopped = false;
      // A link can open Duet, or arrive while it's already open.
      void getCurrent().then(take, () => {});
      void onOpenUrl(take).then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      });
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
  };
}
