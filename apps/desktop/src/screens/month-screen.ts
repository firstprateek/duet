import {
  addMonths,
  carrier,
  formatCompact,
  formatMoney,
  type MonthKey,
  type MonthView,
  monthName,
  monthShort,
  monthView,
  words,
} from "@duet/core";
import { tint } from "@duet/ui";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

/** This month: what we spent, who it was for, Ebb & flow behind Peek, and a few observations. */
export class MonthScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    month: { type: String },
    open: { state: true },
    scope: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 6px 32px 24px;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 700fr) minmax(0, 498fr);
        gap: 18px;
      }
      .summary {
        padding: 26px 28px;
        display: flex;
        gap: 18px;
        min-height: 356px;
      }
      .lead {
        flex: 0 1 290px;
        min-width: 230px;
        display: flex;
        flex-direction: column;
      }
      .monthnav {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .monthnav button {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 0;
        background: var(--du-soft);
        cursor: pointer;
        font-weight: 800;
      }
      .monthnav button[disabled] {
        opacity: 0.4;
        cursor: default;
      }
      .monthnav h1 {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 18px;
        margin: 0;
      }
      .spent-label {
        margin-top: 26px;
        font-size: 15px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .spent {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 68px;
        line-height: 1.05;
        letter-spacing: -0.01em;
      }
      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .pills a {
        text-decoration: none;
      }
      .sentence {
        margin-top: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14.5px;
        font-weight: 600;
        padding-top: 16px;
      }
      .donut {
        flex: 0 1 180px;
        min-width: 120px;
        display: flex;
        align-items: center;
      }
      .legend {
        flex: 1 1 150px;
        min-width: 140px;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 12px;
        font-size: 14px;
        font-weight: 700;
        min-width: 0;
      }
      .legend li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .legend .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .legend .name {
        flex-grow: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .legend .more {
        color: var(--du-muted);
      }
      .side {
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-width: 0;
      }
      .who {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 186px;
      }
      .stack {
        display: flex;
        height: 18px;
        gap: 3px;
      }
      .stack div:first-child {
        border-radius: 9px 4px 4px 9px;
      }
      .stack div:last-child {
        border-radius: 4px 9px 9px 4px;
      }
      .stack div:only-child {
        border-radius: 9px;
      }
      .stack div {
        border-radius: 4px;
      }
      .who-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 14.5px;
        font-weight: 700;
      }
      .who-row {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 24px;
      }
      .who-row .people {
        display: flex;
        width: 34px;
      }
      .who-row .people .overlap {
        margin-left: -8px;
        box-shadow: 0 0 0 2px var(--du-card);
        border-radius: 50%;
      }
      .square {
        width: 10px;
        height: 10px;
        border-radius: 3px;
      }
      .who-row .label {
        flex-grow: 1;
      }
      .who-row .amount {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 17px;
      }
      .circle {
        width: 20px;
        height: 20px;
        border-radius: 50%;
      }
      .ebb {
        padding: 18px 24px;
        min-height: 152px;
        display: flex;
      }
      .ebb-closed {
        flex-grow: 1;
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .ebb-mark {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--du-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .ebb-title {
        flex-grow: 1;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 20px;
      }
      .ebb-open {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ebb-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .ebb-head span {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 17px;
      }
      du-segmented {
        --seg-pad: 3px;
        --seg-btn-pad: 4px 12px;
        --seg-size: 12.5px;
      }
      .ebb-line {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .ebb-people {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .ebb-sentence {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 16.5px;
        line-height: 1.3;
      }
      .ebb-note {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .ebb-links {
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 13px;
        font-weight: 700;
        margin-top: auto;
      }
      .ebb-links .linkish {
        font-size: 13px;
      }
      .ebb-links .tuck {
        margin-left: auto;
      }
      .noticed {
        padding: 22px 28px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .insights {
        display: flex;
        gap: 14px;
        flex-grow: 1;
      }
      .insight {
        flex: 1 1 0;
        border-radius: 20px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 170px;
      }
      .insight p {
        margin: 0;
        font-size: 14.5px;
        font-weight: 600;
        line-height: 1.45;
        color: var(--du-ink);
      }
      .insight a {
        margin-top: auto;
        font-size: 13px;
        font-weight: 800;
        /* The darker link color keeps 4.5:1 on the pastel cards. */
        color: var(--du-link-hover);
      }
      .insight .white {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: var(--du-card);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--du-ink);
      }
      .quiet {
        font-size: 14.5px;
        font-weight: 600;
        color: var(--du-muted);
        line-height: 1.5;
      }
      .six {
        padding: 22px 28px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .six-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .six-head span {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .empty {
        padding: 40px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
      }
      .empty p {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--du-ink-2);
        line-height: 1.5;
        max-width: 520px;
      }
      .empty .actions {
        display: flex;
        gap: 10px;
      }
    `,
  ];

  declare month: MonthKey;
  declare open: boolean | null;
  declare scope: "month" | "overall";

  private data = new Loader<MonthView>(
    this,
    () => this.app,
    () => monthView(this.app.store, this.month),
    () => this.month,
  );

  constructor() {
    super();
    this.open = null;
    this.scope = "month";
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    const b = this.basics;
    const first = b.first!;
    const second = b.second!;
    const name = monthName(v.month);
    const hasData = v.total !== 0 || v.ours !== 0;
    const isOpen = this.open ?? b.settings.alwaysShowEbbFlow;
    return html`
      <div class="row">
        <section class="card summary">
          <div class="lead">
            <div class="monthnav">
              <button aria-label="Previous month" @click=${() => this.go(-1)}>‹</button>
              <h1>${monthName(v.month, true)}</h1>
              <button aria-label="Next month" ?disabled=${v.month >= b.latestMonth && v.month >= this.today()} @click=${() => this.go(1)}>›</button>
            </div>
            <div class="spent-label">In ${name} we spent</div>
            <div class="spent">${formatMoney(v.total)}</div>
            <div class="pills">
              ${hasData ? html`<span class="pill ${v.headline.tone === "more" ? "peach" : v.headline.tone === "less" ? "good" : ""}">${v.headline.label}</span>` : nothing}
              ${
                v.coverage.total > 0
                  ? html`<a href="#/uploads/${v.month}"><span class="pill">${v.coverage.covered} of ${v.coverage.total} accounts in</span></a>`
                  : nothing
              }
            </div>
            ${
              v.headline.sentence && v.byTop[0]
                ? html`<div class="sentence">
                  <du-bubble .icon=${v.byTop.find((t) => v.headline.sentence?.includes(t.category.name))?.category.icon ?? "sparkle"} color="var(--du-sky-bg)" size="38"></du-bubble>
                  <span>${v.headline.sentence}</span>
                </div>`
                : nothing
            }
          </div>
          ${hasData ? this.renderBreakdown(v) : this.renderEmpty(name)}
        </section>
        <div class="side">
          <section class="card who">
            <h2>Who it was for</h2>
            ${this.renderWho(v)}
          </section>
          <section class="card ebb" aria-label=${words.ebbFlow}>
            ${isOpen ? this.renderEbbOpen(v, first.id, second.id) : this.renderEbbClosed()}
          </section>
        </div>
      </div>
      <div class="row" style="flex-grow:1">
        <section class="card noticed">
          <h2>Little things we noticed</h2>
          ${
            v.insights.length
              ? html`<div class="insights">
                ${v.insights.map((insight) => {
                  const category = b.categoriesById.get(insight.categoryId);
                  return html`<article class="insight" style="background:${tint(category?.bubble ?? "var(--du-soft)")}">
                    <span class="white"><du-icon .name=${insight.icon} size="19"></du-icon></span>
                    <p>${insight.text}</p>
                    <a href="#/transactions?month=${v.month}&category=${insight.categoryId}">${insight.linkLabel}</a>
                  </article>`;
                })}
              </div>`
              : html`<p class="quiet">Nothing stands out yet. After a few months, Duet points out what changed.</p>`
          }
        </section>
        <section class="card six">
          <div class="six-head">
            <h2>Last six months</h2>
            ${v.typicalTotal > 0 ? html`<span>- - typical ${formatMoney(v.typicalTotal)}</span>` : nothing}
          </div>
          <du-month-bars
            .bars=${v.lastSix.map((m) => ({ label: monthShort(m.month), value: m.total, top: m.total ? formatCompact(m.total) : "" }))}
            .typical=${v.typicalTotal}
            label=${`Monthly spending for the last six months: ${v.lastSix.map((m) => formatMoney(m.total)).join(", ")}.`}
          ></du-month-bars>
        </section>
      </div>
    `;
  }

  private renderBreakdown(v: MonthView) {
    const top = v.byTop.filter((t) => t.amount > 0);
    const shown = top.slice(0, 4);
    const rest = top.slice(4);
    const restTotal = rest.reduce((s, t) => s + t.amount, 0);
    const total = top.reduce((s, t) => s + t.amount, 0) || 1;
    const lead = top[0];
    const label = `${monthName(v.month)} by category: ${shown.map((t) => `${t.category.name} ${formatMoney(t.amount)}`).join(", ")}${rest.length ? `, ${rest.length} smaller categories ${formatMoney(restTotal)}` : ""}.`;
    return html`
      <div class="donut">
        <du-donut
          .segments=${top.map((t) => ({ value: t.amount, color: t.category.color }))}
          center=${lead ? `${Math.round((lead.amount / total) * 100)}%` : ""}
          sub=${lead ? `on ${lead.category.name.toLowerCase()}` : ""}
          label=${label}
        ></du-donut>
      </div>
      <ul class="legend">
        ${shown.map(
          (t) => html`<li>
            <span class="dot" style="background:${t.category.color}"></span>
            <span class="name">${t.category.name}</span>
            <span class="money">${formatMoney(t.amount)}</span>
          </li>`,
        )}
        ${
          rest.length
            ? html`<li class="more">
              <span class="dot" style="background:var(--du-dash-2)"></span>
              <span class="name">${rest.length} more</span>
              <span class="money">${formatMoney(restTotal)}</span>
            </li>`
            : nothing
        }
      </ul>
    `;
  }

  private renderEmpty(name: string) {
    return html`<div class="empty" style="padding:10px 0 0">
      <p>Nothing in ${name} yet. Upload this month's statements, or add something by hand.</p>
      <div class="actions">
        <a class="btn" href="#/uploads">${words.upload}</a>
        <button class="btn soft" @click=${() => this.app.quickAdd.set(true)}>${words.quickAdd}</button>
      </div>
    </div>`;
  }

  private renderWho(v: MonthView) {
    const b = this.basics;
    const first = b.first!;
    const second = b.second!;
    const firstMine = v.mineByMember[first.id] ?? 0;
    const secondMine = v.mineByMember[second.id] ?? 0;
    const parts = [
      { value: v.ours, color: "var(--du-ours)" },
      { value: firstMine, color: first.color },
      { value: secondMine, color: second.color },
    ].filter((p) => p.value > 0);
    return html`
      <div class="stack" aria-hidden="true">
        ${parts.map((p) => html`<div style="flex:${p.value} 1 0;background:${p.color}"></div>`)}
      </div>
      <div class="who-rows">
        <div class="who-row">
          <span class="people"><span class="circle" style="background:${first.color}"></span><span class="circle overlap" style="background:${second.color}"></span></span>
          <span class="square" style="background:var(--du-ours)"></span>
          <span class="label">${words.ours}</span>
          <span class="amount">${formatMoney(v.ours)}</span>
        </div>
        ${[first, second].map(
          (m) => html`<div class="who-row">
            <span class="people"><du-avatar .name=${m.name} .color=${m.color} size="20"></du-avatar></span>
            <span class="square" style="background:${m.color}"></span>
            <span class="label">${m.name}</span>
            <span class="amount">${formatMoney(v.mineByMember[m.id] ?? 0)}</span>
          </div>`,
        )}
      </div>
    `;
  }

  private renderEbbClosed() {
    const b = this.basics;
    return html`<div class="ebb-closed">
      <span class="ebb-mark"><du-yinyang size="36" .first=${b.first!.color} .second=${b.second!.color}></du-yinyang></span>
      <div class="ebb-title">${words.ebbFlow}</div>
      <button class="btn small" style="padding:9px 18px;font-size:14px;font-weight:700" @click=${() => (this.open = true)}>${words.peek}</button>
    </div>`;
  }

  private renderEbbOpen(v: MonthView, firstId: string, secondId: string) {
    const b = this.basics;
    const pair = { first: firstId, second: secondId };
    const amount = this.scope === "month" ? (v.ebb.figure?.net ?? 0) : v.ebb.overall;
    const who = carrier(amount, pair);
    const other = who === firstId ? secondId : firstId;
    const sentence = this.scope === "month" ? v.ebb.monthSentence : v.ebb.overallSentence;
    const avatar = (id: string) => {
      const m = b.members.find((x) => x.id === id)!;
      return html`<du-avatar .name=${m.name} .color=${m.color} size="28"></du-avatar>`;
    };
    return html`<div class="ebb-open">
      <div class="ebb-head">
        <span>${words.ebbFlow}</span>
        <du-segmented
          label="Period"
          .options=${[
            { value: "month", label: monthName(v.month) },
            { value: "overall", label: "Overall" },
          ]}
          .value=${this.scope}
          @change=${(e: CustomEvent<{ value: "month" | "overall" }>) => (this.scope = e.detail.value)}
        ></du-segmented>
      </div>
      <div class="ebb-line">
        <span class="ebb-people">
          ${avatar(who ?? firstId)}
          <du-yinyang size="20" .first=${b.first!.color} .second=${b.second!.color}></du-yinyang>
          ${avatar(who ? other : secondId)}
        </span>
        <span class="ebb-sentence">${sentence}</span>
      </div>
      ${
        v.addedAfterSlate && this.scope === "month"
          ? html`<div class="ebb-note">${v.addedAfterSlate.count} added after your clean slate on ${this.shortDay(v.addedAfterSlate.date)}</div>`
          : nothing
      }
      <div class="ebb-links">
        <button class="linkish" @click=${() => this.cleanSlate(v, amount)}>${words.cleanSlate}</button>
        <a href="#/month/${v.month}/history">${words.history}</a>
        <button class="linkish muted tuck" @click=${() => (this.open = false)}>${words.tuckAway}</button>
      </div>
    </div>`;
  }

  private shortDay(date: string): string {
    return `${monthShort(date.slice(0, 7))} ${Number(date.slice(8, 10))}`;
  }

  private cleanSlate(v: MonthView, amount: number) {
    const b = this.basics;
    const pair = { first: b.first!.id, second: b.second!.id };
    const who = carrier(amount, pair);
    // The person who carried less gives to the one who carried more.
    const from = who ? (who === pair.first ? pair.second : pair.first) : null;
    this.app.openSheet({
      kind: "clean-slate",
      appliesTo: this.scope === "month" ? v.month : "overall",
      amount: who ? Math.abs(amount) : null,
      from,
    });
  }

  private today(): MonthKey {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private go(delta: number) {
    this.open = null;
    this.app.navigate({ name: "month", month: addMonths(this.month, delta) });
  }
}

customElements.define("du-month-screen", MonthScreen);
