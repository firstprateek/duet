import {
  type Account,
  addRule,
  categoryPath,
  type Decision,
  type Draft,
  dayLabel,
  decide,
  deleteRule,
  formatMoney,
  getDrafts,
  getFile,
  getFiles,
  levelOf,
  makeCleanSlateFromDraft,
  monthName,
  monthOf,
  type Rule,
  type StatementFile,
  setDraftCategory,
  setDraftNote,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

type Filter = "all" | "needs" | "duplicates" | "payments" | "transfers" | "refunds";

interface SortData {
  file: StatementFile | null;
  drafts: Draft[];
  files: StatementFile[];
}

/** To sort: one statement, row by row. Keyboard first: O, M, Delete, J / K, Shift, ⌘Enter. */
export class SortScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    fileId: { type: String },
    filter: { state: true },
    focusId: { state: true },
    selected: { state: true },
    alwaysRule: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 790fr) minmax(0, 408fr);
        gap: 18px;
        padding: 6px 32px 24px;
        height: calc(100vh - 76px);
        box-sizing: border-box;
        outline: none;
      }
      .list {
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
      }
      .head h1 {
        font-size: 24px;
        line-height: 1.1;
      }
      .sub {
        font-size: 13px;
        font-weight: 600;
        color: var(--du-muted);
      }
      .mini {
        color: var(--du-link);
        font-weight: 800;
      }
      .progress {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13.5px;
        font-weight: 800;
        white-space: nowrap;
      }
      .bar {
        width: 180px;
        height: 10px;
        background: var(--du-soft);
        border-radius: 999px;
        overflow: hidden;
      }
      .bar div {
        height: 10px;
        border-radius: 999px;
        background: var(--du-ours);
      }
      .filters {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      .filters .needs[aria-pressed="false"] {
        background: var(--du-ours-bg);
        color: var(--du-ours-fg);
      }
      .rows {
        margin-top: 10px;
        overflow-y: auto;
        flex-grow: 1;
        min-height: 0;
        padding-right: 4px;
      }
      .row {
        display: grid;
        grid-template-columns: 32px 52px minmax(0, 1fr) 150px 92px 118px;
        column-gap: 12px;
        align-items: center;
        width: 100%;
        height: 44px;
        margin-bottom: 2px;
        padding: 0 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .row.unsure {
        background: var(--du-unsure-bg);
      }
      .row.selected {
        background: var(--du-select-bg);
      }
      .row.focused {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--du-first) 45%, transparent);
      }
      .row.added {
        opacity: 0.55;
      }
      .date {
        font-size: 12px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .who {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .merchant {
        font-size: 14.5px;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .raw,
      .flag {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .raw {
        font-size: 11.5px;
        color: var(--du-muted);
      }
      .flag {
        font-size: 12px;
        font-weight: 700;
        color: var(--du-link);
      }
      .cat {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 13px;
        font-weight: 700;
      }
      .cat span:first-child {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .conf {
        font-size: 11.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .conf.unsure {
        color: var(--du-link);
      }
      .amount {
        text-align: right;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 16px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 800;
        white-space: nowrap;
      }
      .chip.ours {
        background: var(--du-ours-bg);
        color: var(--du-ours-fg);
      }
      .chip.mine {
        background: var(--du-mine-bg);
        color: var(--du-mine-fg);
      }
      .chip.aside {
        background: var(--du-aside-bg);
        color: var(--du-aside-fg);
      }
      .chip.pending {
        color: var(--du-muted);
        border: 1.5px dashed var(--du-dash-2);
        font-style: italic;
      }
      .foot {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 12px;
      }
      .keys {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .panel {
        padding: 24px 24px 22px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        min-height: 0;
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .panel-head .title {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 26px;
        line-height: 1.1;
      }
      .panel-head .amt {
        margin-left: auto;
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 26px;
        white-space: nowrap;
      }
      .rawbox {
        font-size: 12px;
        color: var(--du-muted);
        background: var(--du-soft-2);
        border-radius: 12px;
        padding: 8px 12px;
        word-break: break-all;
      }
      .label {
        font-size: 13px;
        font-weight: 800;
        color: var(--du-muted);
        margin-top: 4px;
      }
      .alts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .alt {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        background: var(--du-card);
        color: var(--du-ink);
        border: 2px solid var(--du-line);
      }
      .alt[aria-pressed="true"] {
        background: var(--du-ink);
        color: var(--du-on-ink);
        border-color: var(--du-ink);
      }
      .alt span {
        font-weight: 700;
        opacity: 0.75;
      }
      select.other {
        border: 2px solid var(--du-line);
        background: var(--du-card);
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 13px;
        font-weight: 800;
      }
      .why {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.5;
        background: var(--du-bg);
        border-radius: 16px;
        padding: 12px 14px;
      }
      .shares {
        display: flex;
        gap: 8px;
      }
      .share {
        flex: 1 1 0;
        max-width: 160px;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 10px 4px;
        border-radius: 18px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 800;
        background: var(--du-bg);
        color: var(--du-ink);
        border: 2px solid var(--du-bg);
      }
      .share[aria-pressed="true"] {
        background: var(--du-ink);
        color: var(--du-on-ink);
        border-color: var(--du-ink);
      }
      .share span {
        font-family: var(--du-font-display);
        font-size: 11.5px;
        font-weight: 500;
        opacity: 0.75;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13.5px;
        font-weight: 700;
      }
      .check input {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--du-ours);
      }
      .note {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12.5px;
        font-weight: 800;
        color: var(--du-muted);
      }
      .note input {
        font-weight: 600;
        font-size: 13.5px;
        color: var(--du-ink);
        background: var(--du-bg);
        border: 0;
        border-radius: 12px;
        padding: 10px 12px;
      }
      .leave {
        margin-top: auto;
        align-self: flex-start;
        text-decoration: underline;
      }
      .empty {
        grid-column: 1 / -1;
        padding: 40px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
        align-self: start;
      }
      .empty p {
        margin: 0;
        font-weight: 600;
        color: var(--du-ink-2);
        line-height: 1.5;
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: 560px;
      }
      .picker a {
        display: flex;
        justify-content: space-between;
        background: var(--du-bg);
        border-radius: 14px;
        padding: 12px 16px;
        text-decoration: none;
        color: var(--du-ink);
        font-weight: 800;
      }
    `,
  ];

  declare fileId: string | null;
  declare filter: Filter;
  declare focusId: string | null;
  declare selected: Set<string>;
  declare alwaysRule: { draftId: string; rule: Rule } | null;
  private anchorId: string | null = null;

  private data = new Loader<SortData>(
    this,
    () => this.app,
    async () => {
      const files = await getFiles(this.app.store);
      let id = this.fileId;
      if (!id)
        id = files.find((f) => f.pending > 0)?.id ?? files.find((f) => f.decided > 0)?.id ?? null;
      const file = id ? await getFile(this.app.store, id) : null;
      const drafts = file ? await getDrafts(this.app.store, file.id) : [];
      return { file, drafts, files };
    },
    () => this.fileId ?? "",
  );

  constructor() {
    super();
    this.filter = "all";
    this.focusId = null;
    this.selected = new Set();
    this.alwaysRule = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.tabIndex = 0;
    this.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.onKey);
  }

  override firstUpdated(): void {
    this.focus();
  }

  private get drafts(): Draft[] {
    return this.data.value?.drafts ?? [];
  }

  private visible(): Draft[] {
    const all = this.drafts;
    switch (this.filter) {
      case "needs":
        return all.filter((d) => this.needsYou(d));
      case "duplicates":
        return all.filter((d) => d.flags.duplicate);
      case "payments":
        return all.filter((d) => d.flags.cardPayment);
      case "transfers":
        return all.filter((d) => (d.flags.transfer || d.flags.deposit) && !d.flags.cardPayment);
      case "refunds":
        return all.filter((d) => d.flags.refund);
      default:
        return all;
    }
  }

  private needsYou(d: Draft): boolean {
    if (d.decision !== "pending") return false;
    return (
      !d.categoryId ||
      levelOf(d.confidence) === "unsure" ||
      d.flags.duplicate?.type === "near" ||
      !!d.flags.cleanSlateCandidate ||
      (d.flags.refund !== undefined && !d.flags.refund.of)
    );
  }

  private focused(): Draft | undefined {
    const rows = this.visible();
    return (
      rows.find((d) => d.id === this.focusId) ??
      rows.find((d) => d.decision === "pending") ??
      rows[0]
    );
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    if (!v.file) return this.renderEmpty(v.files);
    const b = this.basics;
    const account = b.accounts.find((a) => a.id === v.file!.accountId);
    const drafts = v.drafts;
    const total = drafts.length;
    const sorted = drafts.filter((d) => d.decision !== "pending").length;
    const readyToAdd = drafts.filter(
      (d) => (d.decision === "ours" || d.decision === "mine") && !d.addedAt,
    );
    const month = this.mainMonth(drafts);
    const rows = this.visible();
    const focus = this.focused();
    const counts = {
      needs: drafts.filter((d) => this.needsYou(d)).length,
      duplicates: drafts.filter((d) => d.flags.duplicate).length,
      payments: drafts.filter((d) => d.flags.cardPayment).length,
      transfers: drafts.filter((d) => (d.flags.transfer || d.flags.deposit) && !d.flags.cardPayment)
        .length,
      refunds: drafts.filter((d) => d.flags.refund).length,
    };
    const filter = (value: Filter, label: string, count: number, cls = "") =>
      count > 0 || value === "all"
        ? html`<button class="toggle ${cls}" aria-pressed=${this.filter === value ? "true" : "false"} @click=${() => (this.filter = value)}>${label} ${count}</button>`
        : nothing;
    const owner = account ? this.app.nameOf(account.ownerId) : "";
    return html`
      <section class="card list">
        <div class="head">
          <div>
            <h1>${account?.name ?? "Statement"} · ${monthName(month)}</h1>
            <div class="sub">
              ${owner} · ${total} transactions · ${v.file.fileName}${
                this.app.sorting.running.get()
                  ? html` · <span class="mini">Asking the Mac mini…</span>`
                  : this.app.sorting.waiting.get() > 0
                    ? html` · <span class="mini">${this.app.sorting.waiting.get()} waiting for the Mac mini</span>`
                    : nothing
              }
            </div>
          </div>
          <div class="progress">
            ${words.sortedOf(sorted, total)}
            <div class="bar"><div style="width:${total ? Math.round((sorted / total) * 100) : 0}%"></div></div>
          </div>
        </div>
        <div class="filters" role="group" aria-label="Show">
          ${filter("all", "All", total)}
          ${filter("needs", "Needs you", counts.needs, "needs")}
          ${filter("duplicates", "Duplicates", counts.duplicates)}
          ${filter("payments", "Card payments", counts.payments)}
          ${filter("transfers", "Transfers", counts.transfers)}
          ${filter("refunds", "Refunds", counts.refunds)}
        </div>
        <div class="rows" role="listbox" aria-label="Transactions" aria-multiselectable="true">
          ${rows.map((d) => this.renderRow(d, focus?.id === d.id))}
        </div>
        <div class="foot dotted-top">
          <div class="keys">
            <span><kbd>O</kbd> ${words.ours}</span>
            <span><kbd>M</kbd> ${words.mine}</span>
            <span><kbd>J</kbd> <kbd>K</kbd> move</span>
            <span><kbd>Delete</kbd> ${words.setAside.toLowerCase()}</span>
          </div>
          <button class="btn" ?disabled=${readyToAdd.length === 0} @click=${this.goAdd}>
            ${words.addTo(month, readyToAdd.length)}<du-icon name="arrow-right" size="16" stroke="2.4"></du-icon>
          </button>
        </div>
      </section>
      <aside class="card panel">${focus ? this.renderPanel(focus, account) : nothing}</aside>
    `;
  }

  private renderEmpty(files: StatementFile[]) {
    const waiting = files.filter((f) => f.decided > 0);
    return html`<section class="card empty">
      <h1>Nothing to sort</h1>
      <p>Everything uploaded has been sorted. Upload a statement and its rows land here.</p>
      ${
        waiting.length
          ? html`<div class="picker">
            ${waiting.map((f) => html`<a href="#/sort/${f.id}/add"><span>${f.fileName}</span><span>${f.decided} ready to add</span></a>`)}
          </div>`
          : nothing
      }
      <a class="btn" href="#/uploads">${words.upload}</a>
    </section>`;
  }

  private renderRow(d: Draft, isFocus: boolean) {
    const b = this.basics;
    const category = d.categoryId ? b.categoriesById.get(d.categoryId) : undefined;
    const aside = d.decision === "aside";
    const icon = d.flags.cardPayment
      ? "card"
      : d.flags.refund
        ? "back"
        : d.flags.cleanSlateCandidate
          ? "swap"
          : (category?.icon ?? "dots");
    const bubble = aside ? "var(--du-aside-bg)" : (category?.bubble ?? "var(--du-soft)");
    const flag = this.flagText(d);
    const unsure =
      d.decision === "pending" && (levelOf(d.confidence) === "unsure" || !d.categoryId);
    const classes = [
      "row",
      unsure ? "unsure" : "",
      this.selected.has(d.id) ? "selected" : "",
      isFocus ? "focused" : "",
      d.addedAt ? "added" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`<button
      class=${classes}
      role="option"
      aria-selected=${this.selected.has(d.id) || isFocus ? "true" : "false"}
      data-id=${d.id}
      @click=${(e: MouseEvent) => this.pick(d.id, e.shiftKey, e.metaKey || e.ctrlKey)}
    >
      <du-bubble .icon=${icon} .color=${bubble} size="30"></du-bubble>
      <span class="date">${dayLabel(d.date)}</span>
      <span class="who">
        <span class="merchant">${d.merchant}</span>
        ${flag ? html`<span class="flag">${flag}</span>` : html`<span class="raw">${d.description}</span>`}
      </span>
      <span class="cat">
        <span>${aside ? this.asideCategory(d) : (category?.name ?? "No category yet")}</span>
        ${aside ? nothing : html`<span class="conf ${unsure ? "unsure" : ""}">${this.confidenceLabel(d)}</span>`}
      </span>
      <span class="amount">${formatMoney(d.amount, { cents: true })}</span>
      <span>${this.chip(d)}</span>
    </button>`;
  }

  private asideCategory(d: Draft): string {
    if (d.flags.cardPayment) return "Card payment";
    if (d.flags.cleanSlateId) return words.cleanSlate;
    if (d.flags.deposit) return "Money in";
    if (d.flags.transfer) return "Transfer";
    if (d.flags.duplicate) return "Duplicate";
    return words.setAside;
  }

  private chip(d: Draft) {
    if (d.decision === "ours")
      return html`<span class="chip ours">${words.ours}${d.addedAt ? " ✓" : ""}</span>`;
    if (d.decision === "mine")
      return html`<span class="chip mine">${words.mine}${d.addedAt ? " ✓" : ""}</span>`;
    if (d.decision === "aside") return html`<span class="chip aside">${words.setAside}</span>`;
    const s = d.suggestedShare;
    return html`<span class="chip pending">${s ? `${s === "ours" ? words.ours : words.mine}?` : "?"}</span>`;
  }

  private confidenceLabel(d: Draft): string {
    switch (d.tier) {
      case "rule":
        return "rule";
      case "refund":
        return "refund";
      case "none":
      case "you":
        return "";
      default:
        return `${Math.round(d.confidence * 100)}%`;
    }
  }

  private flagText(d: Draft): string | null {
    const partner = this.basics.partner?.name ?? "your partner";
    if (d.flags.cleanSlateId) return "Recorded as a Clean slate";
    if (d.flags.cleanSlateCandidate) return `Money to ${partner}? It could be a Clean slate`;
    if (d.flags.duplicate?.type === "near") return "Might already be in an earlier file";
    if (d.flags.asideReason && d.decision === "aside") return d.flags.asideReason;
    if (d.flags.refund)
      return d.flags.refund.of
        ? `Refund of a ${dayLabel(d.flags.refund.ofDate ?? d.date)} purchase`
        : "A refund we couldn't match";
    return null;
  }

  private renderPanel(d: Draft, account: Account | undefined) {
    const b = this.basics;
    const multi = this.selected.size > 1;
    if (multi) return this.renderMultiPanel();
    const category = d.categoryId ? b.categoriesById.get(d.categoryId) : undefined;
    const alternatives = d.alternatives.filter((a) => b.categoriesById.has(a.categoryId));
    const pills = [...alternatives];
    if (d.categoryId && !pills.some((a) => a.categoryId === d.categoryId))
      pills.unshift({ categoryId: d.categoryId, confidence: d.confidence });
    const owner = account ? this.app.nameOf(account.ownerId) : "";
    const locked = !!d.addedAt;
    const leaf = b.categories.filter((c) => c.parentId && !c.archived);
    const always = this.alwaysRule?.draftId === d.id;
    return html`
      <div class="panel-head">
        <du-bubble .icon=${category?.icon ?? "dots"} .color=${category?.bubble ?? "var(--du-soft)"} size="46"></du-bubble>
        <div style="min-width:0">
          <div class="title">${d.merchant}</div>
          <div class="sub" style="font-weight:700">${dayLabel(d.date)} · ${account?.name ?? ""} · ${owner}</div>
        </div>
        <span class="amt">${formatMoney(d.amount, { cents: true })}</span>
      </div>
      <div class="rawbox">${d.description}</div>
      ${locked ? html`<p class="why">Added to ${monthName(monthOf(d.date))}. Change it in Transactions.</p>` : nothing}
      ${
        d.flags.cleanSlateCandidate && d.decision !== "aside"
          ? html`<p class="why">This looks like money moving between the two of you. Record it as a Clean slate, and it evens out Ebb & flow instead of counting as spending.</p>
            <div style="display:flex;gap:8px">
              <button class="btn" @click=${() => this.cleanSlate(d)}>Record as a ${words.cleanSlate}</button>
              <button class="btn soft" @click=${() => this.setDecision([d.id], "aside")}>${words.setAside}</button>
            </div>`
          : nothing
      }
      ${
        d.decision === "aside" && !d.flags.cleanSlateCandidate
          ? html`<p class="why">${d.flags.asideReason ?? "Set aside."} It stays on this Mac and never counts as spending.</p>`
          : nothing
      }
      ${
        !locked && d.decision !== "aside" && !d.flags.cleanSlateCandidate
          ? html`
            <div class="label">Which category?</div>
            <div class="alts">
              ${pills.map((a) => {
                const c = b.categoriesById.get(a.categoryId)!;
                const on = a.categoryId === d.categoryId;
                return html`<button class="alt" aria-pressed=${on ? "true" : "false"} @click=${() => this.setCategory([d.id], a.categoryId)}>
                  ${c.name}${d.tier !== "you" && a.confidence < 1 ? html`<span>${Math.round(a.confidence * 100)}%</span>` : nothing}
                </button>`;
              })}
              <select class="other" aria-label="Another category" @change=${(e: Event) => this.setCategory([d.id], (e.target as HTMLSelectElement).value)}>
                <option value="">Something else…</option>
                ${leaf.map((c) => html`<option value=${c.id} ?selected=${c.id === d.categoryId && !pills.some((p) => p.categoryId === c.id)}>${categoryPath(c.id, b.categories)}</option>`)}
              </select>
            </div>
            ${d.why ? html`<p class="why">${d.why}</p>` : nothing}
            <div class="label">Who was it for?</div>
            <div class="shares">
              ${(["ours", "mine"] as const).map(
                (
                  s,
                ) => html`<button class="share" aria-pressed=${d.decision === s ? "true" : "false"} @click=${() => this.setDecision([d.id], s)}>
                  ${s === "ours" ? words.ours : words.mine}<span>${s === "ours" ? "O" : "M"}</span>
                </button>`,
              )}
            </div>
            <label class="check"><input type="checkbox" .checked=${always} @change=${(e: Event) => this.toggleAlways(d, (e.target as HTMLInputElement).checked)} />Always treat ${d.merchant} this way</label>
            <label class="note">A little note<input type="text" placeholder="Anything to remember?" .value=${d.note ?? ""} @change=${(e: Event) => setDraftNote(this.app.store, d.id, (e.target as HTMLInputElement).value || null)} /></label>
            <button class="linkish muted leave" @click=${() => this.setDecision([d.id], "aside")}>Leave this one out</button>
          `
          : nothing
      }
      ${
        !locked && d.decision === "aside" && !d.flags.cleanSlateId
          ? html`<button class="linkish leave" @click=${() => this.setDecision([d.id], "pending")}>Bring it back</button>`
          : nothing
      }
    `;
  }

  private renderMultiPanel() {
    const b = this.basics;
    const ids = [...this.selected];
    const leaf = b.categories.filter((c) => c.parentId && !c.archived);
    return html`
      <div class="title" style="font-family:var(--du-font-display);font-weight:600;font-size:26px">${ids.length} selected</div>
      <p class="why">Anything you choose here applies to all ${ids.length}. Esc clears the selection.</p>
      <div class="label">Which category?</div>
      <select class="other" style="align-self:flex-start" @change=${(e: Event) => this.setCategory(ids, (e.target as HTMLSelectElement).value)}>
        <option value="">Pick a category…</option>
        ${leaf.map((c) => html`<option value=${c.id}>${categoryPath(c.id, b.categories)}</option>`)}
      </select>
      <div class="label">Who was it for?</div>
      <div class="shares">
        <button class="share" @click=${() => this.setDecision(ids, "ours")}>${words.ours}<span>O</span></button>
        <button class="share" @click=${() => this.setDecision(ids, "mine")}>${words.mine}<span>M</span></button>
      </div>
      <button class="linkish muted leave" @click=${() => this.setDecision(ids, "aside")}>Leave these out</button>
    `;
  }

  private mainMonth(drafts: Draft[]) {
    const counts = new Map<string, number>();
    for (const d of drafts) counts.set(monthOf(d.date), (counts.get(monthOf(d.date)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? this.basics.latestMonth;
  }

  private pick(id: string, shift: boolean, toggle: boolean) {
    const rows = this.visible();
    if (shift && this.anchorId) {
      const a = rows.findIndex((r) => r.id === this.anchorId);
      const b = rows.findIndex((r) => r.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.selected = new Set(rows.slice(lo, hi + 1).map((r) => r.id));
    } else if (toggle) {
      const next = new Set(this.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.selected = next;
      this.anchorId = id;
    } else {
      this.selected = new Set();
      this.anchorId = id;
    }
    this.focusId = id;
    this.focus();
  }

  private move(delta: number, extend: boolean) {
    const rows = this.visible();
    if (rows.length === 0) return;
    const current = this.focused();
    const index = Math.max(
      0,
      rows.findIndex((r) => r.id === current?.id),
    );
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))]!;
    if (extend) {
      if (!this.anchorId) this.anchorId = current?.id ?? next.id;
      this.pick(next.id, true, false);
    } else {
      this.selected = new Set();
      this.anchorId = next.id;
      this.focusId = next.id;
    }
    this.updateComplete.then(() =>
      this.renderRoot.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  }

  private targets(): string[] {
    if (this.selected.size > 0) return [...this.selected];
    const f = this.focused();
    return f && !f.addedAt ? [f.id] : [];
  }

  private async setDecision(ids: string[], decision: Decision) {
    if (ids.length === 0) return;
    const current = this.focused();
    await decide(this.app.store, ids, decision);
    if (decision !== "pending" && ids.length === 1 && current && ids[0] === current.id)
      this.advance(current.id);
    if (ids.length > 1) this.selected = new Set();
  }

  /** After a decision, move to the next row that still needs one. */
  private advance(fromId: string) {
    const rows = this.visible();
    const index = rows.findIndex((r) => r.id === fromId);
    const next =
      rows.slice(index + 1).find((r) => r.decision === "pending") ??
      rows.find((r) => r.decision === "pending" && r.id !== fromId);
    if (next) {
      this.focusId = next.id;
      this.updateComplete.then(() =>
        this.renderRoot
          .querySelector(`[data-id="${next.id}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
  }

  private async setCategory(ids: string[], categoryId: string) {
    if (!categoryId || ids.length === 0) return;
    await setDraftCategory(this.app.store, ids, categoryId);
    const rule = this.alwaysRule;
    if (rule && ids.includes(rule.draftId)) {
      await deleteRule(this.app.store, rule.rule);
      const d = this.drafts.find((x) => x.id === rule.draftId);
      if (d) await this.toggleAlways({ ...d, categoryId }, true);
    }
  }

  private async toggleAlways(d: Draft, on: boolean) {
    if (!on) {
      if (this.alwaysRule?.draftId === d.id) await deleteRule(this.app.store, this.alwaysRule.rule);
      this.alwaysRule = null;
      return;
    }
    const share = d.decision === "ours" || d.decision === "mine" ? d.decision : d.suggestedShare;
    const id = await addRule(this.app.store, {
      pattern: d.merchant,
      categoryId: d.categoryId,
      share,
    });
    this.alwaysRule = {
      draftId: d.id,
      rule: {
        id,
        match: "contains",
        pattern: d.merchant,
        categoryId: d.categoryId,
        share,
        scope: share === "mine" ? "personal" : "household",
      },
    };
    // Same merchant, same file: apply it now too.
    const same = this.drafts
      .filter((x) => x.id !== d.id && x.decision === "pending" && x.merchant === d.merchant)
      .map((x) => x.id);
    if (same.length && d.categoryId) await setDraftCategory(this.app.store, same, d.categoryId);
    if (same.length && share) await decide(this.app.store, same, share);
    this.app.toast(`Done. ${d.merchant} will be sorted this way from now on.`);
  }

  private async cleanSlate(d: Draft) {
    const applies =
      this.basics.settings.cleanSlateDefault === "overall" ? "overall" : monthOf(d.date);
    await makeCleanSlateFromDraft(this.app.store, d.id, applies);
    this.app.toast(
      `Recorded as a Clean slate for ${applies === "overall" ? "everything so far" : monthName(applies)}.`,
    );
    this.advance(d.id);
  }

  private goAdd = () => {
    const file = this.data.value?.file;
    if (file) this.app.navigate({ name: "add", fileId: file.id });
  };

  private onKey = (e: KeyboardEvent) => {
    const target = e.composedPath()[0] as HTMLElement | undefined;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")
    )
      return;
    if (this.app.sheet.get() || this.app.quickAdd.get()) return;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "enter") {
      e.preventDefault();
      this.goAdd();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (key) {
      case "j":
      case "arrowdown":
        e.preventDefault();
        this.move(1, e.shiftKey);
        break;
      case "k":
      case "arrowup":
        e.preventDefault();
        this.move(-1, e.shiftKey);
        break;
      case "o":
        e.preventDefault();
        void this.setDecision(this.targets(), "ours");
        break;
      case "m":
        e.preventDefault();
        void this.setDecision(this.targets(), "mine");
        break;
      case "delete":
      case "backspace":
        e.preventDefault();
        void this.setDecision(this.targets(), "aside");
        break;
      case "c":
        e.preventDefault();
        this.renderRoot.querySelector<HTMLSelectElement>("select.other")?.focus();
        break;
      case "escape":
        this.selected = new Set();
        break;
    }
  };
}

customElements.define("du-sort-screen", SortScreen);
