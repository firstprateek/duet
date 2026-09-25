import type { Platform } from "./types.ts";

export type { PickedFile, Platform, UpdateInfo } from "./types.ts";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createPlatform(): Promise<Platform> {
  if (isTauri()) {
    const { createTauriPlatform } = await import("./tauri.ts");
    return createTauriPlatform();
  }
  const { createWebPlatform } = await import("./web.ts");
  return createWebPlatform();
}
