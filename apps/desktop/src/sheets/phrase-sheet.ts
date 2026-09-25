import { normalizePhrase, wordsToCheck } from "@duet/core";
import { css, html, nothing } from "lit";
import type { Sheet } from "../app/app.ts";
import { Screen } from "../app/screen.ts";
import { sheetStyles } from "./new-account-sheet.ts";

type PhraseSheetData = Extract<Sheet, { kind: "phrase" }>;

/** A recovery phrase, shown once; then three of its words to be sure it was written down. */
export class PhraseSheet extends Screen {
  static override properties = {
    ...Screen.properties,
    sheet: { attribute: false },
    step: { state: true },
    answers: { state: true },
    wrong: { state: true },
  };
  static override styles = [
    Screen.styles,
    sheetStyles,
    css`
      du-sheet {
        --sheet-width: 640px;
      }
      .words {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        background: var(--du-bg);
        border-radius: 20px;
        padding: 16px;
        -webkit-user-select: none;
        user-select: none;
      }
      .word {
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-family: var(--du-font-display);
        font-weight: 500;
        font-size: 16px;
      }
      .word span {
        font-family: var(--du-font-text);
        font-size: 11.5px;
        font-weight: 800;
        color: var(--du-muted);
        min-width: 18px;
        text-align: right;
      }
      .checks {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .lede {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.5;
        color: var(--du-ink-2);
      }
      .wrong {
        color: var(--du-error, #b3261e);
        font-size: 13px;
        font-weight: 800;
      }
    `,
  ];

  declare sheet: PhraseSheetData;
  declare step: "show" | "check";
  declare answers: string[];
  declare wrong: boolean;
  private readonly positions = wordsToCheck();

  constructor() {
    super();
    this.step = "show";
    this.answers = ["", "", ""];
    this.wrong = false;
  }

  override render() {
    const words = normalizePhrase(this.sheet.phrase).split(" ");
    const me = this.basics.me?.name ?? "you";
    return html`<du-sheet label="Recovery phrase" persistent @close=${this.close}>
      <div class="body">
        <div class="head">
          <span class="badge" style="background:var(--du-butter-bg)"><du-icon name="shield" size="22"></du-icon></span>
          <div>
            <h1>${this.step === "show" ? "Our recovery phrase" : "Which words are these?"}</h1>
            <div class="meta">For ${me} · shown once</div>
          </div>
        </div>
        ${
          this.step === "show"
            ? html`<p class="lede">
                  These 24 words open everything we've added, on any Mac. Write them on paper and keep them somewhere
                  safe. Duet never stores them.
                </p>
                <div class="words" aria-label="Recovery phrase">
                  ${words.map((w, i) => html`<div class="word"><span>${i + 1}</span>${w}</div>`)}
                </div>
                <div class="foot">
                  <span></span>
                  <button class="btn" @click=${() => (this.step = "check")}>I've written them down</button>
                </div>`
            : html`<p class="lede">To be sure they're on paper, type these three.</p>
                <form class="checks" @submit=${this.check}>
                  ${this.positions.map(
                    (n, i) => html`<label class="field">Word ${n}
                      <input
                        class="input"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        .value=${this.answers[i] ?? ""}
                        @input=${(e: Event) => {
                          const next = [...this.answers];
                          next[i] = (e.target as HTMLInputElement).value;
                          this.answers = next;
                          this.wrong = false;
                        }}
                      />
                    </label>`,
                  )}
                  <button hidden></button>
                </form>
                ${this.wrong ? html`<div class="wrong">One of those doesn't match. Have another look.</div>` : nothing}
                <div class="foot">
                  <button class="linkish" @click=${() => (this.step = "show")}>Show the words again</button>
                  <button class="btn" @click=${this.check}>Done</button>
                </div>`
        }
      </div>
    </du-sheet>`;
  }

  private check = (e: Event) => {
    e.preventDefault();
    const words = normalizePhrase(this.sheet.phrase).split(" ");
    const ok = this.positions.every(
      (n, i) => (this.answers[i] ?? "").trim().toLowerCase() === words[n - 1],
    );
    if (!ok) {
      this.wrong = true;
      return;
    }
    if (this.sheet.next) this.app.replaceSheet(this.sheet.next);
    else {
      this.app.closeSheet();
      this.app.toast("All set.");
    }
  };

  private close = () => {
    this.app.toast("You can make a new recovery phrase in Settings any time.");
    this.app.closeSheet();
  };
}

customElements.define("du-phrase-sheet", PhraseSheet);
