import { words } from "@duet/core";
import { css, html, nothing } from "lit";
import "../screens/month-screen.ts";
import "../screens/history-screen.ts";
import "../screens/trends-screen.ts";
import "../screens/uploads-screen.ts";
import "../screens/sort-screen.ts";
import "../screens/add-screen.ts";
import "../screens/settings-screen.ts";
import "../screens/transactions-screen.ts";
import "../screens/setup-screen.ts";
import "../sheets/quick-add.ts";
import "../sheets/new-account-sheet.ts";
import "../sheets/column-match-sheet.ts";
import "../sheets/clean-slate-sheet.ts";
import "../sheets/rhythm-sheet.ts";
import "../sheets/transaction-sheet.ts";
import "../sheets/account-sheet.ts";
import "../sheets/phrase-sheet.ts";
import "../sheets/sync-sheets.ts";
import { Screen } from "./screen.ts";
import { uploadFiles } from "./uploads.ts";

/** The window: header with the tabs, the current screen, sheets and quick add on top. */
export class DuetApp extends Screen {
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: var(--du-bg);
      }
      header {
        height: 76px;
        flex-shrink: 0;
        padding: 0 32px;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        -webkit-user-select: none;
        user-select: none;
      }
      nav {
        display: flex;
        align-items: center;
        gap: 2px;
        background: var(--du-card);
        border-radius: 999px;
        padding: 5px;
        box-shadow: var(--du-shadow-nav);
      }
      nav a {
        text-decoration: none;
        color: var(--du-ink);
        border-radius: 999px;
        padding: 8px 16px;
        font-size: 14px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 7px;
        white-space: nowrap;
      }
      nav a[aria-current="page"] {
        background: var(--du-ink);
        color: var(--du-on-ink);
        padding: 8px 18px;
      }
      nav .badge {
        background: var(--du-ours);
        color: #2b2536;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 800;
        padding: 1px 7px;
      }
      .right {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
      }
      .settings {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--du-card);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--du-shadow-small);
        color: var(--du-ink);
        border: 0;
        cursor: pointer;
      }
      .settings[aria-current="page"] {
        background: var(--du-ink);
        color: var(--du-on-ink);
      }
      .pair {
        display: flex;
      }
      .pair du-avatar + du-avatar {
        margin-left: -8px;
      }
      main {
        flex-grow: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .toasts {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 60;
        pointer-events: none;
      }
      .toast {
        background: var(--du-ink);
        color: var(--du-on-ink);
        border-radius: 999px;
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 700;
        box-shadow: var(--du-shadow-sheet);
      }
    `,
  ];

  private unsubscribeDrop: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
  }

  override updated(): void {
    if (this.app && !this.unsubscribeDrop) {
      this.unsubscribeDrop = this.app.platform.onFileDrop((files) => {
        if (this.app.basics.get()?.setUp && files.length) void uploadFiles(this.app, files);
      });
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    this.unsubscribeDrop?.();
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (this.app?.basics.get()?.setUp) this.app.quickAdd.set(true);
    }
  };

  override render() {
    if (!this.app) return nothing;
    const basics = this.app.basics.get();
    if (!basics) return nothing;
    if (!basics.setUp) {
      return html`<du-setup-screen .app=${this.app}></du-setup-screen>${this.renderSheet()}${this.renderToasts()}`;
    }
    const route = this.app.route.get();
    const tab =
      route.name === "month" || route.name === "history" || route.name === "transactions"
        ? "month"
        : route.name === "uploads"
          ? "uploads"
          : route.name === "sort" || route.name === "add"
            ? "sort"
            : route.name;
    const current = (name: string) => (tab === name ? "page" : undefined);
    return html`
      <header>
        <du-logo .first=${basics.first?.color ?? "#2F6FB0"} .second=${basics.second?.color ?? "#F5C451"}></du-logo>
        <nav aria-label="Main">
          <a href="#/month" aria-current=${current("month") ?? "false"}>${words.thisMonth}</a>
          <a href="#/uploads" aria-current=${current("uploads") ?? "false"}>${words.uploads}</a>
          <a href="#/sort" aria-current=${current("sort") ?? "false"}
            >${words.toSort}${basics.toSort > 0 ? html`<span class="badge">${basics.toSort}</span>` : nothing}</a
          >
          <a href="#/trends" aria-current=${current("trends") ?? "false"}>${words.trends}</a>
        </nav>
        <div class="right">
          <button class="btn ours small" style="padding:9px 16px;font-size:14px" @click=${() => this.app.quickAdd.set(true)}>
            <du-icon name="plus" size="14" stroke="2.6"></du-icon>${words.quickAdd}
          </button>
          <a class="settings" href="#/settings" aria-label=${words.settings} aria-current=${current("settings") ?? "false"}>
            <du-icon name="sliders" size="18"></du-icon>
          </a>
          <span class="pair">
            ${basics.first ? html`<du-avatar ring .name=${basics.first.name} .color=${basics.first.color}></du-avatar>` : nothing}
            ${basics.second ? html`<du-avatar ring .name=${basics.second.name} .color=${basics.second.color}></du-avatar>` : nothing}
          </span>
        </div>
      </header>
      <main>${this.renderRoute()}</main>
      ${this.renderSheet()}
      ${this.app.quickAdd.get() ? html`<du-quick-add .app=${this.app}></du-quick-add>` : nothing}
      ${this.renderToasts()}
    `;
  }

  private renderToasts() {
    return html`<div class="toasts" role="status" aria-live="polite">
      ${this.app.toasts.get().map((t) => html`<div class="toast">${t.text}</div>`)}
    </div>`;
  }

  private renderRoute() {
    const route = this.app.route.get();
    const month = "month" in route && route.month ? route.month : this.basics.latestMonth;
    switch (route.name) {
      case "month":
        return html`<du-month-screen .app=${this.app} .month=${month}></du-month-screen>`;
      case "history":
        return html`<du-history-screen .app=${this.app} .month=${month}></du-history-screen>`;
      case "uploads":
        return html`<du-uploads-screen .app=${this.app} .month=${month}></du-uploads-screen>`;
      case "sort":
        return html`<du-sort-screen .app=${this.app} .fileId=${route.fileId}></du-sort-screen>`;
      case "add":
        return html`<du-add-screen .app=${this.app} .fileId=${route.fileId}></du-add-screen>`;
      case "trends":
        return html`<du-trends-screen .app=${this.app}></du-trends-screen>`;
      case "transactions":
        return html`<du-transactions-screen
          .app=${this.app}
          .month=${route.month}
          .categoryId=${route.categoryId}
        ></du-transactions-screen>`;
      case "settings":
        return html`<du-settings-screen .app=${this.app}></du-settings-screen>`;
      case "setup":
        return html`<du-month-screen .app=${this.app} .month=${month}></du-month-screen>`;
    }
  }

  private renderSheet() {
    const sheet = this.app.sheet.get();
    if (!sheet) return nothing;
    switch (sheet.kind) {
      case "new-account":
        return html`<du-new-account-sheet .app=${this.app} .sheet=${sheet}></du-new-account-sheet>`;
      case "column-match":
        return html`<du-column-match-sheet .app=${this.app} .sheet=${sheet}></du-column-match-sheet>`;
      case "clean-slate":
        return html`<du-clean-slate-sheet .app=${this.app} .sheet=${sheet}></du-clean-slate-sheet>`;
      case "rhythm":
        return html`<du-rhythm-sheet .app=${this.app}></du-rhythm-sheet>`;
      case "transaction":
        return html`<du-transaction-sheet .app=${this.app} .transactionId=${sheet.id}></du-transaction-sheet>`;
      case "add-account":
        return html`<du-account-sheet .app=${this.app}></du-account-sheet>`;
      case "sync-setup":
        return html`<du-sync-setup-sheet .app=${this.app}></du-sync-setup-sheet>`;
      case "phrase":
        return html`<du-phrase-sheet .app=${this.app} .sheet=${sheet}></du-phrase-sheet>`;
      case "join-code":
        return html`<du-join-code-sheet .app=${this.app}></du-join-code-sheet>`;
      case "devices":
        return html`<du-devices-sheet .app=${this.app}></du-devices-sheet>`;
      case "message":
        return html`<du-sheet label=${sheet.title} @close=${() => this.app.closeSheet()}>
          <h2 style="font-size:22px;margin-bottom:10px">${sheet.title}</h2>
          <p style="margin:0 0 18px;line-height:1.5;font-weight:600">${sheet.body}</p>
          <button class="btn" @click=${() => this.app.closeSheet()}>OK</button>
        </du-sheet>`;
    }
  }
}

customElements.define("duet-app", DuetApp);
