import {
  getLocalSettings,
  SorterClient,
  type SorterHealth,
  type Store,
  smartSort,
} from "@duet/core";
import { signal } from "@lit-labs/signals";
import type { SyncService } from "./sync.ts";

export type SorterState =
  | { state: "off" }
  | { state: "checking" }
  | { state: "away"; message: string }
  | { state: "ready"; health: SorterHealth };

/**
 * The Mac mini's sorting models, from this Mac: which are ready, and a pass over the rows still
 * unsure after each upload. When the Mac mini is away, the rules and our history still sort,
 * and the rest waits for it.
 */
export class SortingService {
  readonly sorter = signal<SorterState>({ state: "off" });
  readonly running = signal(false);
  /** Rows still unsure because a model wasn't there to ask. */
  readonly waiting = signal(0);

  constructor(
    private readonly store: Store,
    private readonly sync: SyncService,
  ) {}

  /** Our own setting, else the relay's address with /sort (where tailscale serve puts it). */
  async url(): Promise<string | null> {
    const settings = await getLocalSettings(this.store);
    if (settings.sorterUrl) return settings.sorterUrl;
    const relay = this.sync.relayUrl.get();
    return relay ? `${relay}/sort` : null;
  }

  async check(): Promise<void> {
    const url = await this.url();
    if (!url) {
      this.sorter.set({ state: "off" });
      return;
    }
    this.sorter.set({ state: "checking" });
    try {
      this.sorter.set({ state: "ready", health: await new SorterClient(url).health() });
    } catch (error) {
      this.sorter.set({
        state: "away",
        message: error instanceof Error ? error.message : "Can't reach the sorting service.",
      });
    }
  }

  /** One pass over a file's unsure rows (or every open row). Quiet: rows just get better. */
  async run(fileId?: string): Promise<void> {
    const url = await this.url();
    if (!url || this.running.get()) return;
    this.running.set(true);
    try {
      const result = await smartSort(this.store, new SorterClient(url), { fileId });
      this.waiting.set(result.waiting);
    } catch (error) {
      console.warn("Smart sorting didn't finish:", error);
    } finally {
      this.running.set(false);
    }
  }
}
