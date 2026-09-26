import {
  type ChangeRecord,
  categoryPath,
  dayLabel,
  deleteTransaction,
  editTransaction,
  entityFor,
  formatMoney,
  getTransaction,
  parseCents,
  switchShare,
  type Transaction,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

type HistoryEntry = ChangeRecord & { deviceId: string };

/** One transaction: change its category, who it was for, or the note, and see its history. */
export class TransactionSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    transactionId: { type: String },
    tx: { state: true },
    history: { state: true },
    confirmRemove: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    css`
      select {
        border: 0;
        background: var(--du-bg);
        border-radius: 12px;
        padding: 9px 10px;
        font-size: 13.5px;
        font-weight: 700;
        width: 100%;
      }
      .amount {
        margin-left: auto;
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 26px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .history {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--du-ink-2);
      }
      .history div {
        display: flex;
        gap: 10px;
      }
      .history span:first-child {
        width: 60px;
        color: var(--du-muted);
        font-weight: 700;
      }
    `,
  ];

  declare transactionId: string;
  declare tx: Transaction | null;
  declare history: HistoryEntry[];
  declare confirmRemove: boolean;

  override connectedCallback(): void {
    super.connectedCallback();
    this.tx = null;
    this.history = [];
    this.confirmRemove = false;
    void this.load();
  }

  private async load() {
    this.tx = await getTransaction(this.app.store, this.transactionId);
    if (this.tx) this.history = await this.app.store.history(entityFor(this.tx.share), this.tx.id);
  }

  override render() {
    const t = this.tx;
    if (!t)
      return html`<du-sheet label="Transaction" @close=${() => this.app.closeSheet()}><p>This one is gone.</p></du-sheet>`;
    const b = this.basics;
    const c = t.categoryId ? b.categoriesById.get(t.categoryId) : undefined;
    const leaf = b.categories.filter((x) => x.parentId && (!x.archived || x.id === t.categoryId));
    const account = b.accounts.find((a) => a.id === t.accountId);
    const byHand = t.source === "hand";
    return html`<du-sheet label=${t.merchant} @close=${() => this.app.closeSheet()}>
      <div class="body">
        <div class="head">
          <du-bubble .icon=${c?.icon ?? "dots"} .color=${c?.bubble ?? "var(--du-soft)"} size="46"></du-bubble>
          <div style="min-width:0">
            <h1>${t.merchant}</h1>
            <div class="meta">${dayLabel(t.date)} · ${account?.name ?? "No account"} · ${this.app.nameOf(t.paidBy)}</div>
          </div>
          <span class="amount">${formatMoney(t.amount, { cents: true })}</span>
        </div>
        ${t.description && t.description !== t.merchant ? html`<div class="meta" style="background:var(--du-soft-2);border-radius:12px;padding:8px 12px">${t.description}</div>` : nothing}
        <div class="grid">
          <label class="field">Category
            <select .value=${t.categoryId ?? ""} @change=${(e: Event) => this.edit({ categoryId: (e.target as HTMLSelectElement).value || null })}>
              <option value="">No category</option>
              ${leaf.map((x) => html`<option value=${x.id} ?selected=${x.id === t.categoryId}>${categoryPath(x.id, b.categories)}</option>`)}
            </select>
          </label>
          <div class="group">
            <span class="group-label">Who was it for?</span>
            <div class="choices">
              <button type="button" class="choice" aria-pressed=${t.share === "ours" ? "true" : "false"} @click=${() => this.share("ours")}>${words.ours}</button>
              <button type="button" class="choice" aria-pressed=${t.share === "mine" ? "true" : "false"} @click=${() => this.share("mine")}>${words.mine}</button>
            </div>
          </div>
          ${
            byHand
              ? html`<label class="field">Amount<input class="input" inputmode="decimal" .value=${(t.amount / 100).toFixed(2)} @change=${(
                  e: Event,
                ) => {
                  const cents = parseCents((e.target as HTMLInputElement).value);
                  if (cents !== null) void this.edit({ amount: cents });
                }} /></label>
              <label class="field">When<input class="input" type="date" .value=${t.date} @change=${(e: Event) => this.edit({ date: (e.target as HTMLInputElement).value })} /></label>`
              : nothing
          }
        </div>
        <label class="field">A little note<input class="input" .value=${t.note ?? ""} placeholder="Anything to remember?" @change=${(e: Event) => this.edit({ note: (e.target as HTMLInputElement).value || null })} /></label>
        ${
          this.history.length
            ? html`<div class="group">
              <span class="group-label">History</span>
              <div class="history">${this.history.map((h, i) => html`<div><span>${dayLabel(h.hlc.slice(0, 10))}</span><span>${this.describe(h, i === 0)}</span></div>`)}</div>
            </div>`
            : nothing
        }
        <div class="foot">
          ${
            this.confirmRemove
              ? html`<span style="display:flex;gap:10px;align-items:center;font-weight:700">Remove it from the month?
                <button class="btn small" @click=${this.removeTransaction}>Remove</button>
                <button class="btn soft small" @click=${() => (this.confirmRemove = false)}>Keep it</button></span>`
              : html`<button class="linkish muted" @click=${() => (this.confirmRemove = true)}>Remove</button>`
          }
          <button class="btn" @click=${() => this.app.closeSheet()}>Done</button>
        </div>
      </div>
    </du-sheet>`;
  }

  private describe(h: HistoryEntry, isFirst: boolean): string {
    const who = this.app.nameOf(h.memberId) || "Someone";
    const b = this.basics;
    if (isFirst && h.fields.addedAt) return `${who} added it`;
    const parts: string[] = [];
    if (h.fields.categoryId !== undefined) {
      const name =
        typeof h.fields.categoryId === "string"
          ? (b.categoriesById.get(h.fields.categoryId)?.name ?? "a category")
          : "no category";
      parts.push(`the category to ${name}`);
    }
    if (h.fields.amount !== undefined)
      parts.push(`the amount to ${formatMoney(Number(h.fields.amount), { cents: true })}`);
    if (h.fields.date !== undefined) parts.push(`the date to ${dayLabel(String(h.fields.date))}`);
    if (h.fields.note !== undefined) parts.push(h.fields.note ? "the note" : "removed the note");
    if (h.fields.deletedAt === null && h.fields.addedAt) return `${who} moved it here`;
    return parts.length ? `${who} changed ${parts.join(", ")}` : `${who} made a change`;
  }

  private async edit(patch: Parameters<typeof editTransaction>[2]) {
    if (!this.tx) return;
    await editTransaction(this.app.store, this.tx, patch);
    await this.load();
  }

  private async share(to: "ours" | "mine") {
    if (!this.tx || this.tx.share === to) return;
    await switchShare(this.app.store, this.tx, to);
    await this.load();
  }

  private removeTransaction = async () => {
    if (!this.tx) return;
    await deleteTransaction(this.app.store, this.tx);
    this.app.toast(`Removed ${this.tx.merchant}.`);
    this.app.closeSheet();
  };
}

customElements.define("du-transaction-sheet", TransactionSheet);
