import { type AccountKind, addAccount, type Share, words } from "@duet/core";
import { INSTITUTIONS } from "@duet/importers";
import { html } from "lit";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

/** Adding an account by hand, for cash, Venmo or a card before its first statement. */
export class AccountSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    name: { state: true },
    institution: { state: true },
    owner: { state: true },
    kind: { state: true },
    usual: { state: true },
    last4: { state: true },
  };
  static override styles = [Screen.styles, sheetStyles];

  declare name: string;
  declare institution: string;
  declare owner: string;
  declare kind: AccountKind;
  declare usual: Share;
  declare last4: string;

  override connectedCallback(): void {
    super.connectedCallback();
    this.name = "";
    this.institution = "";
    this.owner = this.basics.me?.id ?? "";
    this.kind = "wallet";
    this.usual = "ours";
    this.last4 = "";
  }

  override render() {
    const b = this.basics;
    const kinds: Array<[AccountKind, string]> = [
      ["wallet", "Venmo, PayPal…"],
      ["cash", "Cash"],
      ["credit", "Credit card"],
      ["checking", "Checking"],
      ["savings", "Savings"],
    ];
    return html`<du-sheet label="Add an account" @close=${() => this.app.closeSheet()}>
      <form class="body" @submit=${this.save}>
        <div class="head"><div><h1>Add an account</h1><div class="meta">Cards and bank accounts also appear on their own after their first upload.</div></div></div>
        <label class="field">What should we call it?<input class="big-input" .value=${this.name} placeholder="Venmo" @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)} autofocus /></label>
        <div class="group">
          <span class="group-label">What kind?</span>
          <div class="choices">${kinds.map(([k, label]) => html`<button type="button" class="choice" aria-pressed=${this.kind === k ? "true" : "false"} @click=${() => (this.kind = k)}>${label}</button>`)}</div>
        </div>
        ${
          this.kind === "credit" || this.kind === "checking" || this.kind === "savings"
            ? html`<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
              <label class="field">Bank
                <input class="input" list="institutions" .value=${this.institution} @input=${(e: Event) => (this.institution = (e.target as HTMLInputElement).value)} />
                <datalist id="institutions">${INSTITUTIONS.map((i) => html`<option value=${i}></option>`)}</datalist>
              </label>
              <label class="field">Last four digits<input class="input" inputmode="numeric" maxlength="4" .value=${this.last4} @input=${(e: Event) => (this.last4 = (e.target as HTMLInputElement).value)} /></label>
            </div>`
            : ""
        }
        <div class="group">
          <span class="group-label">Whose is it?</span>
          <div class="choices">
            ${b.members.map((m) => html`<button type="button" class="choice person" aria-pressed=${this.owner === m.id ? "true" : "false"} @click=${() => (this.owner = m.id)}><du-avatar .pair=${this.app.pair} .name=${m.name} .color=${m.color} size="26"></du-avatar>${m.name}</button>`)}
          </div>
        </div>
        <div class="group">
          <span class="group-label">Purchases on it are usually</span>
          <div class="choices">
            <button type="button" class="choice" aria-pressed=${this.usual === "ours" ? "true" : "false"} @click=${() => (this.usual = "ours")}>${words.ours}</button>
            <button type="button" class="choice" aria-pressed=${this.usual === "mine" ? "true" : "false"} @click=${() => (this.usual = "mine")}>${words.mine}</button>
          </div>
        </div>
        <div class="foot">
          <button type="button" class="linkish" @click=${() => this.app.closeSheet()}>${words.notNow}</button>
          <button class="btn" ?disabled=${!this.name.trim()}>Add account</button>
        </div>
      </form>
    </du-sheet>`;
  }

  private save = async (e: Event) => {
    e.preventDefault();
    if (!this.name.trim()) return;
    const statementKind =
      this.kind === "credit" || this.kind === "checking" || this.kind === "savings";
    await addAccount(this.app.store, {
      ownerId: this.owner,
      institution: statementKind
        ? this.institution.trim() || this.name.trim()
        : this.kind === "cash"
          ? "Cash"
          : this.name.trim(),
      name: this.name,
      last4: this.last4.replace(/\D/g, "").slice(-4) || null,
      kind: this.kind,
      defaultShare: this.usual,
    });
    this.app.toast(`Added ${this.name.trim()}.`);
    this.app.closeSheet();
  };
}

customElements.define("du-account-sheet", AccountSheet);
