import {
  loadCredentials,
  NewerDataError,
  RelayError,
  SealedRecordError,
  type Store,
  SyncEngine,
} from "@duet/core";
import { signal } from "@lit-labs/signals";
import type { Platform } from "../platform/index.ts";

export type SyncStatus =
  | { state: "off" }
  | { state: "syncing"; lastAt: string | null }
  | { state: "ok"; lastAt: string }
  /** Can't reach the Mac mini: changes wait and go out later. */
  | { state: "offline"; lastAt: string | null; message: string }
  /** Won't sync until something changes (this Mac was removed, or Duet needs an update). */
  | { state: "stopped"; lastAt: string | null; message: string };

/** Entities that travel through the household log. */
const SHARED = new Set([
  "member",
  "sharePlan",
  "category",
  "account",
  "transaction",
  "mineTotal",
  "cleanSlate",
  "householdRule",
]);

function describe(error: unknown, lastAt: string | null): SyncStatus {
  if (error instanceof NewerDataError) {
    return {
      state: "stopped",
      lastAt,
      message: "The other Mac has a newer Duet. Update this one to keep in step.",
    };
  }
  if (error instanceof SealedRecordError) {
    return {
      state: "stopped",
      lastAt,
      message: "Some changes on the Mac mini don't open with our key.",
    };
  }
  if (error instanceof RelayError) {
    if (error.status === 401 || error.status === 426)
      return { state: "stopped", lastAt, message: error.message };
    return {
      state: "offline",
      lastAt,
      message: error.status === 0 ? "Can't reach the Mac mini right now." : error.message,
    };
  }
  return {
    state: "offline",
    lastAt,
    message: error instanceof Error ? error.message : "Sync didn't finish.",
  };
}

/**
 * Keeps this Mac in step with the other one: syncs when the app opens, soon after anything
 * shared changes, when the Mac mini says there is something new, on focus, when the network
 * comes back, and every 60 seconds while the app is open.
 */
export class SyncService {
  readonly status = signal<SyncStatus>({ state: "off" });
  readonly relayUrl = signal<string | null>(null);
  private engine: SyncEngine | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | null = null;
  private listening: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private retryMs = 2000;

  constructor(
    private readonly store: Store,
    private readonly platform: Platform,
  ) {}

  get client() {
    return this.engine?.client ?? null;
  }

  /** Starts syncing if this Mac is paired; otherwise the status stays "off". */
  async start(): Promise<void> {
    this.stop();
    const credentials = await loadCredentials(this.store, this.platform.secret);
    if (!credentials) {
      this.status.set({ state: "off" });
      this.relayUrl.set(null);
      return;
    }
    this.relayUrl.set(credentials.relayUrl);
    this.engine = new SyncEngine(this.store, credentials);
    const lastAt = (await this.store.getMeta(["syncLastAt"])).syncLastAt ?? null;
    this.status.set({ state: "syncing", lastAt });
    this.unsubscribe = this.store.onChange((entities) => {
      if ([...entities].some((e) => SHARED.has(e))) this.soon();
    });
    this.interval = setInterval(() => void this.syncNow(), 60_000);
    window.addEventListener("focus", this.wake);
    window.addEventListener("online", this.wake);
    void this.listen();
    await this.syncNow();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.interval = null;
    this.soonTimer = null;
    this.listening?.abort();
    this.listening = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener("focus", this.wake);
    window.removeEventListener("online", this.wake);
    this.engine = null;
  }

  private wake = () => void this.syncNow();

  private soon(): void {
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => void this.syncNow(), 1200);
  }

  private lastAt(): string | null {
    const s = this.status.get();
    return "lastAt" in s ? s.lastAt : null;
  }

  async syncNow(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const current = this.status.get();
    if (current.state === "stopped") return;
    if (current.state !== "ok") this.status.set({ state: "syncing", lastAt: this.lastAt() });
    try {
      await engine.sync();
      this.status.set({ state: "ok", lastAt: new Date().toISOString() });
    } catch (error) {
      console.warn("Sync didn't finish:", error);
      this.status.set(describe(error, this.lastAt()));
    }
  }

  /** "There is something new" from the Mac mini; reconnects with a growing pause when it drops. */
  private async listen(): Promise<void> {
    while (this.engine && this.status.get().state !== "stopped") {
      const engine = this.engine;
      const controller = new AbortController();
      this.listening = controller;
      try {
        await engine.client.listen(() => this.soon(), controller.signal);
        this.retryMs = 2000;
      } catch {
        // offline for now
      }
      if (controller.signal.aborted || this.engine !== engine) return;
      await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      this.retryMs = Math.min(this.retryMs * 2, 60_000);
    }
  }
}

/** "just now", "2 min ago", "3 h ago", "Sep 25" */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (seconds < 50) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
