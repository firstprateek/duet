import {
  type AddSummary,
  addToMonth,
  batchImpactSentence,
  formatMoney,
  getFile,
  getPair,
  getSharePlans,
  monthName,
  previewAdd,
  rhythmFor,
  type StatementFile,
  words,
} from "@duet/core";
import { css, html, nothing } from "lit";
import { Loader } from "../app/loader.ts";
import { Screen } from "../app/screen.ts";

interface AddData {
  file: StatementFile | null;
  summary: AddSummary;
  impact: string | null;
}

function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Adding to August": what goes into the month, before it does. */
export class AddScreen extends Screen {
  static override properties = {
    ...Screen.properties,
    fileId: { type: String },
    busy: { state: true },
  };
  static override styles = [
    Screen.styles,
    css`
      :host {
        display: flex;
        justify-content: center;
        padding: 6px 32px 24px;
      }
      article {
        width: 780px;
        max-width: 100%;
        padding: 28px 36px;
        display: flex;
        flex-direction: column;
        min-height: 560px;
        border-radius: 30px;
      }
      .top {
        display: flex;
        align-items: center;
        gap: 22px;
      }
      h1 {
        font-size: 34px;
        line-height: 1.1;
      }
      .lede {
        margin: 6px 0 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--du-ink-2);
        line-height: 1.45;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 22px;
      }
      .tile {
        border-radius: 20px;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tile .head {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        font-weight: 800;
      }
      .tile .value {
        font-family: var(--du-font-display);
        font-weight: 600;
        font-size: 30px;
      }
      .tile .why {
        font-size: 13px;
        font-weight: 700;
      }
      .ours {
        background: var(--du-ours-bg);
        color: var(--du-ours-fg);
      }
      .mine {
        background: var(--du-mine-bg);
        color: var(--du-mine-fg);
      }
      .aside {
        background: var(--du-aside-bg);
        color: var(--du-aside-fg);
      }
      .tile .value {
        color: var(--du-ink);
      }
      .aside .value {
        color: var(--du-aside-fg);
      }
      details {
        margin-top: 18px;
        font-size: 13.5px;
        font-weight: 600;
      }
      summary {
        cursor: pointer;
        color: var(--du-link);
        font-weight: 800;
      }
      details p {
        margin: 8px 0 0;
        line-height: 1.5;
        color: var(--du-ink-2);
      }
      .foot {
        margin-top: auto;
        padding-top: 22px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .foot a {
        font-size: 14px;
        font-weight: 800;
      }
    `,
  ];

  declare fileId: string;
  declare busy: boolean;

  private data = new Loader<AddData>(
    this,
    () => this.app,
    async () => {
      const store = this.app.store;
      const [file, summary, pair] = await Promise.all([
        getFile(store, this.fileId),
        previewAdd(store, this.fileId),
        getPair(store),
      ]);
      let impact: string | null = null;
      if (summary.oursEntries.length) {
        const month = summary.months[summary.months.length - 1] ?? this.basics.latestMonth;
        const plans = await getSharePlans(store);
        const bp = rhythmFor(month, plans);
        const names = Object.fromEntries(pair.members.map((m) => [m.id, m.name]));
        impact = batchImpactSentence(summary.oursEntries, bp, pair, names);
      }
      return { file, summary, impact };
    },
    () => this.fileId,
  );

  constructor() {
    super();
    this.busy = false;
  }

  override render() {
    const v = this.data.value;
    if (!v) return nothing;
    const b = this.basics;
    const s = v.summary;
    const month = s.months[s.months.length - 1] ?? b.latestMonth;
    const account = b.accounts.find((a) => a.id === v.file?.accountId);
    const count = s.ours.count + s.mine.count;
    const reasons = this.asideWords(s.aside.reasons);
    const first = b.first!;
    const second = b.second!;
    return html`<article class="card">
      <div class="top">
        <svg width="118" height="84" viewBox="0 0 118 84" aria-hidden="true">
          <circle cx="44" cy="30" r="18" fill=${first.color}></circle>
          <circle cx="74" cy="30" r="18" fill=${second.color}></circle>
          <rect x="10" y="34" width="98" height="46" rx="14" fill="#FFE3D3"></rect>
          <path d="M14 40l45 22 45-22" fill="none" stroke="#F07A4A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <div>
          <h1>${words.addingTo(month)}</h1>
          <p class="lede">
            ${count} from ${account?.name ?? "this statement"}.${
              s.waiting ? ` The ${s.waiting} you haven't reached yet will wait right here.` : ""
            }
          </p>
        </div>
      </div>
      <div class="tiles">
        <div class="tile ours">
          <div class="head"><span>${words.ours}</span><span>${s.ours.count} ${s.ours.count === 1 ? "item" : "items"}</span></div>
          <div class="value">${formatMoney(s.ours.total, { cents: true })}</div>
        </div>
        <div class="tile mine">
          <div class="head"><span>${words.mine}</span><span>${s.mine.count} ${s.mine.count === 1 ? "item" : "items"}</span></div>
          <div class="value">${formatMoney(s.mine.total, { cents: true })}</div>
        </div>
        <div class="tile aside">
          <div class="head"><span>${words.setAside}</span><span>${s.aside.count} ${s.aside.count === 1 ? "item" : "items"}</span></div>
          <div class="value">—</div>
          ${reasons ? html`<div class="why">${reasons}</div>` : nothing}
        </div>
      </div>
      ${
        v.impact
          ? html`<details>
            <summary>How this changes ${words.ebbFlow}</summary>
            <p>${v.impact}</p>
          </details>`
          : nothing
      }
      <div class="foot">
        <a href="#/sort/${this.fileId}">${words.backToSorting}</a>
        <button class="btn big" ?disabled=${count === 0 || this.busy} @click=${this.add}>
          ${words.addTo(month, count)}<du-icon name="check" size="16" stroke="2.4"></du-icon>
        </button>
      </div>
    </article>`;
  }

  /** "A card payment, a duplicate and one you left out" */
  private asideWords(reasons: string[]): string {
    const counts = { payment: 0, duplicate: 0, transfer: 0, deposit: 0, slate: 0, other: 0 };
    for (const r of reasons) {
      if (r.startsWith("Card payment")) counts.payment++;
      else if (r.startsWith("Already added")) counts.duplicate++;
      else if (r.startsWith("Moving money")) counts.transfer++;
      else if (r.startsWith("Money coming in")) counts.deposit++;
      else if (r.startsWith("Recorded as a Clean slate")) counts.slate++;
      else counts.other++;
    }
    const n = (count: number, one: string, many: string) =>
      count === 1 ? one : `${count} ${many}`;
    const parts: string[] = [];
    if (counts.payment) parts.push(n(counts.payment, "a card payment", "card payments"));
    if (counts.transfer) parts.push(n(counts.transfer, "a transfer", "transfers"));
    if (counts.deposit) parts.push(n(counts.deposit, "money coming in", "deposits"));
    if (counts.duplicate) parts.push(n(counts.duplicate, "a duplicate", "duplicates"));
    if (counts.slate) parts.push(n(counts.slate, "a Clean slate", "Clean slates"));
    if (counts.other)
      parts.push(counts.other === 1 ? "one you left out" : `${counts.other} you left out`);
    const text = joinWords(parts);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  private add = async () => {
    this.busy = true;
    try {
      const summary = await addToMonth(this.app.store, this.fileId);
      const month = summary.months[summary.months.length - 1] ?? this.basics.latestMonth;
      const count = summary.ours.count + summary.mine.count;
      this.app.toast(`${words.added} ${count} to ${monthName(month)}.`);
      this.app.navigate({ name: "month", month });
    } finally {
      this.busy = false;
    }
  };
}

customElements.define("du-add-screen", AddScreen);
