import {
  addMonths,
  type CleanSlate,
  dayLabel,
  formatMoney,
  getCleanSlates,
  listTransactions,
  type MonthKey,
  monthName,
  type Transaction,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

interface TxData {
  rows: Transaction[];
  slates: CleanSlate[];
}

/** Everything added, with Clean slates, filters and when each was added. */
export class TransactionsScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    month: { type: String },
    categoryId: { type: String },
    share: { state: true },
    search: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 6px 32px 24px;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 16px;
        min-height: 44px;
      }
      .title h1 {
        flex-grow: 1;
      }
      .filters {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .filters select,
      .filters input {
        border: 0;
        background: var(--du-card);
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 13.5px;
        font-weight: 700;
        box-shadow: var(--du-shadow-small);
      }
      .filters input {
        min-width: 220px;
      }
      du-segmented {
        --seg-bg: var(--du-card);
        --seg-shadow: var(--du-shadow-small);
      }
      .list {
        padding: 14px 16px;
      }
      .row {
        display: grid;
        grid-template-columns: 32px 60px minmax(0, 1fr) 170px 110px 110px 120px;
        column-gap: 12px;
        align-items: center;
        height: 48px;
        padding: 0 10px;
        border-radius: 14px;
        width: 100%;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .row:hover {
        background: var(--du-bg);
      }
      .date {
        font-size: 12px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .merchant {
        font-size: 14.5px;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .note {
        font-size: 11.5px;
        color: var(--du-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cat {
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .amount {
        text-align: right;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 16px;
      }
      .added {
        font-size: 12px;
        font-weight: 600;
        color: var(--du-muted);
        text-align: right;
      }
      .chip {
        display: inline-flex;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 800;
      }
      .slate {
        background: var(--du-good-bg);
        color: var(--du-good-fg);
      }
      .total {
        display: flex;
        justify-content: flex-end;
        gap: 18px;
        padding: 10px 20px 0;
        font-size: 13.5px;
        font-weight: 800;
      }
      .empty {
        padding: 30px;
        font-weight: 600;
        color: var(--du-muted);
      }
    `,
  ];

  declare month: MonthKey | null;
  declare categoryId: string | null;
  declare share: "all" | "ours" | "mine";
  declare search: string;

  private data = new Loader<TxData>(
    this,
    () => this.app,
    async () => {
      const [rows, slates] = await Promise.all([
        listTransactions(this.app.store, {
          month: this.month,
          categoryId: this.categoryId,
          share: this.share,
          search: this.search || null,
        }),
        getCleanSlates(this.app.store),
      ]);
      return { rows, slates };
    },
    () => `${this.month}|${this.categoryId}|${this.share}|${this.search}`,
  );

  constructor() {
    super();
    this.month = null;
    this.categoryId = null;
    this.share = "all";
    this.search = "";
  }

  override render() {
    const v = this.data.value;
    const b = this.basics;
    const months = Array.from({ length: 18 }, (_, i) => addMonths(b.latestMonth, -i));
    const tops = b.categories.filter((c) => !c.parentId);
    const slates = (v?.slates ?? []).filter(
      (s) => !this.month || s.date.startsWith(this.month) || s.appliesTo === this.month,
    );
    const showSlates = !this.categoryId && this.share !== "mine" && !this.search;
    type Item = { kind: "tx"; tx: Transaction } | { kind: "slate"; slate: CleanSlate };
    const items: Item[] = [
      ...(v?.rows ?? []).map((tx) => ({ kind: "tx" as const, tx })),
      ...(showSlates ? slates.map((slate) => ({ kind: "slate" as const, slate })) : []),
    ].sort((a, c) => {
      const da = a.kind === "tx" ? a.tx.date : a.slate.date;
      const dc = c.kind === "tx" ? c.tx.date : c.slate.date;
      return da < dc ? 1 : da > dc ? -1 : 0;
    });
    const ours = (v?.rows ?? [])
      .filter((t) => t.share === "ours")
      .reduce((s, t) => s + t.amount, 0);
    const mine = (v?.rows ?? [])
      .filter((t) => t.share === "mine")
      .reduce((s, t) => s + t.amount, 0);
    return html`
      <div class="title">
        <h1>${words.transactions}${this.month ? html` <span class="muted" style="font-weight:500">· ${monthName(this.month, true)}</span>` : nothing}</h1>
      </div>
      <div class="filters">
        <select aria-label="Month" .value=${this.month ?? ""} @change=${(e: Event) => this.go({ month: (e.target as HTMLSelectElement).value || null })}>
          <option value="">Every month</option>
          ${months.map((m) => html`<option value=${m} ?selected=${m === this.month}>${monthName(m, true)}</option>`)}
        </select>
        <select aria-label="Category" .value=${this.categoryId ?? ""} @change=${(e: Event) => this.go({ categoryId: (e.target as HTMLSelectElement).value || null })}>
          <option value="">Every category</option>
          ${tops.map(
            (
              t,
            ) => html`<option value=${t.id} ?selected=${t.id === this.categoryId}>${t.name}</option>
              ${b.categories.filter((c) => c.parentId === t.id).map((c) => html`<option value=${c.id} ?selected=${c.id === this.categoryId}>  ${c.name}</option>`)}`,
          )}
        </select>
        <du-segmented
          label="Who it was for"
          .options=${[
            { value: "all", label: "Everything" },
            { value: "ours", label: words.ours },
            { value: "mine", label: words.mine },
          ]}
          .value=${this.share}
          @change=${(e: CustomEvent<{ value: "all" | "ours" | "mine" }>) => (this.share = e.detail.value)}
        ></du-segmented>
        <input type="search" placeholder="Search merchants and notes" .value=${this.search} @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)} />
      </div>
      <section class="card list">
        ${items.length === 0 ? html`<div class="empty">Nothing here yet.</div>` : nothing}
        ${items.map((item) => (item.kind === "tx" ? this.renderTx(item.tx) : this.renderSlate(item.slate)))}
        ${
          items.length
            ? html`<div class="total dotted-top">
              <span>${words.ours} ${formatMoney(ours, { cents: true })}</span>
              ${mine ? html`<span>${words.mine} ${formatMoney(mine, { cents: true })}</span>` : nothing}
            </div>`
            : nothing
        }
      </section>
    `;
  }

  private renderTx(t: Transaction) {
    const b = this.basics;
    const c = t.categoryId ? b.categoriesById.get(t.categoryId) : undefined;
    const account = b.accounts.find((a) => a.id === t.accountId);
    return html`<button class="row" @click=${() => this.app.openSheet({ kind: "transaction", id: t.id })}>
      <du-bubble .icon=${c?.icon ?? "dots"} .color=${c?.bubble ?? "var(--du-soft)"} size="30"></du-bubble>
      <span class="date">${dayLabel(t.date)}</span>
      <span style="display:flex;flex-direction:column;min-width:0">
        <span class="merchant">${t.merchant}</span>
        <span class="note">${t.note ?? account?.name ?? ""}</span>
      </span>
      <span class="cat">${c?.name ?? "No category"}</span>
      <span>${t.share === "ours" ? html`<span class="chip pill ours">${words.ours}</span>` : html`<span class="chip pill mine">${words.mine}</span>`}</span>
      <span class="amount">${formatMoney(t.amount, { cents: true })}</span>
      <span class="added">added ${dayLabel(t.addedAt.slice(0, 10))}</span>
    </button>`;
  }

  private renderSlate(s: CleanSlate) {
    return html`<div class="row" style="cursor:default">
      <du-bubble icon="check" color="var(--du-good-bg)" size="30"></du-bubble>
      <span class="date">${dayLabel(s.date)}</span>
      <span class="merchant">${words.cleanSlate} · ${this.app.nameOf(s.fromMember)} to ${this.app.nameOf(s.toMember)}</span>
      <span class="cat">${s.appliesTo === "overall" ? "Everything so far" : `For ${monthName(s.appliesTo)}`}</span>
      <span><span class="chip slate">${words.ebbFlow}</span></span>
      <span class="amount">${formatMoney(s.amount, { cents: true })}</span>
      <span class="added">added ${dayLabel(s.addedAt.slice(0, 10))}</span>
    </div>`;
  }

  private go(change: { month?: string | null; categoryId?: string | null }) {
    this.app.navigate({
      name: "transactions",
      month: change.month !== undefined ? change.month : this.month,
      categoryId: change.categoryId !== undefined ? change.categoryId : this.categoryId,
    });
  }
}

customElements.define("du-transactions-screen", TransactionsScreen);
