import { formatMoney, monthName, parseCents, recordCleanSlate, today, words } from "@duet/core";
import { html } from "lit";
import type { Sheet } from "../app/app.ts";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

type CleanSlateSheet = Extract<Sheet, { kind: "clean-slate" }>;

/** Records who gave whom how much, and what it evens out. Nothing is ever due. */
export class CleanSlateSheetElement extends Screen {
  static override properties = {
    ...Screen.properties,
    sheet: { attribute: false },
    from: { state: true },
    amount: { state: true },
    date: { state: true },
    appliesTo: { state: true },
    note: { state: true },
    busy: { state: true },
  };
  static override styles = [Screen.styles, sheetStyles];

  declare sheet: CleanSlateSheet;
  declare from: string;
  declare amount: string;
  declare date: string;
  declare appliesTo: string;
  declare note: string;
  declare busy: boolean;

  override connectedCallback(): void {
    super.connectedCallback();
    const b = this.basics;
    this.from = this.sheet.from ?? b.me?.id ?? b.first!.id;
    this.amount = this.sheet.amount ? (this.sheet.amount / 100).toFixed(2) : "";
    this.date = today();
    this.appliesTo = this.sheet.appliesTo;
    this.note = "";
    this.busy = false;
  }

  override render() {
    const b = this.basics;
    const [a, c] = [b.first!, b.second!];
    const to = this.from === a.id ? c : a;
    const month = this.sheet.appliesTo === "overall" ? b.latestMonth : this.sheet.appliesTo;
    const cents = parseCents(this.amount);
    return html`<du-sheet label=${words.cleanSlate} @close=${() => this.app.closeSheet()}>
      <form class="body" @submit=${this.save}>
        <div class="head">
          <span class="badge" style="background:var(--du-bg)"><du-yinyang size="34" .first=${a.color} .second=${c.color}></du-yinyang></span>
          <div>
            <h1>${words.cleanSlate}</h1>
            <div class="meta">Even out ${words.ebbFlow} whenever you like. Nothing is ever due.</div>
          </div>
        </div>
        <div class="group">
          <span class="group-label">Who gave whom?</span>
          <div class="choices" role="group" aria-label="Who gave whom">
            ${[a, c].map((m) => {
              const other = m.id === a.id ? c : a;
              return html`<button type="button" class="choice person" aria-pressed=${this.from === m.id ? "true" : "false"} @click=${() => (this.from = m.id)}>
                <du-avatar .name=${m.name} .color=${m.color} size="26"></du-avatar>${m.name} gave ${other.name}
              </button>`;
            })}
          </div>
        </div>
        <label class="field">How much
          <input class="big-input" inputmode="decimal" .value=${this.amount} @input=${(e: Event) => (this.amount = (e.target as HTMLInputElement).value)} autofocus />
        </label>
        <div class="group">
          <span class="group-label">It evens out</span>
          <div class="choices" role="group" aria-label="It evens out">
            <button type="button" class="choice" aria-pressed=${this.appliesTo !== "overall" ? "true" : "false"} @click=${() => (this.appliesTo = month)}>${monthName(month)}</button>
            <button type="button" class="choice" aria-pressed=${this.appliesTo === "overall" ? "true" : "false"} @click=${() => (this.appliesTo = "overall")}>Everything so far</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px">
          <label class="field">On<input class="input" type="date" .value=${this.date} @change=${(e: Event) => (this.date = (e.target as HTMLInputElement).value)} /></label>
          <label class="field">A little note<input class="input" .value=${this.note} placeholder="Optional" @input=${(e: Event) => (this.note = (e.target as HTMLInputElement).value)} /></label>
        </div>
        <div class="foot">
          <button type="button" class="linkish" @click=${() => this.app.closeSheet()}>${words.notNow}</button>
          <button class="btn" ?disabled=${!cents || cents <= 0 || this.busy}>
            ${cents && cents > 0 ? `${b.names[this.from]} gave ${to.name} ${formatMoney(cents, { cents: true })}` : words.cleanSlate}
          </button>
        </div>
      </form>
    </du-sheet>`;
  }

  private save = async (e: Event) => {
    e.preventDefault();
    const cents = parseCents(this.amount);
    if (!cents || cents <= 0) return;
    this.busy = true;
    const b = this.basics;
    const to = this.from === b.first!.id ? b.second! : b.first!;
    try {
      await recordCleanSlate(this.app.store, {
        from: this.from,
        to: to.id,
        amount: cents,
        date: this.date,
        appliesTo: this.appliesTo,
        note: this.note || null,
      });
      this.app.toast(`${words.cleanSlate} recorded.`);
      this.app.closeSheet();
    } finally {
      this.busy = false;
    }
  };
}

customElements.define("du-clean-slate-sheet", CleanSlateSheetElement);
