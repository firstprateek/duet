import type { SqlDriver } from "@duet/core";

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Where the file lives on disk (Tauri only). Kept so it can be re-read later. */
  path: string | null;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  install(): Promise<void>;
}

/** What the app needs from where it runs: the desktop (Tauri) or a browser preview. */
export interface Platform {
  kind: "tauri" | "web";
  db: SqlDriver;
  pickFiles(): Promise<PickedFile[]>;
  /** Calls back with files dropped on the window. Returns an unsubscribe function. */
  onFileDrop(handler: (files: PickedFile[]) => void): () => void;
  readFileAt(path: string): Promise<Uint8Array>;
  secret: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  appVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateInfo | null>;
  /** Calls back with the join code in a duet://join link that opened Duet. Returns an unsubscribe function. */
  onJoinCode(handler: (code: string) => void): () => void;
}
