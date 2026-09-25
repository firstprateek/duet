import {
  type Account,
  addCategory,
  type Category,
  dayLabel,
  getSharePlans,
  monthName,
  renameMember,
  replacePhrase,
  rhythmLabel,
  type SharePlan,
  setLocalSettings,
  sortingStats,
  updateAccount,
  updateCategory,
  words,
} from "@duet/core";
import { institutionBadge } from "@duet/importers";
import { tint } from "@duet/ui";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";
import { timeAgo } from "../app/sync.ts";
import type { UpdateInfo } from "../platform/index.ts";

interface SettingsData {
  plans: SharePlan[];
  stats: { month: string | null; total: number; withoutHelp: number };
  version: string;
}

/** Settings: us, Ebb & flow, appearance, Our rhythm, sync, sorting, accounts, categories, updates. */
export class SettingsScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    editing: { state: true },
    available: { state: true },
    confirmPhrase: { state: true },
    checking: { state: true },
    newCategory: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 10px 32px 32px;
      }
      .cols {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .col {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      section.card {
        padding: 22px 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .person {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .person .name {
        font-size: 16px;
        font-weight: 800;
      }
      .person .sub {
        font-size: 13px;
        font-weight: 600;
        color: var(--du-muted);
      }
      .line {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .line .grow {
        flex-grow: 1;
        font-size: 14.5px;
        font-weight: 800;
      }
      select {
        border: 0;
        background: var(--du-bg);
        border-radius: 12px;
        padding: 8px 10px;
        font-size: 13.5px;
        font-weight: 700;
      }
      .ratio {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 56px;
        line-height: 1;
      }
      .ratio span {
        color: var(--du-faint);
      }
      .track {
        position: relative;
        height: 28px;
      }
      .track .fill {
        display: flex;
        height: 28px;
        border-radius: 999px;
        overflow: hidden;
      }
      .knob {
        position: absolute;
        top: -3px;
        margin-left: -17px;
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        border-radius: 50%;
        background: #ffffff;
        border: 3px solid var(--du-ink);
      }
      .split {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        font-weight: 800;
      }
      .sticky {
        align-self: flex-start;
        background: #fff1c9;
        color: #5e4800;
        border-radius: 14px;
        padding: 10px 14px;
        font-size: 13.5px;
        font-weight: 700;
        transform: rotate(-1.2deg);
      }
      .before {
        display: flex;
        justify-content: space-between;
        font-size: 13.5px;
        font-weight: 700;
        color: var(--du-muted);
        padding-top: 12px;
      }
      .mono {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--du-ink-2);
        background: var(--du-bg);
        border-radius: 12px;
        padding: 8px 12px;
      }
      .big {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 30px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .wide {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .acct {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        font-weight: 700;
      }
      .acct .badge {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--du-soft);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 13px;
      }
      .acct .meta {
        font-size: 12.5px;
        color: var(--du-muted);
        font-weight: 600;
      }
      .cats {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 800;
      }
      .kids {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding-left: 40px;
      }
      .kid {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 6px 4px 12px;
        font-size: 13px;
        font-weight: 700;
      }
      .kid button {
        border: 0;
        background: none;
        cursor: pointer;
        color: inherit;
        opacity: 0.6;
        display: flex;
      }
      .kid.archived {
        opacity: 0.5;
        text-decoration: line-through;
      }
      .add-cat {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .add-cat input {
        flex-grow: 1;
      }
      .inline-edit {
        display: flex;
        gap: 8px;
      }
    `,
  ];

  declare editing: string | null;
  declare available: UpdateInfo | null | undefined;
  declare confirmPhrase: boolean;
  declare checking: boolean;
  declare newCategory: { name: string; parentId: string };

  private data = new Loader<SettingsData>(
    this,
    () => this.app,
    async () => {
      const [plans, stats, version] = await Promise.all([
        getSharePlans(this.app.store),
        sortingStats(this.app.store),
        this.app.platform.appVersion(),
      ]);
      return { plans, stats, version };
    },
  );

  constructor() {
    super();
    this.editing = null;
    this.available = undefined;
    this.confirmPhrase = false;
    this.checking = false;
    this.newCategory = { name: "", parentId: "food" };
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    const b = this.basics;
    const s = b.settings;
    const first = b.first!;
    const second = b.second!;
    const plans = v.plans;
    const current = plans[plans.length - 1];
    const previous = plans[plans.length - 2];
    const bp = current?.firstBp ?? 5000;
    const changedByPartner = !!current?.changedBy && current.changedBy !== b.me?.id;
    const pct = Math.round(bp / 100);
    return html`
      <h1>${words.settings}</h1>
      <div class="cols">
        <div class="col">
          <section class="card">
            <h2>The two of us</h2>
            ${[first, second].map((m) => this.renderPerson(m.id, m.name, m.color))}
          </section>
          <section class="card">
            <h2>${words.ebbFlow}</h2>
            <div class="line">
              <div class="grow">${words.alwaysShowEbbFlow}</div>
              <du-switch
                .checked=${s.alwaysShowEbbFlow}
                label=${words.alwaysShowEbbFlow}
                @change=${(e: CustomEvent<{ checked: boolean }>) => setLocalSettings(this.app.store, { alwaysShowEbbFlow: e.detail.checked })}
              ></du-switch>
            </div>
            <div class="line">
              <label class="grow" for="evened">A ${words.cleanSlate} evens out</label>
              <select
                id="evened"
                .value=${s.cleanSlateDefault}
                @change=${(e: Event) => setLocalSettings(this.app.store, { cleanSlateDefault: (e.target as HTMLSelectElement).value as "month" | "overall" })}
              >
                <option value="month">This month</option>
                <option value="overall">Everything so far</option>
              </select>
            </div>
          </section>
          <section class="card">
            <h2>Appearance</h2>
            <du-segmented
              label="Appearance"
              style="--seg-size:13px;--seg-btn-pad:8px 12px"
              .options=${[
                { value: "auto", label: "Match my Mac", icon: "auto" },
                { value: "light", label: "Light", icon: "sun" },
                { value: "dark", label: "Dark", icon: "moon" },
              ]}
              .value=${s.appearance}
              @change=${(e: CustomEvent<{ value: "auto" | "light" | "dark" }>) => setLocalSettings(this.app.store, { appearance: e.detail.value })}
            ></du-segmented>
          </section>
        </div>
        <div class="col">
          <section class="card">
            <h2>${words.ourRhythm}</h2>
            <div class="ratio">${pct} <span>/</span> ${100 - pct}</div>
            ${current ? html`<div style="font-size:13.5px;font-weight:700;color:var(--du-ink-2)">Since ${monthName(current.fromMonth, true)}</div>` : nothing}
            <div class="track">
              <div class="fill"><div style="flex:${pct} 1 0;background:${first.color}"></div><div style="flex:${100 - pct} 1 0;background:${second.color}"></div></div>
              <span class="knob" style="left:${pct}%"></span>
            </div>
            <div class="split"><span>${first.name} ${pct}%</span><span>${second.name} ${100 - pct}%</span></div>
            ${
              changedByPartner && current
                ? html`<div class="sticky">${this.app.nameOf(current.changedBy)} updated this on ${dayLabel(current.createdAt.slice(0, 10))}</div>`
                : nothing
            }
            ${
              previous
                ? html`<div class="before dotted-top"><span>Before</span><span>${rhythmLabel(previous.firstBp)} · ${this.rangeLabel(previous, current)}</span></div>`
                : nothing
            }
            <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
              <button class="btn" @click=${() => this.app.openSheet({ kind: "rhythm" })}>Change</button>
              <button class="linkish" @click=${() => this.app.openSheet({ kind: "rhythm" })}>Work it out from salaries</button>
            </div>
          </section>
        </div>
        <div class="col">
          ${this.renderSync()}
          <section class="card">
            <h2>Smart sorting</h2>
            ${
              v.stats.total
                ? html`<div class="big">${Math.round((v.stats.withoutHelp / v.stats.total) * 100)}%</div>
                  <div style="font-size:13.5px;font-weight:700;color:var(--du-ink-2)">of ${monthName(v.stats.month ?? b.latestMonth)} sorted without help</div>`
                : html`<div style="font-size:13.5px;font-weight:700;color:var(--du-ink-2)">Sorting learns from every statement you sort.</div>`
            }
            <div class="chips">
              <span class="pill good">Rules and history</span>
              ${this.renderModels()}
            </div>
          </section>
          <section class="card">
            <h2>Updates</h2>
            <div style="font-size:13.5px;font-weight:700;color:var(--du-ink-2)">Duet ${v.version}</div>
            ${
              this.available
                ? html`<div class="line">
                  <div class="grow">Version ${this.available.version} is ready</div>
                  <button class="btn small" @click=${() => this.available?.install()}>Update and restart</button>
                </div>`
                : html`<button class="btn soft small" style="align-self:flex-start" ?disabled=${this.checking} @click=${this.checkUpdate}>
                  ${this.checking ? "Checking…" : this.available === null ? "You're up to date" : "Check for updates"}
                </button>`
            }
          </section>
        </div>
      </div>
      <div class="wide">
        <section class="card">
          <div class="line"><h2 style="flex-grow:1">Accounts</h2><button class="btn soft small" @click=${() => this.app.openSheet({ kind: "add-account" })}>Add an account</button></div>
          ${b.accounts.filter((a) => !a.archived).map((a) => this.renderAccount(a))}
          ${
            b.accounts.some((a) => a.archived)
              ? html`<details><summary class="linkish muted">Archived</summary>${b.accounts.filter((a) => a.archived).map((a) => this.renderAccount(a))}</details>`
              : nothing
          }
        </section>
        <section class="card">
          <h2>Categories</h2>
          <div class="cats">${this.renderCategories(b.categories)}</div>
          <div class="add-cat">
            <input class="input" placeholder="New category" .value=${this.newCategory.name} @input=${(e: Event) => (this.newCategory = { ...this.newCategory, name: (e.target as HTMLInputElement).value })} />
            <select .value=${this.newCategory.parentId} @change=${(e: Event) => (this.newCategory = { ...this.newCategory, parentId: (e.target as HTMLSelectElement).value })}>
              ${b.categories.filter((c) => !c.parentId).map((c) => html`<option value=${c.id} ?selected=${c.id === this.newCategory.parentId}>in ${c.name}</option>`)}
            </select>
            <button class="btn small" ?disabled=${!this.newCategory.name.trim()} @click=${this.addCategory}>Add</button>
          </div>
        </section>
      </div>
    `;
  }

  private renderPerson(id: string, name: string, color: string) {
    const isMe = id === this.basics.me?.id;
    if (this.editing === id) {
      return html`<div class="person">
        <du-avatar .name=${name} .color=${color} size="48"></du-avatar>
        <form
          class="inline-edit"
          @submit=${async (e: Event) => {
            e.preventDefault();
            const value = new FormData(e.target as HTMLFormElement).get("name") as string;
            if (value.trim()) await renameMember(this.app.store, id, value);
            this.editing = null;
          }}
        >
          <input class="input" name="name" .value=${name} autofocus />
          <button class="btn small">Save</button>
        </form>
      </div>`;
    }
    return html`<div class="person">
      <du-avatar .name=${name} .color=${color} size="48"></du-avatar>
      <div style="flex-grow:1">
        <div class="name">${name}</div>
        <div class="sub">${isMe ? "This Mac" : "Their Mac"}</div>
      </div>
      <button class="linkish" @click=${() => (this.editing = id)}>Edit</button>
    </div>`;
  }

  private renderAccount(a: Account) {
    return html`<div class="acct">
      <span class="badge">${a.kind === "cash" ? html`<du-icon name="cash" size="16"></du-icon>` : institutionBadge(a.institution)}</span>
      <div style="min-width:0">
        <div>${a.name}${a.last4 ? html` <span class="meta">··${a.last4}</span>` : nothing}</div>
        <div class="meta">${this.app.nameOf(a.ownerId)} · usually ${a.defaultShare === "ours" ? words.ours : words.mine}</div>
      </div>
      <select
        aria-label="Usually"
        .value=${a.defaultShare}
        @change=${(e: Event) => updateAccount(this.app.store, a.id, { defaultShare: (e.target as HTMLSelectElement).value as "ours" | "mine" })}
      >
        <option value="ours">${words.ours}</option>
        <option value="mine">${words.mine}</option>
      </select>
      <button class="linkish muted" @click=${() => updateAccount(this.app.store, a.id, { archived: !a.archived })}>${a.archived ? "Restore" : "Archive"}</button>
    </div>`;
  }

  private renderCategories(categories: Category[]) {
    const tops = categories.filter((c) => !c.parentId);
    return tops.map(
      (top) => html`<div class="group">
        <div class="group-head"><du-bubble .icon=${top.icon} .color=${top.bubble} size="30"></du-bubble>${top.name}</div>
        <div class="kids">
          ${categories
            .filter((c) => c.parentId === top.id)
            .map(
              (
                c,
              ) => html`<span class="kid ${c.archived ? "archived" : ""}" style="background:${tint(top.bubble)}">
                ${c.name}
                <button
                  aria-label=${c.archived ? `Restore ${c.name}` : `Archive ${c.name}`}
                  title=${c.archived ? "Restore" : "Archive"}
                  @click=${() => updateCategory(this.app.store, c.id, { archived: !c.archived })}
                >
                  <du-icon .name=${c.archived ? "refresh" : "x"} size="12" stroke="2.4"></du-icon>
                </button>
              </span>`,
            )}
        </div>
      </div>`,
    );
  }

  private rangeLabel(previous: SharePlan, current: SharePlan | undefined): string {
    const from = monthName(previous.fromMonth).slice(0, 3);
    if (!current) return `from ${from} ${previous.fromMonth.slice(0, 4)}`;
    const [y, m] = current.fromMonth.split("-").map(Number) as [number, number];
    const endMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const to = monthName(endMonth).slice(0, 3);
    return `${from}–${to} ${endMonth.slice(0, 4)}`;
  }

  private renderSync() {
    const status = this.app.sync.status.get();
    const partner = this.basics.partner;
    const promise = html`<p style="margin:0;font-size:13.5px;font-weight:600;line-height:1.5">Locked end to end. The Mac mini only stores encrypted data.</p>`;
    if (status.state === "off") {
      return html`<section class="card">
        <h2>Sync &amp; security</h2>
        <div class="line">
          <du-bubble icon="server" color="var(--du-sky-bg)" size="44"></du-bubble>
          <div>
            <div style="font-size:15px;font-weight:800">Not connected yet</div>
            <div style="font-size:13px;font-weight:600;color:var(--du-muted)">Works on this Mac for now</div>
          </div>
        </div>
        ${promise}
        <div><button class="btn small" @click=${() => this.app.openSheet({ kind: "sync-setup" })}>Set up sync</button></div>
      </section>`;
    }
    const healthy = status.state === "ok" || status.state === "syncing";
    const title =
      status.state === "stopped"
        ? "Sync is paused"
        : status.state === "offline"
          ? "Mac mini is away"
          : "Mac mini is home";
    const detail =
      status.state === "ok"
        ? `Synced ${timeAgo(status.lastAt)}`
        : status.state === "syncing"
          ? "Syncing…"
          : status.state === "offline"
            ? `${status.message} Changes wait here and go out later.`
            : status.message;
    const host = (this.app.sync.relayUrl.get() ?? "").replace(/^https?:\/\//, "");
    return html`<section class="card">
      <h2>Sync &amp; security</h2>
      <div class="line">
        <du-bubble icon="server" color=${healthy ? "var(--du-good-bg)" : "var(--du-warn-bg)"} size="44"></du-bubble>
        <div class="grow">
          <div style="font-size:15px;font-weight:800">${title}</div>
          <div style="font-size:13px;font-weight:600;color:var(--du-muted)">${detail}</div>
        </div>
        <button class="linkish" @click=${() => void this.app.sync.syncNow()}>Sync now</button>
      </div>
      <div class="mono">${host}</div>
      ${promise}
      <div class="line">
        <span class="grow" style="font-size:14px;font-weight:800">Recovery phrase</span>
        ${
          this.confirmPhrase
            ? html`<span style="font-size:12.5px;font-weight:700;color:var(--du-muted)">The old one stops working.</span>
                <button class="linkish muted" @click=${() => (this.confirmPhrase = false)}>Keep it</button>
                <button class="linkish" @click=${this.newPhrase}>Make a new one</button>`
            : html`<button class="linkish" @click=${() => (this.confirmPhrase = true)}>Make a new one</button>`
        }
      </div>
      <div class="line">
        <span class="grow" style="font-size:14px;font-weight:800">Our devices</span>
        <button class="linkish" @click=${() => this.app.openSheet({ kind: "devices" })}>See all</button>
      </div>
      ${
        partner
          ? html`<div><button class="btn small soft" @click=${() => this.app.openSheet({ kind: "join-code" })}>Join code for ${partner.name}</button></div>`
          : nothing
      }
    </section>`;
  }

  private renderModels() {
    const sorter = this.app.sorting.sorter.get();
    if (sorter.state === "off") return html`<span class="pill">Mac mini models not set up</span>`;
    if (sorter.state === "checking") return html`<span class="pill">Asking the Mac mini…</span>`;
    if (sorter.state === "away")
      return html`<span class="pill warn" title=${sorter.message}>Mac mini models away</span>`;
    const h = sorter.health;
    const ready = [
      h.embed.ready ? "Embeddings ready" : null,
      h.llm.ready ? "Small LLM ready" : null,
      h.laya.ready ? "Laya trained" : null,
    ].filter((x): x is string => !!x);
    if (ready.length === 0)
      return html`<span class="pill warn">Mac mini models not pulled yet</span>`;
    return ready.map((label) => html`<span class="pill good">${label}</span>`);
  }

  private newPhrase = async () => {
    this.confirmPhrase = false;
    try {
      const phrase = await replacePhrase(this.app.store, this.app.platform.secret);
      this.app.openSheet({ kind: "phrase", phrase });
    } catch (error) {
      this.app.toast(
        error instanceof Error ? error.message : "Couldn't make a new phrase right now.",
      );
    }
  };

  private addCategory = async () => {
    const name = this.newCategory.name.trim();
    if (!name) return;
    await addCategory(
      this.app.store,
      { name, parentId: this.newCategory.parentId },
      this.basics.categories,
    );
    this.newCategory = { ...this.newCategory, name: "" };
    this.app.toast(`Added ${name}.`);
  };

  private checkUpdate = async () => {
    this.checking = true;
    try {
      this.available = await this.app.platform.checkForUpdate();
    } catch {
      this.app.toast("Couldn't check for updates right now.");
    } finally {
      this.checking = false;
    }
  };
}

customElements.define("du-settings-screen", SettingsScreen);
