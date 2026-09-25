import {
  carrier,
  dayLabel,
  dayLabelWithYear,
  type EbbFlowView,
  ebbFlowView,
  formatMoney,
  isInStep,
  type MonthKey,
  monthName,
  monthShort,
  rhythmLabel,
  signedLabel,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

/** Ebb & flow, month by month: each month's figure, the running total, and Clean slates. */
export class HistoryScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    month: { type: String },
    showAll: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 800fr) minmax(0, 398fr);
        gap: 18px;
        padding: 6px 32px 24px;
        align-items: start;
      }
      .list {
        padding: 20px 26px;
        display: flex;
        flex-direction: column;
      }
      .back {
        font-size: 13px;
        font-weight: 800;
        text-decoration: none;
      }
      .title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 6px;
      }
      h1 {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 28px;
      }
      h1 .muted {
        font-weight: 500;
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 12.5px;
        font-weight: 800;
        color: var(--du-ink-2);
      }
      .legend span {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .legend i {
        width: 12px;
        height: 12px;
        border-radius: 4px;
      }
      .grid {
        display: grid;
        grid-template-columns: 76px minmax(0, 360px) minmax(0, 1fr) 132px;
        column-gap: 14px;
        align-items: center;
      }
      .head {
        height: 26px;
        margin-top: 12px;
        font-size: 11.5px;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--du-muted);
        border-bottom: 2px dotted var(--du-line);
      }
      .rowline {
        height: 34px;
        font-size: 13.5px;
        font-weight: 700;
      }
      .rowline .m {
        font-weight: 800;
      }
      .rowline .year {
        font-weight: 600;
        color: var(--du-muted);
        font-size: 11.5px;
      }
      .after {
        text-align: right;
        color: var(--du-muted);
      }
      .after.now {
        color: var(--du-ink);
        font-weight: 800;
      }
      .after.step {
        color: var(--du-good-fg);
        font-weight: 800;
      }
      .slate {
        display: inline-flex;
        align-self: flex-start;
        align-items: center;
        gap: 10px;
        height: 30px;
        margin: 2px 0 4px 90px;
        padding: 0 12px;
        border-radius: 999px;
        background: var(--du-good-bg);
        color: var(--du-good-fg);
        font-size: 12.5px;
        font-weight: 800;
      }
      .more {
        margin-top: 10px;
        align-self: flex-start;
      }
      aside {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .overall {
        padding: 24px 26px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .overall .figure {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .overall .big {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 40px;
        line-height: 1;
      }
      .overall p {
        margin: 0;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 17px;
        line-height: 1.35;
      }
      .past {
        padding: 22px 26px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .past-row {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        font-weight: 700;
      }
      .past-row .when {
        flex-grow: 1;
      }
      .check {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: var(--du-good-bg);
        color: var(--du-good-fg);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .rhythm {
        padding: 20px 26px;
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .rhythm .value {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 24px;
      }
      .small-label {
        font-size: 13px;
        font-weight: 800;
        color: var(--du-muted);
      }
    `,
  ];

  declare month: MonthKey;
  declare showAll: boolean;

  private data = new Loader<EbbFlowView>(
    this,
    () => this.app,
    () => ebbFlowView(this.app.store, this.month),
    () => this.month,
  );

  constructor() {
    super();
    this.showAll = false;
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    const b = this.basics;
    const pair = v.pair;
    const names = v.names;
    const first = b.first!;
    const second = b.second!;
    const rows = [...v.flow.months].reverse();
    const shown = this.showAll ? rows : rows.slice(0, 12);
    const scale = Math.max(2500, ...shown.map((r) => Math.abs(r.raw)));
    const who = carrier(v.flow.overall, pair);
    const whoMember = b.members.find((m) => m.id === who);
    const nameOf = (id: string) => names[id] ?? "";

    return html`
      <section class="card list">
        <a class="back" href="#/month/${this.month}">‹ ${words.thisMonth}</a>
        <div class="title">
          <h1>
            <du-yinyang size="34" .first=${first.color} .second=${second.color}></du-yinyang>
            ${words.ebbFlow} <span class="muted">· ${words.history}</span>
          </h1>
          <div class="legend">
            <span><i style="background:${first.color}"></i>${first.name} carried more</span>
            <span><i style="background:${second.color}"></i>${second.name} carried more</span>
          </div>
        </div>
        <div class="grid head">
          <span>Month</span><span style="text-align:center">${first.name} · ${second.name}</span><span>That month</span><span style="text-align:right">Overall after</span>
        </div>
        ${shown.length === 0 ? html`<p class="muted" style="font-weight:600;margin-top:18px">Nothing yet. Ebb & flow starts once something Ours is added.</p>` : nothing}
        ${shown.map((r, i) => {
          const slates = [...r.slates, ...r.overallSlates];
          const newest = i === 0;
          // The year shows once, on the first row of each earlier year.
          const yearNote = i > 0 && shown[i - 1]!.month.slice(0, 4) !== r.month.slice(0, 4);
          return html`
            ${slates.map(
              (s) => html`<span class="slate">
                <du-icon name="check" size="13" stroke="3"></du-icon>
                ${words.cleanSlate} · ${dayLabel(s.date)} · ${nameOf(s.from)} to ${nameOf(s.to)} ${formatMoney(s.amount)} ·
                ${s.appliesTo === "overall" ? "everything so far" : isInStep(r.net) ? `${monthName(r.month)} is in step` : `for ${monthName(r.month)}`}
              </span>`,
            )}
            <div class="grid rowline">
              <span class="m">${monthShort(r.month)}${yearNote ? html` <span class="year">${r.month.slice(0, 4)}</span>` : nothing}</span>
              <du-diverging-bar .value=${r.raw} .scale=${scale} .first=${first.color} .second=${second.color}></du-diverging-bar>
              <span>${signedLabel(r.raw, pair, names)}</span>
              <span class="after ${newest ? "now" : ""} ${isInStep(r.overallAfter) ? "step" : ""}">${signedLabel(r.overallAfter, pair, names)}</span>
            </div>
          `;
        })}
        ${
          rows.length > 12 && !this.showAll
            ? html`<button class="btn soft small more" @click=${() => (this.showAll = true)}>Show earlier months</button>`
            : nothing
        }
      </section>
      <aside>
        <section class="card overall">
          <div class="small-label">Overall right now</div>
          <div class="figure">
            ${
              whoMember
                ? html`<du-avatar .name=${whoMember.name} .color=${whoMember.color} size="36"></du-avatar>
                  <span class="big">+${formatMoney(Math.abs(v.flow.overall))}</span>`
                : html`<du-yinyang size="36" .first=${first.color} .second=${second.color}></du-yinyang>
                  <span class="big">${words.inStep}</span>`
            }
          </div>
          <p>${whoMember ? `${whoMember.name}'s been carrying a little extra lately.` : "Nothing to even out."}</p>
          <div style="display:flex;align-items:center;gap:12px;margin-top:4px">
            <button
              class="btn"
              @click=${() =>
                this.app.openSheet({
                  kind: "clean-slate",
                  appliesTo: b.settings.cleanSlateDefault === "overall" ? "overall" : this.month,
                  amount: who ? Math.abs(v.flow.overall) : null,
                  from: who ? (who === pair.first ? pair.second : pair.first) : null,
                })}
            >
              ${words.cleanSlate}
            </button>
            <span class="muted" style="font-size:13px;font-weight:600">for ${monthName(this.month)} or everything</span>
          </div>
        </section>
        <section class="card past">
          <h2>Past clean slates</h2>
          ${v.slates.length === 0 ? html`<span class="muted" style="font-weight:600;font-size:14px">None yet.</span>` : nothing}
          ${v.slates.slice(0, 6).map(
            (s) => html`<div class="past-row">
              <span class="check"><du-icon name="check" size="14" stroke="3"></du-icon></span>
              <span class="when">${dayLabelWithYear(s.date)} <span class="muted" style="font-weight:600">· ${s.appliesTo === "overall" ? "everything" : `for ${monthName(s.appliesTo)}`}</span></span>
              <span class="money">${nameOf(s.fromMember)} to ${nameOf(s.toMember)} ${formatMoney(s.amount)}</span>
            </div>`,
          )}
        </section>
        <section class="card rhythm">
          <div style="flex-grow:1">
            <div class="small-label">${words.ourRhythm}</div>
            <div class="value">${rhythmLabel(v.currentFirstBp)}
              ${v.rhythmSince ? html`<span class="muted" style="font-family:var(--du-font-text);font-size:13px;font-weight:700">since ${monthName(v.rhythmSince, v.rhythmSince.slice(0, 4) !== this.month.slice(0, 4))}</span>` : nothing}
            </div>
          </div>
          <button class="linkish" @click=${() => this.app.openSheet({ kind: "rhythm" })}>Change</button>
        </section>
      </aside>
    `;
  }
}

customElements.define("du-history-screen", HistoryScreen);
