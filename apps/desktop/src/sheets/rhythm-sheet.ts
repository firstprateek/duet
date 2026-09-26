import {
  addMonths,
  currentMonth,
  ebbAndFlow,
  getCleanSlates,
  getPair,
  getSharePlans,
  type MonthKey,
  monthName,
  oursEntries,
  rhythmFromSalaries,
  rhythmLabel,
  setRhythm,
  signedLabel,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

/** Changing Our rhythm, from a month onward, with a preview of how Ebb & flow would move. */
export class RhythmSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    pct: { state: true },
    from: { state: true },
    salaries: { state: true },
    preview: { state: true },
    busy: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    css`
      .rhythm {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      input[type="range"] {
        flex-grow: 1;
        accent-color: var(--du-ours);
      }
      .ratio {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 32px;
        min-width: 120px;
        text-align: right;
      }
      select {
        border: 0;
        background: var(--du-bg);
        border-radius: 12px;
        padding: 9px 10px;
        font-size: 13.5px;
        font-weight: 700;
      }
      .helper {
        background: var(--du-bg);
        border-radius: 18px;
        padding: 14px 16px;
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 10px;
        align-items: end;
      }
      .helper .input {
        background: var(--du-card);
      }
      .preview {
        background: var(--du-bg);
        border-radius: 16px;
        padding: 12px 14px;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.5;
      }
    `,
  ];

  declare pct: number;
  declare from: MonthKey;
  declare salaries: { first: string; second: string } | null;
  declare preview: { before: number; after: number } | null;
  declare busy: boolean;

  override connectedCallback(): void {
    super.connectedCallback();
    this.pct = 50;
    this.from = currentMonth();
    this.salaries = null;
    this.preview = null;
    this.busy = false;
    void this.init();
  }

  private async init() {
    const plans = await getSharePlans(this.app.store);
    const last = plans[plans.length - 1];
    if (last) this.pct = Math.round(last.firstBp / 100);
    await this.computePreview();
  }

  private async computePreview() {
    const store = this.app.store;
    const [plans, entries, slates, pair] = await Promise.all([
      getSharePlans(store),
      oursEntries(store),
      getCleanSlates(store),
      getPair(store),
    ]);
    const rhythm = plans.map((p) => ({ fromMonth: p.fromMonth, firstBp: p.firstBp }));
    const slateEntries = slates.map((s) => ({
      from: s.fromMember,
      to: s.toMember,
      amount: s.amount,
      date: s.date,
      appliesTo: s.appliesTo,
    }));
    const before = ebbAndFlow(entries, rhythm, slateEntries, pair).overall;
    const next = [
      ...rhythm.filter((p) => p.fromMonth !== this.from),
      { fromMonth: this.from, firstBp: this.pct * 100 },
    ];
    const after = ebbAndFlow(entries, next, slateEntries, pair).overall;
    this.preview = { before, after };
  }

  override render() {
    const b = this.basics;
    const first = b.first!;
    const second = b.second!;
    const months = Array.from({ length: 26 }, (_, i) => addMonths(currentMonth(), 1 - i));
    const pair = { first: first.id, second: second.id };
    return html`<du-sheet label=${words.ourRhythm} @close=${() => this.app.closeSheet()}>
      <form class="body" @submit=${this.save}>
        <div class="head">
          <div>
            <h1>${words.ourRhythm}</h1>
            <div class="meta">How we share what's ${words.ours}. It applies from a month onward.</div>
          </div>
        </div>
        <div class="rhythm">
          <span style="font-weight:800">${first.name}</span>
          <input type="range" min="1" max="99" .value=${String(this.pct)} aria-label=${words.ourRhythm} @input=${(
            e: Event,
          ) => {
            this.pct = Number((e.target as HTMLInputElement).value);
            void this.computePreview();
          }} />
          <span style="font-weight:800">${second.name}</span>
          <span class="ratio">${rhythmLabel(this.pct * 100)}</span>
        </div>
        <label class="field">Starting from
          <select .value=${this.from} @change=${(e: Event) => {
            this.from = (e.target as HTMLSelectElement).value;
            void this.computePreview();
          }}>
            ${months.map((m) => html`<option value=${m} ?selected=${m === this.from}>${monthName(m, true)}</option>`)}
          </select>
        </label>
        ${
          this.salaries
            ? html`<div class="helper">
              <label class="field">${first.name}<input class="input" inputmode="numeric" .value=${this.salaries.first} @input=${(e: Event) => (this.salaries = { ...this.salaries!, first: (e.target as HTMLInputElement).value })} /></label>
              <label class="field">${second.name}<input class="input" inputmode="numeric" .value=${this.salaries.second} @input=${(e: Event) => (this.salaries = { ...this.salaries!, second: (e.target as HTMLInputElement).value })} /></label>
              <button type="button" class="btn small" @click=${this.fromSalaries}>Use this</button>
            </div>`
            : html`<button type="button" class="linkish" style="align-self:flex-start" @click=${() => (this.salaries = { first: "", second: "" })}>Work it out from salaries</button>`
        }
        ${
          this.preview
            ? html`<div class="preview">
              ${
                this.preview.before === this.preview.after
                  ? html`${words.ebbFlow} stays where it is.`
                  : html`${words.ebbFlow} overall would go from <b>${signedLabel(this.preview.before, pair, b.names)}</b> to <b>${signedLabel(this.preview.after, pair, b.names)}</b>.`
              }
            </div>`
            : nothing
        }
        <div class="foot">
          <button type="button" class="linkish" @click=${() => this.app.closeSheet()}>${words.notNow}</button>
          <button class="btn" ?disabled=${this.busy}>Save ${rhythmLabel(this.pct * 100)}</button>
        </div>
      </form>
    </du-sheet>`;
  }

  private fromSalaries = () => {
    const a = Number((this.salaries?.first ?? "").replace(/[^0-9.]/g, ""));
    const c = Number((this.salaries?.second ?? "").replace(/[^0-9.]/g, ""));
    try {
      this.pct = rhythmFromSalaries(a, c) / 100;
      this.salaries = null;
      void this.computePreview();
    } catch {
      this.app.toast("Both salaries are needed. They're never saved.");
    }
  };

  private save = async (e: Event) => {
    e.preventDefault();
    this.busy = true;
    try {
      await setRhythm(this.app.store, { fromMonth: this.from, firstBp: this.pct * 100 });
      this.app.toast(
        `${words.ourRhythm} is ${rhythmLabel(this.pct * 100)} from ${monthName(this.from)}.`,
      );
      this.app.closeSheet();
    } finally {
      this.busy = false;
    }
  };
}

customElements.define("du-rhythm-sheet", RhythmSheet);
