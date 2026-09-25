import {
  type Account,
  type AccountCoverage,
  accountCoverage,
  addMonths,
  dayLabel,
  fileCoversMonth,
  getFiles,
  guessAccountFromName,
  type MonthKey,
  monthName,
  type StatementFile,
  words,
} from "@duet/core";
import { institutionBadge } from "@duet/importers";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";
import { uploadFiles } from "../app/uploads.ts";

interface UploadsData {
  files: StatementFile[];
  waiting: StatementFile[];
  coverage: AccountCoverage[];
  earlier: Array<{ month: MonthKey; files: number; missing: number }>;
}

const BADGE_COLORS = [
  "var(--du-sky-bg)",
  "var(--du-mine-bg)",
  "var(--du-peach-bg)",
  "var(--du-butter-bg)",
  "var(--du-pink-bg)",
  "var(--du-good-bg)",
];

function overlaps(file: StatementFile, month: MonthKey): boolean {
  return fileCoversMonth(file.firstDate, file.lastDate, month);
}

/** Uploads: every file we've uploaded for the month, and which of our accounts are still missing. */
export class UploadsScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    month: { type: String },
    dragging: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 800fr) minmax(0, 398fr);
        gap: 18px;
        padding: 10px 32px 24px;
        align-items: start;
      }
      h1 {
        margin-bottom: 16px;
      }
      h1 .muted {
        font-weight: 500;
      }
      .files {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .file {
        border-radius: 24px;
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .file-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .badge {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--du-ink);
      }
      .file-name {
        font-size: 15px;
        font-weight: 800;
      }
      .file-meta {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--du-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .file-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .file-foot a,
      .file-foot button {
        font-size: 13.5px;
        font-weight: 800;
      }
      .missing {
        margin-top: 14px;
        border: 2px dashed var(--du-dash);
        border-radius: 24px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .missing .badge {
        background: var(--du-soft);
        color: var(--du-muted);
      }
      .earlier {
        margin-top: 18px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .earlier span {
        font-size: 13.5px;
        font-weight: 800;
        color: var(--du-ink-2);
        margin-right: 4px;
      }
      aside {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .drop {
        background: var(--du-card);
        border: 2px dashed var(--du-dash);
        border-radius: 26px;
        padding: 26px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        text-align: center;
        transition: border-color 0.12s, background 0.12s;
      }
      .drop.over {
        border-color: var(--du-ours);
        background: var(--du-ours-bg);
      }
      .drop .big {
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 21px;
      }
      .drop p {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--du-muted);
        line-height: 1.45;
      }
      .accounts {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .acct {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 700;
      }
      .state {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-sizing: border-box;
      }
      .state.ok {
        background: var(--du-good-bg);
        color: var(--du-good-fg);
      }
      .state.todo {
        border: 2px dashed var(--du-dash-2);
      }
      .state.setup {
        background: var(--du-warn-bg);
        color: var(--du-warn-fg);
        font-family: var(--du-font-display);
        font-size: 12px;
      }
      .foot-note {
        margin: 4px 0 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--du-muted);
      }
    `,
  ];

  declare month: MonthKey;
  declare dragging: boolean;

  private data = new Loader<UploadsData>(
    this,
    () => this.app,
    async () => {
      const me = this.app.store.memberId;
      const all = await getFiles(this.app.store);
      const coverage = (await accountCoverage(this.app.store, this.month)).filter(
        (c) => c.account.ownerId === me,
      );
      const earlier: UploadsData["earlier"] = [];
      for (let i = 1; i <= 3; i++) {
        const m = addMonths(this.month, -i);
        const files = all.filter((f) => overlaps(f, m));
        if (files.length === 0) continue;
        const cov = (await accountCoverage(this.app.store, m)).filter(
          (c) => c.account.ownerId === me,
        );
        earlier.push({
          month: m,
          files: files.length,
          missing: cov.filter((c) => !c.covered).length,
        });
      }
      return {
        files: all.filter((f) => f.status !== "needs-setup" && overlaps(f, this.month)),
        // Waiting files show in their month, or everywhere when we couldn't read their dates.
        waiting: all.filter(
          (f) => f.status === "needs-setup" && (!f.firstDate || overlaps(f, this.month)),
        ),
        coverage,
        earlier,
      };
    },
    () => this.month,
  );

  constructor() {
    super();
    this.dragging = false;
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    const b = this.basics;
    const accountById = new Map(b.accounts.map((a) => [a.id, a]));
    const missing = v.coverage.filter((c) => !c.covered);
    const covered = v.coverage.filter((c) => c.covered).length;
    // In first, then waiting for their setup, then still to come.
    const rank = (c: AccountCoverage) => (c.needsSetup ? 1 : c.covered ? 0 : 2);
    const listed = [...v.coverage].sort((a, b) => rank(a) - rank(b));
    const mine = b.accounts.filter((a) => a.ownerId === b.me?.id);
    const name = monthName(this.month);
    return html`
      <section>
        <h1>${words.uploads} <span class="muted">· ${name}</span></h1>
        ${
          v.files.length || v.waiting.length
            ? html`<div class="files">
              ${v.files.map((f, i) => this.renderFile(f, accountById.get(f.accountId ?? ""), i))}
              ${v.waiting.map((f) => this.renderWaiting(f, guessAccountFromName(f.fileName, mine)))}
            </div>`
            : html`<p class="muted" style="font-weight:600;margin:0 0 6px">Nothing uploaded for ${name} yet.</p>`
        }
        ${missing.map(
          (c) => html`<div class="missing">
            <span class="badge">${institutionBadge(c.account.institution)}</span>
            <div style="flex-grow:1">
              <div class="file-name">${c.account.name}</div>
              <div class="file-meta" style="font-size:13px">${words.stillWaiting(this.month)}</div>
            </div>
            <button class="btn small" style="padding:9px 18px;font-size:14px" @click=${this.pick}>${words.upload}</button>
          </div>`,
        )}
        ${
          v.earlier.length
            ? html`<div class="earlier">
              <span>Earlier</span>
              ${v.earlier.map(
                (
                  e,
                ) => html`<button class="btn white small" style="font-weight:700" @click=${() => this.app.navigate({ name: "uploads", month: e.month })}>
                  ${monthName(e.month)} · ${e.files} ${e.files === 1 ? "file" : "files"} · ${e.missing === 0 ? "all in" : `${e.missing} missing`}
                </button>`,
              )}
            </div>`
            : nothing
        }
      </section>
      <aside>
        <section
          class="drop ${this.dragging ? "over" : ""}"
          @dragenter=${() => (this.dragging = true)}
          @dragleave=${() => (this.dragging = false)}
          @drop=${() => (this.dragging = false)}
        >
          ${this.illustration()}
          <div class="big">Drop statements here</div>
          <p>CSV, XLSX, OFX or QFX.<br />One month or a whole year.</p>
          <button class="btn" style="margin-top:6px;padding:10px 22px" @click=${this.pick}>Choose files</button>
        </section>
        ${
          v.coverage.length
            ? html`<section class="card accounts">
              <h2 style="margin-bottom:2px">Your accounts for ${name}</h2>
              ${listed.map(
                (c) => html`<div class="acct" style=${c.covered ? "" : "color:var(--du-muted)"}>
                  ${
                    c.needsSetup
                      ? html`<span class="state setup" aria-label="Waiting for its setup">!</span>`
                      : c.covered
                        ? html`<span class="state ok"><du-icon name="check" size="12" stroke="3.2"></du-icon></span>`
                        : html`<span class="state todo"></span>`
                  }
                  ${c.account.name}${c.needsSetup ? html`<span class="muted" style="font-weight:600">· quick setup</span>` : nothing}
                </div>`,
              )}
              <p class="foot-note">${covered} of ${v.coverage.length} in.</p>
            </section>`
            : html`<section class="card accounts">
              <h2>Your accounts</h2>
              <p class="foot-note" style="line-height:1.5">Your cards and bank accounts appear here after their first upload, so you can see which are still missing each month.</p>
            </section>`
        }
      </aside>
    `;
  }

  private renderFile(f: StatementFile, account: Account | undefined, index: number) {
    const color = BADGE_COLORS[index % BADGE_COLORS.length];
    const rows = f.rowCount;
    const when = dayLabel(f.broughtInAt.slice(0, 10));
    let status: ReturnType<typeof html>;
    if (f.pending > 0) {
      status = html`<span class="pill ours">${words.leftToSort(f.pending)}</span><a href="#/sort/${f.id}">Keep going</a>`;
    } else if (f.decided > 0) {
      status = html`<span class="pill warn">Sorted · ready to add</span><a href="#/sort/${f.id}/add">${words.addTo(this.monthOf(f))}</a>`;
    } else {
      const aside = f.aside;
      status = html`<span class="pill good">${words.added}${aside ? ` · ${aside} ${words.setAside.toLowerCase()}` : ""}</span><a href="#/sort/${f.id}">Open</a>`;
    }
    return html`<article class="card file">
      <div class="file-head">
        <span class="badge" style="background:${color}">${institutionBadge(account?.institution ?? "?")}</span>
        <div style="min-width:0">
          <div class="file-name">${account?.name ?? "Unknown account"}</div>
          <div class="file-meta">${f.fileName} · ${rows} rows · ${when}</div>
        </div>
      </div>
      <div class="file-foot">${status}</div>
    </article>`;
  }

  private renderWaiting(f: StatementFile, account: Account | null) {
    const when = dayLabel(f.broughtInAt.slice(0, 10));
    return html`<article class="card file">
      <div class="file-head">
        <span class="badge" style="background:var(--du-butter-bg)"
          >${account ? institutionBadge(account.institution) : html`<du-icon name="file" size="18"></du-icon>`}</span
        >
        <div style="min-width:0">
          <div class="file-name">${account?.name ?? f.fileName}</div>
          <div class="file-meta">
            ${account ? `${f.fileName} · ` : ""}${f.rowCount ? `${f.rowCount} rows · ` : ""}${account ? when : `Uploaded ${when}`}
          </div>
        </div>
      </div>
      <div class="file-foot">
        <span class="pill warn">New layout · one quick setup</span>
        <button class="linkish" @click=${() => this.setUp(f)}>Set up</button>
      </div>
    </article>`;
  }

  private monthOf(f: StatementFile): MonthKey {
    return (f.lastDate ?? this.month).slice(0, 7);
  }

  private async setUp(f: StatementFile) {
    if (!f.path) {
      this.app.toast("Upload that file again to set it up.");
      return;
    }
    try {
      const bytes = await this.app.platform.readFileAt(f.path);
      await uploadFiles(this.app, [{ name: f.fileName, bytes, path: f.path }]);
    } catch {
      this.app.toast(`Couldn't open ${f.fileName} where it was. Upload it again?`);
    }
  }

  private pick = async () => {
    const files = await this.app.platform.pickFiles();
    if (files.length) await uploadFiles(this.app, files);
  };

  private illustration() {
    return html`<svg width="120" height="86" viewBox="0 0 120 86" aria-hidden="true">
      <rect x="30" y="6" width="44" height="54" rx="8" fill="#DCEEFF" transform="rotate(-10 52 33)"></rect>
      <rect x="48" y="4" width="44" height="54" rx="8" fill="#FFF0C2" transform="rotate(8 70 31)"></rect>
      <path d="M58 22h20M58 30h20M58 38h12" stroke="#2B2536" stroke-width="2.4" stroke-linecap="round" transform="rotate(8 70 31)"></path>
      <rect x="12" y="44" width="96" height="38" rx="14" fill="#FFE3D3"></rect>
      <path d="M12 56h28l6 8h28l6-8h28" fill="none" stroke="#F07A4A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
    </svg>`;
  }
}

customElements.define("du-uploads-screen", UploadsScreen);
