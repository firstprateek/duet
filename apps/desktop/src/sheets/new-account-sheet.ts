import {
  type Account,
  type AccountKind,
  addAccount,
  finishImport,
  guessAccountFromName,
  type Share,
  saveCustomProfile,
  updateAccount,
  words,
} from "@duet/core";
import { institutionBadge } from "@duet/importers";
import { css, html, nothing } from "lit";
import type { Sheet } from "../app/app.ts";
import { Screen } from "../app/screen.ts";

type NewAccountSheet = Extract<Sheet, { kind: "new-account" }>;

export const sheetStyles = css`
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .badge {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--du-sky-bg);
    font-family: var(--du-font-display);
    font-weight: 600;
    font-size: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  h1 {
    font-size: 24px;
  }
  .meta {
    font-size: 13px;
    font-weight: 700;
    color: var(--du-muted);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group-label {
    font-size: 13px;
    font-weight: 800;
    color: var(--du-ink-2);
  }
  .choices {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 9px 18px;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    background: var(--du-soft);
    color: var(--du-ink);
    border: 2px solid var(--du-soft);
  }
  .choice.person {
    padding: 6px 16px 6px 6px;
  }
  .choice[aria-pressed="true"] {
    background: var(--du-ink);
    color: var(--du-on-ink);
    border-color: var(--du-ink);
  }
  .help {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--du-muted);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--du-good-bg);
    color: var(--du-good-fg);
    border-radius: 16px;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 800;
  }
  .big-input {
    font-family: var(--du-font-display);
    font-weight: 500;
    font-size: 18px;
    color: var(--du-ink);
    background: var(--du-bg);
    border: 2px solid var(--du-ours);
    border-radius: 16px;
    padding: 11px 16px;
    outline: none;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 2px;
  }
  .mark {
    display: flex;
  }
  .mark i {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .mark i + i {
    margin-left: -5px;
  }
`;

/** "New card found": the first upload from a card or account we don't know yet. */
export class NewAccountSheetElement extends Screen {
  static override properties = {
    ...Screen.properties,
    sheet: { attribute: false },
    name: { state: true },
    owner: { state: true },
    kind: { state: true },
    usual: { state: true },
    institution: { state: true },
    existing: { state: true },
    busy: { state: true },
  };
  static override styles = [Screen.styles, sheetStyles];

  declare sheet: NewAccountSheet;
  declare name: string;
  declare owner: string;
  declare kind: AccountKind;
  declare usual: Share;
  declare institution: string;
  /** An account we already have that this file belongs to, instead of a new one. */
  declare existing: string | null;
  declare busy: boolean;

  override connectedCallback(): void {
    super.connectedCallback();
    const s = this.sheet.suggestion;
    this.name = this.sheet.mapping ? "" : s.name;
    this.owner = this.basics.me?.id ?? "";
    this.kind = s.kind;
    this.usual = "ours";
    this.institution = this.sheet.mapping ? "" : s.institution;
    this.existing = this.sheet.mapping
      ? (guessAccountFromName(this.sheet.file.name, this.candidates())?.id ?? null)
      : null;
    this.busy = false;
  }

  /**
   * Accounts this file might belong to: any of ours for a layout we matched by hand (a bank
   * changed its export), else the ones from the same bank (a replaced card).
   */
  private candidates(): Account[] {
    const s = this.sheet.suggestion;
    const all = this.basics.accounts.filter(
      (a) => !a.archived && a.kind !== "cash" && a.kind !== "wallet",
    );
    if (this.sheet.mapping) return all;
    return all.filter((a) => a.institution.toLowerCase() === s.institution.toLowerCase());
  }

  override render() {
    const s = this.sheet.suggestion;
    const file = this.sheet.file;
    const isCard = this.kind === "credit";
    const candidates = this.candidates();
    const chosen = candidates.find((a) => a.id === this.existing) ?? null;
    return html`<du-sheet label=${words.newCardFound} @close=${this.notNow}>
      <form class="body" @submit=${this.save}>
        <div class="head">
          <span class="badge"
            >${institutionBadge(chosen?.institution ?? (this.sheet.mapping ? this.institution || "?" : s.institution))}</span
          >
          <div>
            <h1>${this.sheet.mapping ? "Which account is it?" : isCard ? words.newCardFound : "New account found"}</h1>
            <div class="meta">${file.name} · ${s.rows} rows${s.last4 ? ` · ${isCard ? "card" : "account"} ending ${s.last4}` : ""}</div>
          </div>
        </div>
        ${
          candidates.length
            ? html`<div class="group">
              <span class="group-label">Is it one we have?</span>
              <div class="choices" role="group" aria-label="Account">
                ${candidates.map(
                  (
                    a,
                  ) => html`<button type="button" class="choice" aria-pressed=${this.existing === a.id ? "true" : "false"} @click=${() => (this.existing = a.id)}>
                    ${a.name}${a.last4 ? html`<span class="muted" style="font-weight:600">··${a.last4}</span>` : nothing}
                  </button>`,
                )}
                <button type="button" class="choice" aria-pressed=${this.existing ? "false" : "true"} @click=${() => (this.existing = null)}>A new one</button>
              </div>
            </div>`
            : nothing
        }
        ${
          chosen
            ? nothing
            : this.sheet.mapping
              ? html`<label class="field">Which bank is it from?
              <input class="input" .value=${this.institution} placeholder="Bread Cashback, DCU…" @input=${(
                e: Event,
              ) => {
                this.institution = (e.target as HTMLInputElement).value;
              }} />
            </label>`
              : nothing
        }
        ${chosen ? nothing : this.renderNewAccount(isCard)}
        ${s.layoutNote ? html`<div class="note"><du-icon name="check" size="14" stroke="3"></du-icon>${s.layoutNote}</div>` : nothing}
        <div class="foot">
          <button type="button" class="linkish" @click=${this.notNow}>${words.notNow}</button>
          <button class="btn" ?disabled=${(!chosen && !this.name.trim()) || this.busy}>
            ${chosen ? `Add to ${chosen.name} and sort` : isCard ? words.addCardAndSort : "Add account and sort"}<du-icon
              name="arrow-right"
              size="16"
              stroke="2.4"
            ></du-icon>
          </button>
        </div>
      </form>
    </du-sheet>`;
  }

  private renderNewAccount(isCard: boolean) {
    const b = this.basics;
    const kinds: Array<[AccountKind, string]> = [
      ["credit", "Credit card"],
      ["checking", "Checking"],
      ["savings", "Savings"],
    ];
    return html`        <label class="field">What should we call it?
        <input class="big-input" .value=${this.name} @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)} autofocus />
      </label>
      <div class="group">
        <span class="group-label">Whose ${isCard ? "card" : "account"} is it?</span>
        <div class="choices" role="group" aria-label="Whose">
          ${b.members.map(
            (
              m,
            ) => html`<button type="button" class="choice person" aria-pressed=${this.owner === m.id ? "true" : "false"} @click=${() => (this.owner = m.id)}>
              <du-avatar .pair=${this.app.pair} .name=${m.name} .color=${m.color} size="26"></du-avatar>${m.name}
            </button>`,
          )}
        </div>
      </div>
      <div class="group">
        <span class="group-label">What kind?</span>
        <div class="choices" role="group" aria-label="Account kind">
          ${kinds.map(
            ([k, label]) =>
              html`<button type="button" class="choice" aria-pressed=${this.kind === k ? "true" : "false"} @click=${() => (this.kind = k)}>${label}</button>`,
          )}
        </div>
      </div>
      <div class="group">
        <span class="group-label">Purchases on it are usually</span>
        <div class="choices" role="group" aria-label="Usually for">
          <button type="button" class="choice" aria-pressed=${this.usual === "ours" ? "true" : "false"} @click=${() => (this.usual = "ours")}>
            <span class="mark"><i style="background:${b.first!.color}"></i><i style="background:${b.second!.color}"></i></span>${words.ours}
          </button>
          <button type="button" class="choice" aria-pressed=${this.usual === "mine" ? "true" : "false"} @click=${() => (this.usual = "mine")}>${words.mine}</button>
        </div>
        <span class="help">Every row from this ${isCard ? "card" : "account"} starts this way. You can still change any of them while sorting.</span>
      </div>`;
  }

  private notNow = () => this.app.closeSheet(undefined);

  private save = async (e: Event) => {
    e.preventDefault();
    const chosen = this.candidates().find((a) => a.id === this.existing) ?? null;
    if (!chosen && !this.name.trim()) return;
    this.busy = true;
    try {
      const s = this.sheet.suggestion;
      let file = this.sheet.file;
      const institution = chosen?.institution ?? (this.institution.trim() || s.institution);
      if (this.sheet.mapping) {
        const profile = await saveCustomProfile(this.app.store, {
          institution,
          headers: file.parsed.headers,
          mapping: this.sheet.mapping,
        });
        file = { ...file, parsed: { ...file.parsed, profileId: profile.id, institution } };
      }
      let accountId: string;
      if (chosen) {
        // Next time a file like this goes straight to this account.
        accountId = chosen.id;
        const profileId = file.parsed.profileId;
        if (
          (profileId && chosen.profileId !== profileId) ||
          (s.last4 && chosen.last4 !== s.last4)
        ) {
          await updateAccount(this.app.store, chosen.id, {
            ...(profileId ? { profileId } : {}),
            ...(s.last4 ? { last4: s.last4 } : {}),
          });
        }
      } else {
        accountId = await addAccount(this.app.store, {
          ownerId: this.owner,
          institution,
          name: this.name,
          last4: s.last4,
          kind: this.kind,
          defaultShare: this.usual,
          profileId: file.parsed.profileId,
        });
      }
      const outcome = await finishImport(
        this.app.store,
        { fileName: file.name, bytes: file.bytes, parsed: file.parsed, path: file.path },
        accountId,
      );
      this.app.closeSheet(outcome.status === "ready" ? outcome.fileId : undefined);
    } finally {
      this.busy = false;
    }
  };
}

customElements.define("du-new-account-sheet", NewAccountSheetElement);
