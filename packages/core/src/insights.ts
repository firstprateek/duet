import { addMonths, type MonthKey, monthName } from "./dates.ts";
import { type Cents, formatMoney } from "./money.ts";

/**
 * Month headlines, "Little things we noticed" and the Trends notes. Code computes every
 * number; words only describe them, and they suggest rather than scold ("Dining out was
 * the lightest since March", never "You overspent"). Inputs are totals by category, so
 * the partner's Mine merchants can never show up here.
 */

/** Spending per category for one month (any level of category). */
export type CategoryTotals = Map<string, Cents>;

export interface MonthTotals {
  month: MonthKey;
  total: Cents;
  byCategory: CategoryTotals;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * A typical month for us: each category's median over the `count` months before
 * `month` (the month itself not included). Months with no data don't count.
 */
export function typicalMonth(
  history: readonly MonthTotals[],
  month: MonthKey,
  count = 6,
): MonthTotals {
  const window = history
    .filter((h) => h.month < month && h.month >= addMonths(month, -count))
    .filter((h) => h.total !== 0);
  const categories = new Set<string>();
  for (const h of window) for (const id of h.byCategory.keys()) categories.add(id);
  const byCategory: CategoryTotals = new Map();
  for (const id of categories) {
    const m = median(window.map((h) => h.byCategory.get(id) ?? 0));
    if (m !== 0) byCategory.set(id, m);
  }
  return { month, total: median(window.map((h) => h.total)), byCategory };
}

export interface Headline {
  /** "A bit more than usual · +$862" */
  label: string;
  /** "Mostly Travel. Every other category was close to usual." */
  sentence: string | null;
  difference: Cents;
  tone: "more" | "less" | "usual";
}

export function monthHeadline(
  current: MonthTotals,
  typical: MonthTotals,
  names: (categoryId: string) => string,
): Headline {
  if (typical.total === 0) {
    return { label: "Our first month here", sentence: null, difference: 0, tone: "usual" };
  }
  const difference = current.total - typical.total;
  const ratio = Math.abs(difference) / typical.total;
  if (ratio < 0.05) {
    return { label: "About usual", sentence: null, difference, tone: "usual" };
  }
  const more = difference > 0;
  const size = ratio < 0.2 ? "A bit" : "Quite a bit";
  const label = `${size} ${more ? "more" : "less"} than usual · ${formatMoney(difference, { signed: true })}`;

  const deviations = [...new Set([...current.byCategory.keys(), ...typical.byCategory.keys()])].map(
    (id) => ({
      id,
      diff: (current.byCategory.get(id) ?? 0) - (typical.byCategory.get(id) ?? 0),
      usual: typical.byCategory.get(id) ?? 0,
    }),
  );
  deviations.sort((a, b) => (more ? b.diff - a.diff : a.diff - b.diff));
  const top = deviations[0];
  let sentence: string | null = null;
  if (
    top &&
    Math.sign(top.diff) === Math.sign(difference) &&
    Math.abs(top.diff) >= Math.abs(difference) * 0.6
  ) {
    const othersClose = deviations
      .slice(1)
      .every((d) => Math.abs(d.diff) <= Math.max(5000, Math.abs(d.usual) * 0.15));
    sentence = `Mostly ${names(top.id)}.${othersClose ? " Every other category was close to usual." : ""}`;
  }
  return { label, sentence, difference, tone: more ? "more" : "less" };
}

export interface Insight {
  kind: "difference" | "lightest" | "overlap" | "streak";
  icon: string;
  text: string;
  categoryId: string;
  linkLabel: string;
}

export interface SubscriptionCharge {
  name: string;
  tag: "music" | "video" | "news" | "cloud";
  amount: Cents;
}

const TAG_WORDS: Record<SubscriptionCharge["tag"], [string, string]> = {
  music: ["music service", "music services"],
  video: ["streaming service", "streaming services"],
  news: ["news subscription", "news subscriptions"],
  cloud: ["storage plan", "storage plans"],
};

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];

/** "Groceries have", "Dining out has". */
function has(name: string): string {
  return /s$/i.test(name) ? "have" : "has";
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Up to three observations for a month. `top` totals are by top-level category, `detail`
 * by subcategory; `history` holds earlier months at the same levels.
 */
export function monthInsights(input: {
  month: MonthKey;
  top: MonthTotals;
  detail: MonthTotals;
  topHistory: readonly MonthTotals[];
  detailHistory: readonly MonthTotals[];
  subscriptions: readonly SubscriptionCharge[];
  names: (categoryId: string) => string;
  icons: (categoryId: string) => string;
}): Insight[] {
  const out: Insight[] = [];
  const { month, names, icons } = input;
  const typicalTop = typicalMonth(input.topHistory, month);
  const typicalDetail = typicalMonth(input.detailHistory, month);

  // 1. The category that made the month different.
  const difference = input.top.total - typicalTop.total;
  if (typicalTop.total > 0 && Math.abs(difference) >= typicalTop.total * 0.05) {
    let best: { id: string; diff: number } | null = null;
    for (const [id, amount] of input.top.byCategory) {
      const diff = amount - (typicalTop.byCategory.get(id) ?? 0);
      if (Math.sign(diff) !== Math.sign(difference)) continue;
      if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { id, diff };
    }
    if (best && Math.abs(best.diff) >= Math.abs(difference) * 0.5) {
      const amount = input.top.byCategory.get(best.id) ?? 0;
      out.push({
        kind: "difference",
        icon: icons(best.id),
        text: `${names(best.id)} was most of the difference. It came to ${formatMoney(amount)}, about ${formatMoney(Math.abs(best.diff))} ${best.diff > 0 ? "over" : "under"} usual.`,
        categoryId: best.id,
        linkLabel: `See ${names(best.id).toLowerCase()}`,
      });
    }
  }

  // 2. The lightest a category has been in a while.
  let lightest: {
    id: string;
    since: MonthKey | null;
    months: number;
    amount: Cents;
    under: Cents;
  } | null = null;
  for (const [id, amount] of input.detail.byCategory) {
    if (amount <= 0) continue;
    const usual = typicalDetail.byCategory.get(id) ?? 0;
    if (usual <= 0 || usual - amount < Math.max(3000, usual * 0.15)) continue;
    const earlier = [...input.detailHistory]
      .filter((h) => h.month < month)
      .sort((a, b) => (a.month < b.month ? 1 : -1));
    let since: MonthKey | null = null;
    let count = 0;
    for (const h of earlier) {
      const value = h.byCategory.get(id) ?? 0;
      if (value !== 0 && value <= amount) {
        since = h.month;
        break;
      }
      count++;
    }
    if (count < 3) continue;
    const under = usual - amount;
    if (!lightest || under > lightest.under) lightest = { id, since, months: count, amount, under };
  }
  if (lightest) {
    const numbers = [
      "",
      "",
      "",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
    ];
    const sinceText = lightest.since
      ? ` since ${monthName(lightest.since)}`
      : ` in ${numbers[lightest.months] ?? lightest.months} months`;
    out.push({
      kind: "lightest",
      icon: icons(lightest.id),
      text: `${names(lightest.id)} was the lightest${sinceText}: ${formatMoney(lightest.amount)}, about ${formatMoney(lightest.under)} under usual.`,
      categoryId: lightest.id,
      linkLabel: `See ${names(lightest.id).toLowerCase()}`,
    });
  }

  // 3. Overlapping subscriptions.
  for (const tag of ["music", "video", "cloud", "news"] as const) {
    const charges = input.subscriptions.filter((s) => s.tag === tag);
    const byName = new Map<string, Cents>();
    for (const c of charges) byName.set(c.name, (byName.get(c.name) ?? 0) + c.amount);
    if (byName.size < 2) continue;
    const total = [...byName.values()].reduce((a, b) => a + b, 0);
    const [one, many] = TAG_WORDS[tag];
    out.push({
      kind: "overlap",
      icon: "music",
      text: `${COUNT_WORDS[byName.size] ?? byName.size} ${byName.size === 1 ? one : many}, ${joinNames([...byName.keys()])}: ${formatMoney(total, { cents: true })} a month together.`,
      categoryId: "subscriptions",
      linkLabel: "See subscriptions",
    });
    break;
  }
  return out.slice(0, 3);
}

export interface TrendNote {
  text: string;
  categoryId: string;
}

/** "Worth a look" on Trends: steady climbs and subscriptions creeping up. */
export function trendNotes(
  history: readonly MonthTotals[],
  names: (categoryId: string) => string,
): TrendNote[] {
  const sorted = [...history].sort((a, b) => (a.month < b.month ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  if (!latest || sorted.length < 4) return [];
  const notes: TrendNote[] = [];

  // A category above its usual several months running.
  const typical = typicalMonth(sorted, addMonths(latest.month, 1));
  let best: { id: string; months: number; line: Cents } | null = null;
  for (const [id, usual] of typical.byCategory) {
    if (usual < 5000) continue;
    let run = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if ((sorted[i]!.byCategory.get(id) ?? 0) > usual) run++;
      else break;
    }
    if (run >= 3 && (!best || run > best.months)) best = { id, months: run, line: usual };
  }
  if (best) {
    const line = Math.floor(best.line / 5000) * 5000;
    const count =
      ["", "", "two", "three", "four", "five", "six"][best.months] ?? String(best.months);
    notes.push({
      text: `${names(best.id)} ${has(names(best.id))} been above ${formatMoney(line)} ${count} months running.`,
      categoryId: best.id,
    });
  }

  // Subscriptions compared with six months ago.
  const subsNow = latest.byCategory.get("subscriptions") ?? 0;
  const past = sorted.find((h) => h.month === addMonths(latest.month, -5)) ?? sorted[0]!;
  const subsThen = past.byCategory.get("subscriptions") ?? 0;
  if (subsThen > 0 && subsNow - subsThen >= 1000) {
    notes.push({
      text: `Subscriptions are ${formatMoney(subsNow)} a month now, up from ${formatMoney(subsThen)} in ${monthName(past.month)}.`,
      categoryId: "subscriptions",
    });
  }

  // Something coming down steadily.
  for (const id of latest.byCategory.keys()) {
    const recent = sorted.slice(-4).map((h) => h.byCategory.get(id) ?? 0);
    if (
      recent.length === 4 &&
      recent.every((v, i) => i === 0 || v < recent[i - 1]!) &&
      recent[0]! >= 10000
    ) {
      notes.push({
        text: `${names(id)} ${has(names(id))} come down three months in a row, to ${formatMoney(recent[3]!)}.`,
        categoryId: id,
      });
      break;
    }
  }
  return notes.slice(0, 3);
}
