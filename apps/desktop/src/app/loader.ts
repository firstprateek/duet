import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { App } from "./app.ts";

/**
 * Loads a screen's data and reloads it when the database changes or when `key` changes
 * (a different month, a different file).
 */
export class Loader<T> implements ReactiveController {
  value: T | undefined;
  error: Error | null = null;
  loading = false;
  private currentKey: string | null = null;
  private run = 0;
  private readonly onChanged = () => void this.load();

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly app: () => App | undefined,
    private readonly fn: () => Promise<T>,
    private readonly key: () => string = () => "",
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.app()?.addEventListener("changed", this.onChanged);
  }

  hostDisconnected(): void {
    this.app()?.removeEventListener("changed", this.onChanged);
  }

  hostUpdate(): void {
    const k = this.key();
    if (k !== this.currentKey) {
      this.currentKey = k;
      void this.load();
    }
  }

  async load(): Promise<void> {
    if (!this.app()) return;
    const run = ++this.run;
    this.loading = true;
    try {
      const value = await this.fn();
      if (run !== this.run) return;
      this.value = value;
      this.error = null;
    } catch (error) {
      if (run !== this.run) return;
      this.error = error instanceof Error ? error : new Error(String(error));
      console.error(error);
    } finally {
      if (run === this.run) {
        this.loading = false;
        this.host.requestUpdate();
      }
    }
  }
}
