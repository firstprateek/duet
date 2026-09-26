import {
  type Account,
  activeMonths,
  type Category,
  countToSort,
  currentMonth,
  getAccounts,
  getCategories,
  getLocalSettings,
  getMembers,
  isSetUp,
  type LocalSettings,
  type Member,
  type MonthKey,
  type NewAccountSuggestion,
  type Store,
} from "@duet/core";
import type { ColumnMapping, ParsedStatement, ReadOptions } from "@duet/importers";
import { signal } from "@lit-labs/signals";
import type { PickedFile, Platform } from "../platform/index.ts";
import { parseHash, type Route, toHash } from "./router.ts";
import { SortingService } from "./sorting.ts";
import { SyncService } from "./sync.ts";

/** The demo on the website: Jack and Jill's year, with sync switched off. */
const DEMO = import.meta.env.MODE === "demo";

export interface Basics {
  setUp: boolean;
  members: Member[];
  me: Member | null;
  partner: Member | null;
  first: Member | null;
  second: Member | null;
  names: Record<string, string>;
  categories: Category[];
  categoriesById: Map<string, Category>;
  accounts: Account[];
  settings: LocalSettings;
  toSort: number;
  /** The month "This month" opens on: the latest with statements, else the calendar month. */
  latestMonth: MonthKey;
}

export interface PendingFile extends PickedFile {
  parsed: ParsedStatement;
}

export type Sheet =
  | {
      kind: "new-account";
      file: PendingFile;
      suggestion: NewAccountSuggestion;
      /** Set when the columns were matched by hand: saved as a profile with the account. */
      mapping?: ColumnMapping;
    }
  | { kind: "column-match"; file: PendingFile }
  | {
      kind: "clean-slate";
      appliesTo: MonthKey | "overall";
      amount: number | null;
      from: string | null;
    }
  | { kind: "rhythm" }
  | { kind: "transaction"; id: string }
  | { kind: "add-account" }
  | { kind: "message"; title: string; body: string }
  | { kind: "sync-setup" }
  /** A recovery phrase shown once, then three of its words checked; `next` opens after. */
  | { kind: "phrase"; phrase: string; next?: Sheet }
  | { kind: "join-code" }
  | { kind: "devices" };

export interface Toast {
  id: number;
  text: string;
}

/**
 * Everything the screens share: the store, the platform, where we are, and a few things
 * nearly every screen reads (members, categories, accounts, settings).
 */
export class App extends EventTarget {
  readonly route = signal<Route>(parseHash(location.hash));
  readonly sheet = signal<Sheet | null>(null);
  readonly quickAdd = signal(false);
  readonly basics = signal<Basics | null>(null);
  readonly version = signal(0);
  readonly toasts = signal<Toast[]>([]);
  /** A join code from a duet://join link, waiting for the setup screen. */
  readonly joinCode = signal<string | null>(null);
  readonly queue: PickedFile[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private worker: Worker | null = null;
  private nextParse = 1;
  private parses = new Map<
    number,
    { resolve: (p: ParsedStatement) => void; reject: (e: Error) => void }
  >();

  readonly sync: SyncService;
  readonly sorting: SortingService;

  constructor(
    readonly store: Store,
    readonly platform: Platform,
  ) {
    super();
    this.sync = new SyncService(store, platform);
    this.sorting = new SortingService(store, this.sync);
    store.onChange(() => this.changed());
    window.addEventListener("hashchange", () => this.route.set(parseHash(location.hash)));
  }

  /** Something in the database changed: screens reload, basics refresh soon after. */
  changed(): void {
    this.version.set(this.version.get() + 1);
    this.dispatchEvent(new Event("changed"));
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 30);
  }

  async refresh(): Promise<Basics> {
    const [setUp, members, categories, accounts, settings, toSort, months] = await Promise.all([
      isSetUp(this.store),
      getMembers(this.store),
      getCategories(this.store, true),
      getAccounts(this.store, true),
      getLocalSettings(this.store),
      countToSort(this.store),
      activeMonths(this.store),
    ]);
    const me = members.find((m) => m.id === this.store.memberId) ?? null;
    const partner = members.find((m) => m.id !== this.store.memberId) ?? null;
    const now = currentMonth();
    const latest = [...months].reverse().find((m) => m <= now) ?? now;
    const basics: Basics = {
      setUp,
      members,
      me,
      partner,
      first: members.find((m) => m.position === 0) ?? null,
      second: members.find((m) => m.position === 1) ?? null,
      names: Object.fromEntries(members.map((m) => [m.id, m.name])),
      categories,
      categoriesById: new Map(categories.map((c) => [c.id, c])),
      accounts,
      settings,
      toSort,
      latestMonth: latest,
    };
    this.basics.set(basics);
    applyTheme(settings.appearance);
    return basics;
  }

  navigate(route: Route, replace = false): void {
    const hash = toHash(route);
    if (replace) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    this.route.set(route);
  }

  private sheetDone: ((result: unknown) => void) | null = null;

  openSheet(sheet: Sheet): void {
    if (
      DEMO &&
      (sheet.kind === "sync-setup" || sheet.kind === "join-code" || sheet.kind === "devices")
    ) {
      this.toast("Sync needs the Duet app and a Mac mini, so it's off in the demo.");
      return;
    }
    this.sheetDone?.(undefined);
    this.sheetDone = null;
    this.sheet.set(sheet);
  }

  /** Opens a sheet and waits for it to close; resolves with what the sheet reported. */
  openSheetAndWait<T = unknown>(sheet: Sheet): Promise<T | undefined> {
    this.openSheet(sheet);
    return new Promise((resolve) => {
      this.sheetDone = resolve as (result: unknown) => void;
    });
  }

  /** Swaps to the next step of the same flow; whoever waits on the first sheet keeps waiting. */
  replaceSheet(sheet: Sheet): void {
    this.sheet.set(sheet);
  }

  closeSheet(result?: unknown): void {
    const done = this.sheetDone;
    this.sheetDone = null;
    this.sheet.set(null);
    done?.(result);
  }

  toast(text: string): void {
    const toast = { id: Date.now() + Math.random(), text };
    this.toasts.set([...this.toasts.get(), toast]);
    setTimeout(() => this.toasts.set(this.toasts.get().filter((t) => t.id !== toast.id)), 4200);
  }

  /** Reads a statement in a worker. */
  parse(file: PickedFile, options?: ReadOptions): Promise<ParsedStatement> {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/parse-worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (
        e: MessageEvent<{ id: number; parsed?: ParsedStatement; error?: string }>,
      ) => {
        const pending = this.parses.get(e.data.id);
        if (!pending) return;
        this.parses.delete(e.data.id);
        if (e.data.parsed) pending.resolve(e.data.parsed);
        else pending.reject(new Error(e.data.error ?? "Couldn't read that file."));
      };
    }
    const id = this.nextParse++;
    return new Promise((resolve, reject) => {
      this.parses.set(id, { resolve, reject });
      this.worker!.postMessage({ id, bytes: file.bytes, name: file.name, options });
    });
  }

  /** A join link opened Duet. Only a Mac that isn't set up yet can use it. */
  receiveJoinCode(code: string): void {
    if (this.basics.get()?.setUp) {
      this.toast(
        "This Mac already has our household. Join links are for a Mac that's new to Duet.",
      );
      return;
    }
    this.joinCode.set(code);
  }

  /** Both of our names, for avatars that must tell us apart. */
  get pair(): string[] {
    return this.basics.get()?.members.map((m) => m.name) ?? [];
  }

  nameOf(memberId: string | null | undefined): string {
    if (!memberId) return "";
    return this.basics.get()?.names[memberId] ?? "";
  }

  colorOf(memberId: string | null | undefined): string {
    const m = this.basics.get()?.members.find((x) => x.id === memberId);
    return m?.color ?? "#C9C0D3";
  }
}

export function applyTheme(appearance: LocalSettings["appearance"]): void {
  const root = document.documentElement;
  if (appearance === "auto") delete root.dataset.theme;
  else root.dataset.theme = appearance;
}
