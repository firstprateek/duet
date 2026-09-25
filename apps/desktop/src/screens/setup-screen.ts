import {
  addMonths,
  currentMonth,
  PARTNER_COLORS,
  rhythmFromSalaries,
  setupHousehold,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Screen } from "../app/screen.ts";

/** First launch: the two names, who is blue and who is yellow, and Our rhythm. */
export class SetupScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    me: { state: true },
    partner: { state: true },
    swapped: { state: true },
    pct: { state: true },
    salaries: { state: true },
    busy: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
      }
      .card {
        width: 620px;
        max-width: 100%;
        padding: 34px 38px 30px;
        border-radius: 30px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      h1 {
        font-size: 32px;
      }
      .lede {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--du-ink-2);
        line-height: 1.5;
      }
      .names {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .name-field {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .name-field .input {
        flex-grow: 1;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 17px;
      }
      .rhythm {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .rhythm input[type="range"] {
        flex-grow: 1;
        accent-color: var(--du-ours);
      }
      .ratio {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 28px;
        min-width: 110px;
        text-align: right;
      }
      .helper {
        background: var(--du-bg);
        border-radius: 18px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--du-ink-2);
      }
      .helper .row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 10px;
        align-items: end;
      }
      .helper .input {
        background: var(--du-card);
      }
      .foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 6px;
      }
    `,
  ];

  declare me: string;
  declare partner: string;
  declare swapped: boolean;
  declare pct: number;
  declare salaries: { mine: string; theirs: string } | null;
  declare busy: boolean;

  constructor() {
    super();
    this.me = "";
    this.partner = "";
    this.swapped = false;
    this.pct = 50;
    this.salaries = null;
    this.busy = false;
  }

  override render() {
    const ready = this.me.trim() && this.partner.trim();
    const myColor = this.swapped ? PARTNER_COLORS[1] : PARTNER_COLORS[0];
    const theirColor = this.swapped ? PARTNER_COLORS[0] : PARTNER_COLORS[1];
    const myPct = this.pct;
    return html`<form class="card" @submit=${this.start}>
      <du-logo></du-logo>
      <h1>Hello, you two</h1>
      <p class="lede">
        Duet keeps track of where our money goes: what's ${words.ours}, what's ${words.mine}, and how we share it. Everything
        stays on this Mac.
      </p>
      <div class="names">
        <label class="field">Your name
          <span class="name-field">
            <du-avatar .name=${this.me || "?"} .color=${myColor} size="36"></du-avatar>
            <input class="input" .value=${this.me} @input=${(e: Event) => (this.me = (e.target as HTMLInputElement).value)} autofocus />
          </span>
        </label>
        <label class="field">Your partner's name
          <span class="name-field">
            <du-avatar .name=${this.partner || "?"} .color=${theirColor} size="36"></du-avatar>
            <input class="input" .value=${this.partner} @input=${(e: Event) => (this.partner = (e.target as HTMLInputElement).value)} />
          </span>
        </label>
      </div>
      <button type="button" class="linkish" style="align-self:flex-start" @click=${() => (this.swapped = !this.swapped)}>Swap our colors</button>
      <div class="field">${words.ourRhythm}
        <span style="font-weight:600;color:var(--du-muted)">How we share what's ${words.ours}, usually from our incomes. Either of us can change it later.</span>
      </div>
      <div class="rhythm">
        <span style="font-weight:800">${this.me || "You"}</span>
        <input type="range" min="1" max="99" .value=${String(this.pct)} @input=${(e: Event) => (this.pct = Number((e.target as HTMLInputElement).value))} aria-label=${words.ourRhythm} />
        <span style="font-weight:800">${this.partner || "Partner"}</span>
        <span class="ratio">${myPct} / ${100 - myPct}</span>
      </div>
      ${
        this.salaries
          ? html`<div class="helper">
            Work it out from salaries. They're only used for this and never saved.
            <div class="row">
              <label class="field">${this.me || "You"}<input class="input" inputmode="numeric" .value=${this.salaries.mine} @input=${(e: Event) => (this.salaries = { ...this.salaries!, mine: (e.target as HTMLInputElement).value })} /></label>
              <label class="field">${this.partner || "Partner"}<input class="input" inputmode="numeric" .value=${this.salaries.theirs} @input=${(e: Event) => (this.salaries = { ...this.salaries!, theirs: (e.target as HTMLInputElement).value })} /></label>
              <button type="button" class="btn small" @click=${this.fromSalaries}>Use this</button>
            </div>
          </div>`
          : html`<button type="button" class="linkish" style="align-self:flex-start" @click=${() => (this.salaries = { mine: "", theirs: "" })}>Work it out from salaries</button>`
      }
      <div class="foot">
        ${
          this.app.platform.kind === "web"
            ? html`<button type="button" class="linkish muted" @click=${this.sample}>Just looking? Try it with sample data</button>`
            : html`<span></span>`
        }
        <button class="btn big" ?disabled=${!ready || this.busy}>Start</button>
      </div>
      ${nothing}
    </form>`;
  }

  private fromSalaries = () => {
    const mine = Number((this.salaries?.mine ?? "").replace(/[^0-9.]/g, ""));
    const theirs = Number((this.salaries?.theirs ?? "").replace(/[^0-9.]/g, ""));
    try {
      this.pct = rhythmFromSalaries(mine, theirs) / 100;
      this.salaries = null;
    } catch {
      this.app.toast("Both salaries are needed.");
    }
  };

  private start = async (e: Event) => {
    e.preventDefault();
    if (!this.me.trim() || !this.partner.trim()) return;
    this.busy = true;
    try {
      // The first partner is blue. Our rhythm is stored as the first partner's share.
      const names: [string, string] = this.swapped
        ? [this.partner, this.me]
        : [this.me, this.partner];
      const firstPct = this.swapped ? 100 - this.pct : this.pct;
      await setupHousehold(this.app.store, {
        names,
        me: this.swapped ? 1 : 0,
        firstBp: firstPct * 100,
        fromMonth: addMonths(currentMonth(), -24),
      });
      await this.app.refresh();
      this.app.navigate({ name: "uploads", month: null }, true);
    } finally {
      this.busy = false;
    }
  };

  private sample = async () => {
    this.busy = true;
    const { seedSampleHousehold } = await import("../demo/seed.ts");
    await seedSampleHousehold(this.app.store);
    await this.app.refresh();
    this.app.navigate({ name: "month", month: null }, true);
    this.busy = false;
  };
}

customElements.define("du-setup-screen", SetupScreen);
