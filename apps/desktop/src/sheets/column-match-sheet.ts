import { beginImport, fileSha256, formatMoney, rememberForSetup } from "@duet/core";
import type { AccountKind, ColumnMapping, ParsedStatement } from "@duet/importers";
import { css, html, nothing } from "lit";
import type { Sheet } from "../app/app.ts";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

type ColumnSheet = Extract<Sheet, { kind: "column-match" }>;

function guess(headers: string[], words: string[]): number {
  const i = headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));
  return i;
}

/** An unfamiliar file: we point at the columns once, and it reads from then on. */
export class ColumnMatchSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    sheet: { attribute: false },
    mapping: { state: true },
    preview: { state: true },
    busy: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    css`
      du-sheet {
        --sheet-width: 760px;
      }
      table {
        border-collapse: collapse;
        font-size: 12.5px;
        width: 100%;
        table-layout: fixed;
      }
      th,
      td {
        text-align: left;
        padding: 6px 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      th {
        font-weight: 800;
        background: var(--du-soft);
      }
      th:first-child {
        border-radius: 10px 0 0 10px;
      }
      th:last-child {
        border-radius: 0 10px 10px 0;
      }
      td {
        color: var(--du-ink-2);
        font-weight: 600;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      select {
        border: 0;
        background: var(--du-bg);
        border-radius: 12px;
        padding: 9px 10px;
        font-size: 13.5px;
        font-weight: 700;
        width: 100%;
      }
      .preview {
        background: var(--du-bg);
        border-radius: 16px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        font-weight: 700;
      }
      .preview div {
        display: grid;
        grid-template-columns: 100px minmax(0, 1fr) 100px;
        gap: 10px;
      }
      .preview .amt {
        text-align: right;
        font-family: var(--du-font-display);
        font-weight: 500;
      }
    `,
  ];

  declare sheet: ColumnSheet;
  declare mapping: ColumnMapping;
  declare preview: ParsedStatement | null;
  declare busy: boolean;

  override connectedCallback(): void {
    super.connectedCallback();
    const p = this.sheet.file.parsed;
    const headers = p.headers;
    const date = Math.max(0, guess(headers, ["date", "posted"]));
    const description = Math.max(
      0,
      guess(headers, ["description", "merchant", "payee", "name", "memo", "what"]),
    );
    const debit = guess(headers, ["debit", "withdrawal"]);
    const credit = guess(headers, ["credit", "deposit"]);
    const amount = guess(headers, ["amount", "how much", "value"]);
    this.mapping = {
      headerRow: p.headerRow ?? 0,
      date,
      description,
      amount:
        debit >= 0 && credit >= 0 && amount < 0
          ? { debit, credit }
          : {
              column: Math.max(0, amount >= 0 ? amount : headers.length - 1),
              spendingIs: "positive",
            },
      accountKind:
        guess(headers, ["withdrawal", "deposit", "balance", "check"]) >= 0 ? "checking" : "credit",
    };
    const category = guess(headers, ["category", "kind", "type"]);
    if (category >= 0) this.mapping.bankCategory = category;
    this.preview = null;
    this.busy = false;
    void this.refreshPreview();
  }

  private async refreshPreview() {
    try {
      this.preview = await this.app.parse(this.sheet.file, { mapping: this.mapping });
    } catch {
      this.preview = null;
    }
  }

  private set(patch: Partial<ColumnMapping>) {
    this.mapping = { ...this.mapping, ...patch };
    void this.refreshPreview();
  }

  override render() {
    const file = this.sheet.file;
    const headers = file.parsed.headers;
    const sample = file.parsed.sample.slice(0, 3);
    const m = this.mapping;
    const split = "debit" in m.amount;
    const col = (
      value: number,
      onChange: (i: number) => void,
      label: string,
      optional = false,
    ) => html`<label class="field">${label}
      <select .value=${String(value)} @change=${(e: Event) => onChange(Number((e.target as HTMLSelectElement).value))}>
        ${optional ? html`<option value="-1" ?selected=${value < 0}>None</option>` : nothing}
        ${headers.map((h, i) => html`<option value=${i} ?selected=${i === value}>${h || `Column ${i + 1}`}</option>`)}
      </select>
    </label>`;
    const rows = this.preview?.rows.slice(0, 4) ?? [];
    return html`<du-sheet label="New layout" @close=${this.later}>
      <div class="body">
        <div class="head">
          <span class="badge" style="background:var(--du-butter-bg)"><du-icon name="file" size="22"></du-icon></span>
          <div>
            <h1>New layout · one quick setup</h1>
            <div class="meta">${file.name} · point at a few columns once, and Duet remembers</div>
          </div>
        </div>
        <table>
          <thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
          <tbody>${sample.map((r) => html`<tr>${headers.map((_, i) => html`<td>${r[i] ?? ""}</td>`)}</tr>`)}</tbody>
        </table>
        <div class="grid">
          ${col(m.date, (i) => this.set({ date: i }), "Date")}
          ${col(m.description, (i) => this.set({ description: i }), "Description")}
          ${col(m.bankCategory ?? -1, (i) => this.set({ bankCategory: i >= 0 ? i : undefined }), "Bank's category", true)}
        </div>
        <div class="group">
          <span class="group-label">Amounts</span>
          <div class="choices">
            <button type="button" class="choice" aria-pressed=${split ? "false" : "true"} @click=${() => this.set({ amount: { column: "column" in m.amount ? m.amount.column : m.amount.debit, spendingIs: "positive" } })}>One amount column</button>
            <button type="button" class="choice" aria-pressed=${split ? "true" : "false"} @click=${() => this.set({ amount: "debit" in m.amount ? m.amount : { debit: Math.max(0, guess(headers, ["debit", "withdrawal"])), credit: Math.max(0, guess(headers, ["credit", "deposit"])) } })}>Debit and credit columns</button>
          </div>
        </div>
        <div class="grid">
          ${
            "column" in m.amount
              ? html`${col(m.amount.column, (i) => this.set({ amount: { column: i, spendingIs: "column" in m.amount ? m.amount.spendingIs : "positive" } }), "Amount")}
                <label class="field">Spending shows as
                  <select .value=${m.amount.spendingIs} @change=${(e: Event) => this.set({ amount: { column: "column" in m.amount ? m.amount.column : 0, spendingIs: (e.target as HTMLSelectElement).value as "positive" | "negative" } })}>
                    <option value="positive">Positive numbers</option>
                    <option value="negative">Negative numbers</option>
                  </select>
                </label>`
              : html`${col(m.amount.debit, (i) => this.set({ amount: { ...(m.amount as { debit: number; credit: number }), debit: i } }), "Money out (debit)")}
                ${col(m.amount.credit, (i) => this.set({ amount: { ...(m.amount as { debit: number; credit: number }), credit: i } }), "Money in (credit)")}`
          }
          <label class="field">What kind of account
            <select .value=${m.accountKind} @change=${(e: Event) => this.set({ accountKind: (e.target as HTMLSelectElement).value as AccountKind })}>
              <option value="credit">Credit card</option>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </label>
        </div>
        ${
          rows.length
            ? html`<div class="preview">
              <span class="group-label" style="margin-bottom:4px">This is how the first rows read</span>
              ${rows.map((r) => html`<div><span>${r.date}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.description}</span><span class="amt">${formatMoney(r.amount, { cents: true })}</span></div>`)}
            </div>`
            : html`<div class="preview"><span>These columns don't read as dates and amounts yet.</span></div>`
        }
        <div class="foot">
          <button type="button" class="linkish" @click=${this.later}>Not now</button>
          <button class="btn" ?disabled=${!rows.length || this.busy} @click=${this.next}>Looks right<du-icon name="arrow-right" size="16" stroke="2.4"></du-icon></button>
        </div>
      </div>
    </du-sheet>`;
  }

  private later = async () => {
    const file = this.sheet.file;
    if (file.path) {
      await rememberForSetup(this.app.store, {
        fileName: file.name,
        sha256: await fileSha256(file.bytes),
        path: file.path,
        format: file.parsed.format,
        firstDate: file.parsed.firstDate,
        lastDate: file.parsed.lastDate,
        rowCount: file.parsed.dataRows ?? 0,
      });
    }
    this.app.closeSheet(undefined);
  };

  private next = async () => {
    if (!this.preview) return;
    this.busy = true;
    try {
      const file = { ...this.sheet.file, parsed: this.preview };
      const outcome = await beginImport(this.app.store, {
        fileName: file.name,
        bytes: file.bytes,
        parsed: file.parsed,
        path: file.path,
      });
      if (outcome.status === "new-account") {
        this.app.replaceSheet({
          kind: "new-account",
          file,
          suggestion: outcome.suggestion,
          mapping: this.mapping,
        });
      } else if (outcome.status === "ready") this.app.closeSheet(outcome.fileId);
      else this.app.closeSheet(undefined);
    } finally {
      this.busy = false;
    }
  };
}

customElements.define("du-column-match-sheet", ColumnMatchSheet);
