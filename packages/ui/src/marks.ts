import { css, html, LitElement, svg } from "lit";
import { iconPath } from "./icons.ts";
import { tint } from "./styles.ts";

/** Picks readable text (white or ink) for a colored circle. */
export function textOn(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#2B2536";
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.35 ? "#2B2536" : "#FFFFFF";
}

export class DuIcon extends LitElement {
  static override properties = {
    name: { type: String },
    size: { type: Number },
    stroke: { type: Number },
    color: { type: String },
  };
  static override styles = css`
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `;
  declare name: string;
  declare size: number;
  declare stroke: number;
  declare color: string;

  constructor() {
    super();
    this.name = "dots";
    this.size = 18;
    this.stroke = 1.9;
    this.color = "currentColor";
  }

  override render() {
    return html`<svg
      width=${this.size}
      height=${this.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke=${this.color}
      stroke-width=${this.name === "dots" ? 3 : this.stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d=${iconPath(this.name)}></path>
    </svg>`;
  }
}

/** An icon inside a pastel circle, like every category in the mocks. */
export class DuBubble extends LitElement {
  static override properties = {
    icon: { type: String },
    color: { type: String },
    size: { type: Number },
  };
  static override styles = css`
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    span {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: var(--du-ink);
    }
  `;
  declare icon: string;
  declare color: string;
  declare size: number;

  constructor() {
    super();
    this.icon = "dots";
    this.color = "#F0ECE6";
    this.size = 30;
  }

  override render() {
    const iconSize = Math.round(this.size * 0.52);
    return html`<span style="width:${this.size}px;height:${this.size}px;background:${tint(this.color)}">
      <du-icon name=${this.icon} size=${iconSize}></du-icon>
    </span>`;
  }
}

export class DuAvatar extends LitElement {
  static override properties = {
    name: { type: String },
    color: { type: String },
    size: { type: Number },
  };
  static override styles = css`
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    span {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-family: var(--du-font-display);
      font-weight: 600;
    }
    :host([ring]) span {
      box-shadow: 0 0 0 3px var(--du-bg);
    }
  `;
  declare name: string;
  declare color: string;
  declare size: number;

  constructor() {
    super();
    this.name = "";
    this.color = "#2F6FB0";
    this.size = 32;
  }

  override render() {
    const initial = this.name.trim().charAt(0).toUpperCase() || "?";
    return html`<span
      role="img"
      aria-label=${this.name}
      style="width:${this.size}px;height:${this.size}px;background:${this.color};color:${textOn(this.color)};font-size:${Math.round(this.size * 0.44)}px"
      >${initial}</span
    >`;
  }
}

/** The Ebb & flow mark: a yin-yang in the two partners' colors. */
export class DuYinYang extends LitElement {
  static override properties = {
    size: { type: Number },
    first: { type: String },
    second: { type: String },
  };
  static override styles = css`
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `;
  declare size: number;
  declare first: string;
  declare second: string;

  constructor() {
    super();
    this.size = 36;
    this.first = "#2F6FB0";
    this.second = "#F5C451";
  }

  override render() {
    return html`<svg width=${this.size} height=${this.size} viewBox="0 0 24 24" aria-hidden="true">
      ${svg`<circle cx="12" cy="12" r="10" fill=${this.second}></circle>
      <path d="M12 2A10 10 0 0 1 12 22A5 5 0 0 1 12 12A5 5 0 0 0 12 2Z" fill=${this.first}></path>
      <circle cx="12" cy="7" r="1.6" fill=${this.first}></circle>
      <circle cx="12" cy="17" r="1.6" fill=${this.second}></circle>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#2B2536" stroke-width="1.1"></circle>`}
    </svg>`;
  }
}

export class DuLogo extends LitElement {
  static override properties = {
    first: { type: String },
    second: { type: String },
  };
  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    span {
      font-family: var(--du-font-display);
      font-weight: 600;
      font-size: 26px;
      letter-spacing: -0.01em;
    }
  `;
  declare first: string;
  declare second: string;

  constructor() {
    super();
    this.first = "#2F6FB0";
    this.second = "#F5C451";
  }

  override render() {
    return html`<svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill=${this.first}></circle>
        <circle cx="22" cy="12" r="11" fill=${this.second} style="mix-blend-mode: var(--du-logo-blend)"></circle></svg
      ><span>duet</span>`;
  }
}

if (!customElements.get("du-icon")) customElements.define("du-icon", DuIcon);
if (!customElements.get("du-bubble")) customElements.define("du-bubble", DuBubble);
if (!customElements.get("du-avatar")) customElements.define("du-avatar", DuAvatar);
if (!customElements.get("du-yinyang")) customElements.define("du-yinyang", DuYinYang);
if (!customElements.get("du-logo")) customElements.define("du-logo", DuLogo);

declare global {
  interface HTMLElementTagNameMap {
    "du-icon": DuIcon;
    "du-bubble": DuBubble;
    "du-avatar": DuAvatar;
    "du-yinyang": DuYinYang;
    "du-logo": DuLogo;
  }
}
