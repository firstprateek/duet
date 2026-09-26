import {
  addByHand,
  buildHistory,
  categoryPath,
  dayLabel,
  formatMoney,
  getRules,
  listTransactions,
  monthName,
  monthOf,
  parseCents,
  parseQuickAdd,
  type QuickAddResult,
  type Share,
  suggest,
  type Transaction,
  today,
  weekdayLabel,
  words,
} from "@duet/core";
import { tint } from "@duet/ui";
import { css, html, nothing } from "lit";
import { Screen } from "../app/screen.ts";

interface Resolved {
  amount: number | null;
  merchant: string | null;
  categoryId: string | null;
  date: string;
  share: Share;
  accountId: string | null;
  from: { amount: boolean; merchant: boolean; category: boolean; date: boolean; share: boolean };
}

/** Quick add (⌘K): one sentence becomes one entry. Fields filled in for you are dashed. */
export class QuickAdd extends Screen {
  static override properties = {
    ...Screen.properties,
    text: { state: true },
    details: { state: true },
    overrides: { state: true },
    recent: { state: true },
    history: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      du-sheet {
        --sheet-width: 680px;
        --sheet-top: 92px;
        --sheet-pad: 26px 28px 24px;
      }
      .sheet-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .top h1 {
        font-weight: 500;
        font-size: 21px;
      }
      .top span {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .sentence {
        width: 100%;
        border: 2px solid var(--du-ours);
        outline: none;
        background: var(--du-bg);
        border-radius: 18px;
        padding: 16px 20px;
        font-family: var(--du-font-display);
        font-size: 23px;
        color: var(--du-ink);
      }
      .got {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 800;
        color: var(--du-muted);
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px 10px;
      }
      .f {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      .f > span {
        font-size: 11.5px;
        font-weight: 800;
        color: var(--du-muted);
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .bub {
        align-self: flex-start;
        max-width: 100%;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 999px;
        padding: 6px 13px;
        font-size: 14px;
        font-weight: 800;
        border: 1.5px solid transparent;
        color: var(--du-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bub.filled {
        background: var(--du-card);
        border: 1.5px dashed #b9afc8;
        color: var(--du-ink-2);
      }
      .bub.missing {
        background: var(--du-card);
        border: 1.5px dashed var(--du-ours);
        color: var(--du-link);
      }
      .bub.amount {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 16px;
      }
      .mark {
        display: flex;
      }
      .mark i {
        width: 14px;
        height: 14px;
        border-radius: 50%;
      }
      .mark i + i {
        margin-left: -5px;
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 18px;
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .legend i {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        box-sizing: border-box;
      }
      .try {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--du-muted);
        line-height: 1.5;
      }
      .try b {
        color: var(--du-ink);
        font-weight: 800;
      }
      .foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 4px;
      }
      .edit {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .edit select,
      .edit input {
        width: 100%;
        border: 0;
        background: var(--du-bg);
        border-radius: 12px;
        padding: 9px 10px;
        font-size: 13.5px;
        font-weight: 700;
      }
      .recent {
        margin-top: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-radius: 26px;
      }
      .recent .row {
        display: flex;
        align-items: center;
        gap: 12px;
        height: 34px;
        font-size: 14px;
        font-weight: 700;
      }
      .recent .row .m {
        flex-grow: 1;
      }
      .recent .amt {
        width: 80px;
        text-align: right;
        font-family: var(--du-font-display);
        font-weight: 500;
      }
    `,
  ];

  declare text: string;
  declare details: boolean;
  declare overrides: Partial<Resolved>;
  declare recent: Transaction[];
  declare history: ReturnType<typeof buildHistory> | null;
  private rules: Awaited<ReturnType<typeof getRules>> = [];

  constructor() {
    super();
    this.text = "";
    this.details = false;
    this.overrides = {};
    this.recent = [];
    this.history = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    const all = await listTransactions(this.app.store, {});
    this.recent = all.filter((t) => t.source === "hand").slice(0, 3);
    this.history = buildHistory(
      all.map((t) => ({
        description: t.description ?? t.merchant,
        categoryId: t.categoryId,
        share: t.share,
      })),
    );
    this.rules = await getRules(this.app.store);
  }

  private resolve(): Resolved {
    const b = this.basics;
    const parsed: QuickAddResult = parseQuickAdd(this.text, {
      today: today(),
      categories: b.categories,
    });
    let categoryId = parsed.categoryId;
    let share: Share | null = parsed.share;
    const fromCategory = parsed.fromWords.category;
    if (parsed.merchant && this.history) {
      const s = suggest(
        { description: parsed.merchant, merchant: parsed.merchant, accountDefault: "ours" },
        { rules: this.rules, history: this.history, categories: b.categories },
      );
      if (!categoryId && s.categoryId) categoryId = s.categoryId;
      if (!share) share = s.share;
    }
    const cash = b.accounts.find((a) => a.kind === "cash" && a.ownerId === b.me?.id);
    const accountId =
      b.settings.lastPaidWith && b.accounts.some((a) => a.id === b.settings.lastPaidWith)
        ? b.settings.lastPaidWith
        : (cash?.id ?? null);
    const o = this.overrides;
    return {
      amount: o.amount !== undefined ? o.amount : parsed.amount,
      merchant: o.merchant !== undefined ? o.merchant : parsed.merchant,
      categoryId: o.categoryId !== undefined ? o.categoryId : categoryId,
      date: o.date ?? parsed.date,
      share: o.share ?? share ?? "ours",
      accountId: o.accountId !== undefined ? o.accountId : accountId,
      from: {
        amount: parsed.fromWords.amount || o.amount !== undefined,
        merchant: parsed.fromWords.merchant || o.merchant !== undefined,
        category: fromCategory || o.categoryId !== undefined,
        date: parsed.fromWords.date || o.date !== undefined,
        share: parsed.fromWords.share || o.share !== undefined,
      },
    };
  }

  override render() {
    const b = this.basics;
    const r = this.resolve();
    const category = r.categoryId ? b.categoriesById.get(r.categoryId) : undefined;
    const account = b.accounts.find((a) => a.id === r.accountId);
    const complete = r.amount !== null && !!r.merchant;
    const filledCount = [
      r.amount !== null,
      !!r.merchant,
      !!r.categoryId,
      true,
      true,
      !!r.accountId,
    ].filter(Boolean).length;
    const month = monthOf(r.date);
    return html`
      <du-sheet label=${words.quickAdd} @close=${this.close}>
        <div class="sheet-body">
          <div class="top"><h1>Add something</h1><span>esc to close</span></div>
          <label>
            <span class="sr-only">Describe an expense</span>
            <input
              class="sentence"
              autofocus
              .value=${this.text}
              placeholder="42.18 trader joes groceries yesterday"
              @input=${(e: Event) => {
                this.text = (e.target as HTMLInputElement).value;
                this.overrides = {};
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void this.add();
                }
              }}
            />
          </label>
          ${
            this.text.trim()
              ? html`
                <div class="got">
                  <span>Here's what I got</span>
                  ${
                    complete && filledCount === 6
                      ? html`<span class="pill good" style="font-size:12.5px;padding:4px 11px"><du-icon name="check" size="12" stroke="3.2"></du-icon>All six filled in</span>`
                      : complete
                        ? html`<span class="pill warn" style="font-size:12.5px;padding:4px 11px">${filledCount} of six filled in</span>`
                        : html`<span class="pill ours" style="font-size:12.5px;padding:4px 11px">${r.amount === null ? "How much was it?" : "What was it?"}</span>`
                  }
                </div>
                <div class="fields">
                  ${this.field("Amount", r.amount !== null ? formatMoney(r.amount, { cents: true }) : "Needed", r.amount === null ? "missing" : r.from.amount ? "" : "filled", "var(--du-peach-bg)", null, "amount")}
                  ${this.field("Merchant", r.merchant ?? "Needed", r.merchant ? (r.from.merchant ? "" : "filled") : "missing", "var(--du-butter-bg)", "bag")}
                  ${this.field("Category", category ? categoryPath(category.id, b.categories) : "Pick one", r.from.category ? "" : "filled", category?.bubble ?? "var(--du-soft)", null)}
                  ${this.field("When", weekdayLabel(r.date), r.from.date ? "" : "filled", "var(--du-sky-bg)", "calendar")}
                  <div class="f">
                    <span>For</span>
                    <span class="bub ${r.from.share ? "" : "filled"}" style=${r.from.share ? `background:${r.share === "ours" ? "var(--du-ours-bg)" : "var(--du-mine-bg)"}` : ""}>
                      ${
                        r.share === "ours"
                          ? html`<span class="mark"><i style="background:${b.first!.color}"></i><i style="background:${b.second!.color}"></i></span>${words.ours}`
                          : html`${words.mine}`
                      }
                    </span>
                  </div>
                  ${this.field("Paid with", account ? `${account.name} · ${this.app.nameOf(account.ownerId)}` : "Pick one", "filled", "", null)}
                </div>
                <div class="legend">
                  <span><i style="background:var(--du-butter-bg)"></i>From your words</span>
                  <span><i style="border:1.5px dashed #B9AFC8"></i>Filled in for you · change any below</span>
                </div>
                ${this.details ? this.renderEdit(r) : nothing}
              `
              : html`<p class="try">
                Try “<b>mine 18 sweetgreen lunch</b>” or “<b>ours 64 dinner friday</b>”.
              </p>`
          }
          <div class="foot">
            <button class="linkish" @click=${() => (this.details = !this.details)}>${this.details ? "Fewer details" : "More details"}</button>
            <button class="btn" ?disabled=${!complete} @click=${this.add}>${words.addTo(month)}<span style="font-family:var(--du-font-display);font-weight:500;opacity:0.8">↵</span></button>
          </div>
          ${
            this.recent.length
              ? html`<div class="recent dotted-top" style="padding-top:12px">
                <div style="font-size:13px;font-weight:800;color:var(--du-muted)">Added by hand lately</div>
                ${this.recent.map((t) => {
                  const c = t.categoryId ? b.categoriesById.get(t.categoryId) : undefined;
                  return html`<div class="row">
                    <du-bubble .icon=${c?.icon ?? "dots"} .color=${c?.bubble ?? "var(--du-soft)"} size="28"></du-bubble>
                    <span class="m">${t.merchant} <span class="muted" style="font-weight:600">· ${dayLabel(t.date)}</span></span>
                    <span class="pill ${t.share}" style="font-size:12px;padding:3px 10px">${t.share === "ours" ? words.ours : words.mine}</span>
                    <span class="amt">${formatMoney(t.amount, { cents: true })}</span>
                  </div>`;
                })}
              </div>`
              : nothing
          }
        </div>
      </du-sheet>
    `;
  }

  private field(
    label: string,
    value: string,
    state: "" | "filled" | "missing",
    bg: string,
    icon: string | null,
    extra = "",
  ) {
    const style = state === "" ? `background:${tint(bg)}` : "";
    return html`<div class="f">
      <span>${label}</span>
      <span class="bub ${state} ${extra}" style=${style}>${icon ? html`<du-icon .name=${icon} size="15" stroke="2"></du-icon>` : nothing}${value}</span>
    </div>`;
  }

  private renderEdit(r: Resolved) {
    const b = this.basics;
    const set = (patch: Partial<Resolved>) => (this.overrides = { ...this.overrides, ...patch });
    const leaf = b.categories.filter((c) => c.parentId && !c.archived);
    return html`<div class="edit">
      <label class="field">Amount<input inputmode="decimal" .value=${r.amount !== null ? (r.amount / 100).toFixed(2) : ""} @change=${(e: Event) => set({ amount: parseCents((e.target as HTMLInputElement).value) })} /></label>
      <label class="field">Merchant<input .value=${r.merchant ?? ""} @change=${(e: Event) => set({ merchant: (e.target as HTMLInputElement).value || null })} /></label>
      <label class="field">Category
        <select .value=${r.categoryId ?? ""} @change=${(e: Event) => set({ categoryId: (e.target as HTMLSelectElement).value || null })}>
          <option value="">Pick one</option>
          ${leaf.map((c) => html`<option value=${c.id} ?selected=${c.id === r.categoryId}>${categoryPath(c.id, b.categories)}</option>`)}
        </select>
      </label>
      <label class="field">When<input type="date" .value=${r.date} @change=${(e: Event) => set({ date: (e.target as HTMLInputElement).value })} /></label>
      <label class="field">For
        <select .value=${r.share} @change=${(e: Event) => set({ share: (e.target as HTMLSelectElement).value as Share })}>
          <option value="ours">${words.ours}</option>
          <option value="mine">${words.mine}</option>
        </select>
      </label>
      <label class="field">Paid with
        <select .value=${r.accountId ?? ""} @change=${(e: Event) => set({ accountId: (e.target as HTMLSelectElement).value || null })}>
          ${b.accounts.filter((a) => !a.archived).map((a) => html`<option value=${a.id} ?selected=${a.id === r.accountId}>${a.name} · ${this.app.nameOf(a.ownerId)}</option>`)}
        </select>
      </label>
    </div>`;
  }

  private add = async () => {
    const r = this.resolve();
    if (r.amount === null || !r.merchant) return;
    const b = this.basics;
    const account = b.accounts.find((a) => a.id === r.accountId);
    await addByHand(this.app.store, {
      amount: r.amount,
      merchant: r.merchant,
      date: r.date,
      categoryId: r.categoryId,
      share: r.share,
      accountId: r.accountId,
      paidBy: account?.ownerId ?? b.me!.id,
    });
    this.app.toast(`Added ${r.merchant} to ${monthName(monthOf(r.date))}.`);
    this.close();
  };

  private close = () => {
    this.app.quickAdd.set(false);
  };
}

customElements.define("du-quick-add", QuickAdd);
