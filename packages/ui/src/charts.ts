import { css, html, LitElement, nothing, svg } from "lit";

/**
 * Small hand-drawn SVG charts in the style of the mocks: a donut of categories, a row of
 * rounded month bars with a dashed "typical" line, stacked Ours / Jack / Jill bars, and
 * the diverging Ebb & flow bar.
 */

export interface DonutSegment {
  value: number;
  color: string;
  label?: string;
}

export class DuDonut extends LitElement {
  static override properties = {
    segments: { attribute: false },
    center: { type: String },
    sub: { type: String },
    label: { type: String },
    size: { type: Number },
  };
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      line-height: 0;
    }
    svg {
      width: 100%;
      height: auto;
    }
  `;
  declare segments: DonutSegment[];
  declare center: string;
  declare sub: string;
  declare label: string;
  declare size: number;

  constructor() {
    super();
    this.segments = [];
    this.center = "";
    this.sub = "";
    this.label = "";
    this.size = 180;
  }

  override render() {
    const r = 70;
    const c = 2 * Math.PI * r;
    const total = this.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    const gap = this.segments.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = total
      ? this.segments.map((s) => {
          const len = Math.max(0, (Math.max(0, s.value) / total) * c - gap);
          const el = svg`<circle cx="90" cy="90" r=${r} fill="none" stroke=${s.color} stroke-width="26"
            stroke-dasharray="${len} ${c - len}" stroke-dashoffset=${-offset}></circle>`;
          offset += len + gap;
          return el;
        })
      : [
          svg`<circle cx="90" cy="90" r=${r} fill="none" stroke="var(--du-soft)" stroke-width="26"></circle>`,
        ];
    return html`<svg style="max-width:${this.size}px" viewBox="0 0 180 180" role="img" aria-label=${this.label}>
      <g transform="rotate(-90 90 90)">${arcs}</g>
      ${svg`<text x="90" y="92" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="600" font-size="26" fill="currentColor">${this.center}</text>
      <text x="90" y="112" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="700" font-size="12" fill="var(--du-muted)">${this.sub}</text>`}
    </svg>`;
  }
}

export interface BarDatum {
  label: string;
  value: number;
  /** Text above the bar ("6.9k"). */
  top?: string;
}

/** Month bars: the last one highlighted, a dashed line at a typical value. */
export class DuMonthBars extends LitElement {
  static override properties = {
    bars: { attribute: false },
    typical: { type: Number },
    width: { type: Number },
    height: { type: Number },
    label: { type: String },
  };
  static override styles = css`
    :host {
      display: block;
      line-height: 0;
    }
  `;
  declare bars: BarDatum[];
  declare typical: number;
  declare width: number;
  declare height: number;
  declare label: string;

  constructor() {
    super();
    this.bars = [];
    this.typical = 0;
    this.width = 442;
    this.height = 192;
    this.label = "";
  }

  override render() {
    const n = this.bars.length || 1;
    const base = this.height - 32;
    const maxBar = this.height - 62;
    const max = Math.max(this.typical, ...this.bars.map((b) => b.value), 1);
    const slot = (this.width - 8) / n;
    const w = Math.min(44, slot - 16);
    const y = (v: number) => base - (Math.max(0, v) / max) * maxBar;
    return html`<svg width="100%" viewBox="0 0 ${this.width} ${this.height}" role="img" aria-label=${this.label}>
      ${this.bars.map((b, i) => {
        const x = 4 + slot * i + (slot - w) / 2;
        const last = i === this.bars.length - 1;
        const top = y(b.value);
        return svg`<rect x=${x} y=${top} width=${w} height=${Math.max(0, base - top)} rx="12"
            fill=${last ? "var(--du-ours)" : "var(--du-sky-bg)"}><title>${b.label}: ${b.top ?? ""}</title></rect>
          <text x=${x + w / 2} y=${top - 8} text-anchor="middle" font-family="Fredoka, sans-serif"
            font-size=${last ? 13 : 12} font-weight=${last ? 600 : 400} fill=${last ? "currentColor" : "var(--du-muted)"}>${b.top ?? ""}</text>
          <text x=${x + w / 2} y=${this.height - 10} text-anchor="middle" font-family="Nunito, sans-serif"
            font-weight=${last ? 800 : 700} font-size="12" fill=${last ? "currentColor" : "var(--du-muted)"}>${b.label}</text>`;
      })}
      ${
        this.typical > 0
          ? svg`<line x1="4" y1=${y(this.typical)} x2=${this.width - 4} y2=${y(this.typical)} stroke="var(--du-muted)"
            stroke-width="1.2" stroke-dasharray="4 4"></line>`
          : nothing
      }
    </svg>`;
  }
}

export interface StackedDatum {
  label: string;
  parts: Array<{ value: number; color: string; name: string }>;
  top?: string;
}

/** Stacked monthly bars for Trends, Ours at the bottom, with rounded tops. */
export class DuStackedBars extends LitElement {
  static override properties = {
    bars: { attribute: false },
    typical: { type: Number },
    width: { type: Number },
    height: { type: Number },
    label: { type: String },
  };
  static override styles = css`
    :host {
      display: block;
      line-height: 0;
    }
  `;
  declare bars: StackedDatum[];
  declare typical: number;
  declare width: number;
  declare height: number;
  declare label: string;

  constructor() {
    super();
    this.bars = [];
    this.typical = 0;
    this.width = 1160;
    this.height = 222;
    this.label = "";
  }
  private readonly uid = Math.random().toString(36).slice(2, 8);

  override render() {
    const n = this.bars.length || 1;
    const base = this.height - 26;
    const maxBar = this.height - 42;
    const totals = this.bars.map((b) => b.parts.reduce((s, p) => s + Math.max(0, p.value), 0));
    const max = Math.max(this.typical, ...totals, 1);
    const slot = (this.width - 8) / n;
    const w = 44;
    const h = (v: number) => (Math.max(0, v) / max) * maxBar;
    const maxIndex = totals.indexOf(Math.max(...totals));
    return html`<svg width="100%" viewBox="0 0 ${this.width} ${this.height}" role="img" aria-label=${this.label}>
      <defs>
        ${this.bars.map((_, i) => {
          const x = 4 + slot * i + (slot - w) / 2;
          const height = h(totals[i] ?? 0);
          return svg`<clipPath id="${this.uid}-${i}"><rect x=${x} y=${base - height} width=${w} height=${height} rx="11"></rect></clipPath>`;
        })}
      </defs>
      ${this.bars.map((b, i) => {
        const x = 4 + slot * i + (slot - w) / 2;
        let y = base;
        const last = i === this.bars.length - 1;
        const topY = base - h(totals[i] ?? 0);
        const rects = b.parts.map((p) => {
          const height = h(p.value);
          y -= height;
          return svg`<rect x=${x} y=${y} width=${w} height=${height} fill=${p.color}><title>${b.label} · ${p.name}</title></rect>`;
        });
        return svg`<g clip-path="url(#${this.uid}-${i})">${rects}</g>
          ${
            (last || i === maxIndex) && b.top
              ? svg`<text x=${x + w / 2} y=${topY - 8} text-anchor="middle" font-family="Fredoka, sans-serif"
                font-size=${last ? 13 : 12} font-weight=${last ? 600 : 400} fill=${last ? "currentColor" : "var(--du-muted)"}>${b.top}</text>`
              : nothing
          }
          <text x=${x + w / 2} y=${this.height - 9} text-anchor="middle" font-family="Nunito, sans-serif"
            font-weight=${last ? 800 : 700} font-size="12" fill=${last ? "currentColor" : "var(--du-muted)"}>${b.label}</text>`;
      })}
      ${
        this.typical > 0
          ? svg`<line x1="4" y1=${base - h(this.typical)} x2=${this.width - 4} y2=${base - h(this.typical)}
            stroke="var(--du-muted)" stroke-width="1.2" stroke-dasharray="4 4"></line>`
          : nothing
      }
    </svg>`;
  }
}

/**
 * One Ebb & flow month: a bar to the left (first partner carried more) or right (second).
 * `scale` is the amount that fills half the track.
 */
export class DuDivergingBar extends LitElement {
  static override properties = {
    value: { type: Number },
    scale: { type: Number },
    first: { type: String },
    second: { type: String },
  };
  static override styles = css`
    :host {
      display: block;
      position: relative;
      height: 16px;
    }
    .axis {
      position: absolute;
      left: calc(50% - 1px);
      top: -9px;
      width: 2px;
      height: 34px;
      background: var(--du-line);
    }
    .bar {
      position: absolute;
      top: 0;
      height: 16px;
    }
  `;
  declare value: number;
  declare scale: number;
  declare first: string;
  declare second: string;

  constructor() {
    super();
    this.value = 0;
    this.scale = 50000;
    this.first = "#2F6FB0";
    this.second = "#F5C451";
  }

  override render() {
    const pct = Math.min(1, Math.abs(this.value) / Math.max(1, this.scale)) * 47;
    const left = this.value > 0;
    const style = left
      ? `right:calc(50% + 1px);width:${pct}%;border-radius:8px 0 0 8px;background:${this.first}`
      : `left:calc(50% + 1px);width:${pct}%;border-radius:0 8px 8px 0;background:${this.second}`;
    return html`<span class="axis"></span>${this.value !== 0 ? html`<span class="bar" style=${style}></span>` : nothing}`;
  }
}

if (!customElements.get("du-donut")) customElements.define("du-donut", DuDonut);
if (!customElements.get("du-month-bars")) customElements.define("du-month-bars", DuMonthBars);
if (!customElements.get("du-stacked-bars")) customElements.define("du-stacked-bars", DuStackedBars);
if (!customElements.get("du-diverging-bar"))
  customElements.define("du-diverging-bar", DuDivergingBar);

declare global {
  interface HTMLElementTagNameMap {
    "du-donut": DuDonut;
    "du-month-bars": DuMonthBars;
    "du-stacked-bars": DuStackedBars;
    "du-diverging-bar": DuDivergingBar;
  }
}
