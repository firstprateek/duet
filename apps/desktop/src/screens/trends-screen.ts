import {
  activeMonths,
  formatCompact,
  formatMoney,
  monthName,
  monthRange,
  monthShort,
  type TrendsView,
  trendsView,
  words,
} from "@duet/core";
import { tint } from "@duet/ui";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

/** Trends: the long view of our habits, and a typical month for us. */
export class TrendsScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    count: { state: true },
    categoryId: { state: true },
    allCategories: { state: true },
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
        justify-content: space-between;
        min-height: 44px;
      }
      du-segmented {
        --seg-bg: var(--du-card);
        --seg-shadow: var(--du-shadow-small);
        --seg-btn-pad: 7px 16px;
        --seg-size: 13.5px;
      }
      .chart {
        padding: 20px 28px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .chart-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .cats {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .cats button {
        border: 0;
        border-radius: 999px;
        padding: 6px 14px;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        color: var(--du-ink);
      }
      .cats button[aria-pressed="true"] {
        background: var(--du-ink) !important;
        color: var(--du-on-ink);
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
        width: 11px;
        height: 11px;
        border-radius: 3px;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 700fr) minmax(0, 498fr);
        gap: 18px;
        flex-grow: 1;
      }
      .typical {
        padding: 20px 28px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .typical-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .typical-head span {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-muted);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-flow: column;
        column-gap: 28px;
        row-gap: 2px;
      }
      .cat {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 30px;
        font-size: 14px;
        font-weight: 700;
      }
      .cat .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .cat .name {
        flex-grow: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cat .diff {
        width: 58px;
        text-align: right;
        font-size: 12.5px;
        color: var(--du-muted);
      }
      .cat .diff.big {
        font-weight: 800;
        color: var(--du-link);
      }
      .foot {
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 12px;
      }
      .foot .total {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 20px;
        margin-left: 6px;
      }
      .notes {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .note {
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 18px;
        padding: 12px 14px;
        color: var(--du-ink);
      }
      .note p {
        margin: 0;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.4;
      }
      .note .white {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--du-card);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
    `,
  ];

  declare count: 6 | 12 | "all";
  declare categoryId: string | null;
  declare allCategories: boolean;

  private data = new Loader<TrendsView>(
    this,
    () => this.app,
    async () => {
      const through = this.basics.latestMonth;
      let count: number = this.count === "all" ? 12 : this.count;
      if (this.count === "all") {
        const first = (await activeMonths(this.app.store))[0];
        if (first && first < through) count = Math.max(12, monthRange(first, through).length);
      }
      return trendsView(this.app.store, { through, count, categoryId: this.categoryId });
    },
    () => `${this.count}|${this.categoryId}|${this.basics?.latestMonth}`,
  );

  constructor() {
    super();
    this.count = 12;
    this.categoryId = null;
    this.allCategories = false;
  }

  override render() {
    const v = this.data.value;
    const b = this.basics;
    if (!v) return nothing;
    const first = b.first!;
    const second = b.second!;
    // The categories we spend most on lately come first; ones we never use stay out.
    const amountOf = (id: string) =>
      v.latestByTop.get(id) ?? v.typicalByTop.find((t) => t.category.id === id)?.amount ?? 0;
    const ranked = v.topCategories
      .filter((c) => amountOf(c.id) > 0)
      .sort((a, b) => amountOf(b.id) - amountOf(a.id));
    const pills = this.allCategories ? ranked : ranked.slice(0, 4);
    const hidden = ranked.length - pills.length;
    const latest = v.latest;
    const bars = v.months.map((m) => ({
      label: monthShort(m.month),
      top: m.total ? formatCompact(m.total) : "",
      parts: [
        { value: m.ours, color: "var(--du-ours)", name: words.ours },
        { value: m.first, color: first.color, name: first.name },
        { value: m.second, color: second.color, name: second.name },
      ],
    }));
    const label = `Monthly spending, split into ${words.ours}, ${first.name} and ${second.name}: ${v.months
      .map((m) => `${monthName(m.month)} ${formatMoney(m.total)}`)
      .join(", ")}. A typical month is ${formatMoney(v.typicalTotal)}.`;
    const mostly = v.latestMostlyCategory
      ? b.categoriesById.get(v.latestMostlyCategory)?.name
      : null;

    return html`
      <div class="title">
        <h1>${words.trends}</h1>
        <du-segmented
          label="Period"
          .options=${[
            { value: "6", label: "6 months" },
            { value: "12", label: "12 months" },
            { value: "all", label: "Everything" },
          ]}
          .value=${String(this.count)}
          @change=${(e: CustomEvent<{ value: string }>) => {
            const value = e.detail.value;
            this.count = value === "6" ? 6 : value === "all" ? "all" : 12;
          }}
        ></du-segmented>
      </div>
      <section class="card chart">
        <div class="chart-head">
          <div class="cats" role="group" aria-label="Category">
            <button style="background:var(--du-soft)" aria-pressed=${this.categoryId === null ? "true" : "false"} @click=${() => (this.categoryId = null)}>Everything</button>
            ${pills.map(
              (c) =>
                html`<button style="background:${tint(c.bubble)}" aria-pressed=${this.categoryId === c.id ? "true" : "false"} @click=${() => (this.categoryId = c.id)}>${c.name}</button>`,
            )}
            ${
              hidden > 0
                ? html`<button style="background:var(--du-soft)" @click=${() => (this.allCategories = true)}>${hidden} more</button>`
                : nothing
            }
          </div>
          <div class="legend">
            <span><i style="background:var(--du-ours)"></i>${words.ours}</span>
            <span><i style="background:${first.color}"></i>${first.name}</span>
            <span><i style="background:${second.color}"></i>${second.name}</span>
            ${v.typicalTotal ? html`<span class="muted">- - typical ${formatMoney(v.typicalTotal)}</span>` : nothing}
          </div>
        </div>
        <du-stacked-bars .bars=${bars} .typical=${this.categoryId ? 0 : v.typicalTotal} label=${label}></du-stacked-bars>
      </section>
      <div class="row">
        <section class="card typical">
          <div class="typical-head">
            <h2>A typical month for us</h2>
            ${latest ? html`<span>middle of the last 6 months · vs ${monthName(latest.month)}</span>` : nothing}
          </div>
          ${
            v.typicalByTop.length
              ? html`<div class="grid" style="grid-template-rows:repeat(${Math.ceil(v.typicalByTop.length / 2)}, auto)">
                ${v.typicalByTop.map((t) => {
                  const now = v.latestByTop.get(t.category.id) ?? 0;
                  const diff = now - t.amount;
                  const big = diff > Math.max(20000, t.amount * 0.5);
                  return html`<div class="cat">
                    <span class="dot" style="background:${t.category.color}"></span>
                    <span class="name">${t.category.name}</span>
                    <span class="money">${formatMoney(t.amount)}</span>
                    <span class="diff ${big ? "big" : ""}">${diff === 0 ? "" : formatMoney(diff, { signed: true })}</span>
                  </div>`;
                })}
              </div>`
              : html`<p class="muted" style="font-weight:600;margin:0">After a couple of months, this shows what a usual month looks like for us.</p>`
          }
          <div class="foot dotted-top">
            <span style="font-size:14px;font-weight:800">A typical month <span class="total">${formatMoney(v.typicalTotal)}</span></span>
            ${
              latest?.total && v.typicalTotal
                ? html`<span class="pill ${latest.difference > 0 ? "peach" : "good"}"
                  >${monthName(latest.month)} was ${formatMoney(latest.difference, { signed: true })}${mostly ? `, mostly ${mostly}` : ""}</span
                >`
                : nothing
            }
          </div>
        </section>
        <section class="card notes">
          <h2>Worth a look</h2>
          ${v.notes.length === 0 ? html`<p class="muted" style="font-weight:600;margin:0">Nothing yet. Patterns show up after a few months.</p>` : nothing}
          ${v.notes.map((n) => {
            const c = b.categoriesById.get(n.categoryId);
            return html`<article class="note" style="background:${tint(c?.bubble ?? "var(--du-soft)")}">
              <span class="white"><du-icon .name=${c?.icon ?? "sparkle"} size="18"></du-icon></span>
              <p>${n.text}</p>
            </article>`;
          })}
        </section>
      </div>
    `;
  }
}

customElements.define("du-trends-screen", TrendsScreen);
