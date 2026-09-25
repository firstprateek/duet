import { css, html, LitElement, nothing } from "lit";
import "./marks.ts";

/** An on/off switch ("Always show Ebb & flow"). Fires `change` with `detail.checked`. */
export class DuSwitch extends LitElement {
  static override properties = {
    checked: { type: Boolean },
    label: { type: String },
  };
  static override styles = css`
    button {
      width: 50px;
      height: 30px;
      flex-shrink: 0;
      border-radius: 999px;
      border: 0;
      background: var(--du-dash);
      position: relative;
      padding: 0;
      cursor: pointer;
      transition: background 0.15s;
    }
    button[aria-checked="true"] {
      background: var(--du-ours);
    }
    span {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(43, 37, 54, 0.3);
      transition: left 0.15s;
    }
    button[aria-checked="true"] span {
      left: 23px;
    }
    button:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--du-ours) 70%, transparent);
      outline-offset: 2px;
    }
  `;
  declare checked: boolean;
  declare label: string;

  constructor() {
    super();
    this.checked = false;
    this.label = "";
  }

  override render() {
    return html`<button
      type="button"
      role="switch"
      aria-checked=${this.checked ? "true" : "false"}
      aria-label=${this.label}
      @click=${this.toggle}
    >
      <span></span>
    </button>`;
  }

  private toggle() {
    this.checked = !this.checked;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

export interface SegmentOption {
  value: string;
  label: string;
  icon?: string;
}

/** A pill group where one option is on (Light / Dark, 6 months / 12 months). */
export class DuSegmented extends LitElement {
  static override properties = {
    options: { attribute: false },
    value: { type: String },
    label: { type: String },
  };
  static override styles = css`
    :host {
      display: inline-flex;
    }
    div {
      display: flex;
      gap: 2px;
      background: var(--seg-bg, var(--du-soft));
      border-radius: 999px;
      padding: var(--seg-pad, 4px);
      box-shadow: var(--seg-shadow, none);
      width: 100%;
    }
    button {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 0;
      border-radius: 999px;
      padding: var(--seg-btn-pad, 7px 14px);
      font: inherit;
      font-size: var(--seg-size, 13px);
      font-weight: 800;
      cursor: pointer;
      background: transparent;
      color: var(--du-ink);
      white-space: nowrap;
    }
    button[aria-pressed="true"] {
      background: var(--du-ink);
      color: var(--du-on-ink);
    }
  `;
  declare options: SegmentOption[];
  declare value: string;
  declare label: string;

  constructor() {
    super();
    this.options = [];
    this.value = "";
    this.label = "";
  }

  override render() {
    return html`<div role="group" aria-label=${this.label}>
      ${this.options.map(
        (o) =>
          html`<button type="button" aria-pressed=${o.value === this.value ? "true" : "false"} @click=${() => this.pick(o.value)}>
            ${o.icon ? html`<du-icon name=${o.icon} size="15" stroke="2"></du-icon>` : nothing}${o.label}
          </button>`,
      )}
    </div>`;
  }

  private pick(value: string) {
    if (value === this.value) return;
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("change", { detail: { value }, bubbles: true, composed: true }),
    );
  }
}

/**
 * A sheet over a dimmed screen ("New card found", "Quick add"). Closes on Escape and
 * returns focus to where it came from. Fires `close`.
 */
export class DuSheet extends LitElement {
  static override properties = {
    label: { type: String },
    persistent: { type: Boolean },
  };
  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: var(--sheet-top, 84px);
      background: var(--du-scrim);
      animation: fade 0.12s ease-out;
    }
    .sheet {
      width: var(--sheet-width, 620px);
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 120px);
      overflow: auto;
      box-sizing: border-box;
      background: var(--du-card);
      color: var(--du-ink);
      border-radius: var(--du-radius-sheet);
      padding: var(--sheet-pad, 26px 30px 24px);
      box-shadow: var(--du-shadow-sheet);
      animation: rise 0.16s ease-out;
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @keyframes rise {
      from {
        transform: translateY(8px);
        opacity: 0;
      }
    }
  `;
  declare label: string;
  /** A click outside doesn't close it (Escape still does): for things too easy to lose. */
  declare persistent: boolean;

  constructor() {
    super();
    this.label = "";
    this.persistent = false;
  }
  private returnFocus: Element | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.returnFocus = document.activeElement;
    this.addEventListener("keydown", this.onKey);
    this.addEventListener("mousedown", this.onScrim);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.onKey);
    this.removeEventListener("mousedown", this.onScrim);
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus();
  }

  override firstUpdated() {
    requestAnimationFrame(() => {
      const target = this.querySelector<HTMLElement>(
        "[autofocus], input, button, select, textarea",
      );
      target?.focus();
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.close();
    }
  };

  private onScrim = (e: MouseEvent) => {
    if (e.target === this && !this.persistent) this.close();
  };

  close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<div class="sheet" role="dialog" aria-modal="true" aria-label=${this.label}><slot></slot></div>`;
  }
}

if (!customElements.get("du-switch")) customElements.define("du-switch", DuSwitch);
if (!customElements.get("du-segmented")) customElements.define("du-segmented", DuSegmented);
if (!customElements.get("du-sheet")) customElements.define("du-sheet", DuSheet);

declare global {
  interface HTMLElementTagNameMap {
    "du-switch": DuSwitch;
    "du-segmented": DuSegmented;
    "du-sheet": DuSheet;
  }
}
