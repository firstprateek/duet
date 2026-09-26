import { baseStyles } from "@duet/ui";
import { SignalWatcher } from "@lit-labs/signals";
import { type CSSResultGroup, LitElement } from "lit";
import type { App, Basics } from "./app.ts";

/** Screens and sheets get the app as a property and re-render when its signals change. */
export class Screen extends SignalWatcher(LitElement) {
  static override properties = { app: { attribute: false } };
  static override styles: CSSResultGroup = [baseStyles];
  declare app: App;

  get basics(): Basics {
    return this.app.basics.get()!;
  }
}
