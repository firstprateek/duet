import { addMonths, type ISODate, type MonthKey, monthName, monthOf } from "./dates.ts";
import { type Cents, formatMoney, shareOf } from "./money.ts";

/**
 * Ebb & flow: how much more one of us has paid toward Ours than our share under
 * Our rhythm. Figures are from the first partner's side: positive means the first
 * partner has carried more. For month m (see the spec, "The math"):
 *
 *   G_m = P_m − round(r_m · S_m) − E_m(second → first) + E_m(first → second)
 *
 * S is everything Ours (refunds are negative, so they come off), P is the part the first
 * partner paid, r is the first partner's share in effect that month, and E are Clean
 * slate entries applied to the month. Rounding happens once per month.
 */

/** Within this many cents of zero, the card says "You're in step". */
export const IN_STEP_CENTS = 2500;

/** Our rhythm from a month onward. `firstBp` is the first partner's share in basis points. */
export interface RhythmPlan {
  fromMonth: MonthKey;
  firstBp: number;
}

export interface OursEntry {
  month: MonthKey;
  amount: Cents;
  paidBy: string;
}

export interface CleanSlateEntry {
  id?: string;
  from: string;
  to: string;
  amount: Cents;
  date: ISODate;
  /** A month key, or "overall". */
  appliesTo: MonthKey | "overall";
}

export interface Pair {
  first: string;
  second: string;
}

/** The first partner's share for a month. Months before the first plan use the first plan. */
export function rhythmFor(month: MonthKey, plans: readonly RhythmPlan[]): number {
  if (plans.length === 0) return 5000;
  const sorted = [...plans].sort((a, b) => (a.fromMonth < b.fromMonth ? -1 : 1));
  let bp = sorted[0]!.firstBp;
  for (const plan of sorted) {
    if (plan.fromMonth <= month) bp = plan.firstBp;
  }
  return bp;
}

/** How a Clean slate moves the figure: giving money means you've carried more. */
export function slateEffect(slate: CleanSlateEntry, pair: Pair): Cents {
  if (slate.from === pair.first && slate.to === pair.second) return slate.amount;
  if (slate.from === pair.second && slate.to === pair.first) return -slate.amount;
  return 0;
}

export interface MonthFigure {
  month: MonthKey;
  /** Everything Ours this month (S). */
  total: Cents;
  firstPaid: Cents;
  secondPaid: Cents;
  firstBp: number;
  firstShare: Cents;
  secondShare: Cents;
  /** P − round(r · S), before any Clean slate. */
  raw: Cents;
  /** Clean slates applied to this month. */
  slates: CleanSlateEntry[];
  /** raw plus the Clean slates applied to this month. */
  net: Cents;
}

export function monthFigure(
  month: MonthKey,
  entries: readonly OursEntry[],
  plans: readonly RhythmPlan[],
  slates: readonly CleanSlateEntry[],
  pair: Pair,
): MonthFigure {
  let total = 0;
  let firstPaid = 0;
  for (const e of entries) {
    if (e.month !== month) continue;
    total += e.amount;
    if (e.paidBy === pair.first) firstPaid += e.amount;
  }
  const firstBp = rhythmFor(month, plans);
  const firstShare = shareOf(total, firstBp);
  const raw = firstPaid - firstShare;
  const applied = slates.filter((s) => s.appliesTo === month);
  const net = applied.reduce((sum, s) => sum + slateEffect(s, pair), raw);
  return {
    month,
    total,
    firstPaid,
    secondPaid: total - firstPaid,
    firstBp,
    firstShare,
    secondShare: total - firstShare,
    raw,
    slates: applied,
    net,
  };
}

export interface HistoryRow extends MonthFigure {
  /** The running number after this month, including every Clean slate so far. */
  overallAfter: Cents;
  /** Clean slates for "overall" recorded during this month. */
  overallSlates: CleanSlateEntry[];
}

export interface EbbFlow {
  /** Oldest first. */
  months: HistoryRow[];
  overall: Cents;
}

/**
 * Every month from the first Ours entry (or Clean slate) through `through`, with the
 * running number. The overall number is the sum of every month's figure plus any Clean
 * slates applied to Overall.
 */
export function ebbAndFlow(
  entries: readonly OursEntry[],
  plans: readonly RhythmPlan[],
  slates: readonly CleanSlateEntry[],
  pair: Pair,
  through?: MonthKey,
): EbbFlow {
  const monthsSeen = new Set<MonthKey>();
  for (const e of entries) monthsSeen.add(e.month);
  for (const s of slates) monthsSeen.add(s.appliesTo === "overall" ? monthOf(s.date) : s.appliesTo);
  if (monthsSeen.size === 0) return { months: [], overall: 0 };

  const sorted = [...monthsSeen].sort();
  const first = sorted[0]!;
  let last = sorted[sorted.length - 1]!;
  if (through && through > last) last = through;

  const byMonth = new Map<MonthKey, OursEntry[]>();
  for (const e of entries) {
    const list = byMonth.get(e.month);
    if (list) list.push(e);
    else byMonth.set(e.month, [e]);
  }

  const rows: HistoryRow[] = [];
  let running = 0;
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    const figure = monthFigure(m, byMonth.get(m) ?? [], plans, slates, pair);
    const overallSlates = slates.filter((s) => s.appliesTo === "overall" && monthOf(s.date) === m);
    running += figure.net;
    for (const s of overallSlates) running += slateEffect(s, pair);
    rows.push({ ...figure, overallAfter: running, overallSlates });
  }
  // Overall entries dated after `through` still count toward the number.
  for (const s of slates) {
    if (s.appliesTo === "overall" && monthOf(s.date) > last) running += slateEffect(s, pair);
  }
  return { months: rows, overall: running };
}

export function isInStep(amount: Cents): boolean {
  return Math.abs(amount) < IN_STEP_CENTS;
}

/** Who has carried more: a member id, or null when in step. */
export function carrier(amount: Cents, pair: Pair): string | null {
  if (isInStep(amount)) return null;
  return amount > 0 ? pair.first : pair.second;
}

export interface Names {
  [memberId: string]: string;
}

/** "In August, Jill carried $262 extra." or "You're in step in August." */
export function monthSentence(
  figure: Pick<MonthFigure, "month" | "net">,
  pair: Pair,
  names: Names,
): string {
  const who = carrier(figure.net, pair);
  const month = monthName(figure.month);
  if (!who) return `You're in step in ${month}.`;
  return `In ${month}, ${names[who]} carried ${formatMoney(Math.abs(figure.net))} extra.`;
}

/** "Jill's been carrying a little extra: $418 overall." or "You're in step." */
export function overallSentence(overall: Cents, pair: Pair, names: Names): string {
  const who = carrier(overall, pair);
  if (!who) return "You're in step.";
  return `${names[who]}'s been carrying a little extra: ${formatMoney(Math.abs(overall))} overall.`;
}

/** "Jill +$262" for history rows, or "In step". */
export function signedLabel(amount: Cents, pair: Pair, names: Names): string {
  const who = carrier(amount, pair);
  if (!who) return "In step";
  return `${names[who]} +${formatMoney(Math.abs(amount))}`;
}

/**
 * What a batch of Ours transactions does to the month, for the "How this changes Ebb &
 * flow" note: "Jack paid for all $2,425.80 of these. At 58 / 42, Jack's share is $1,406.96,
 * so Jack covered $1,018.84 more."
 */
export function batchImpactSentence(
  entries: readonly OursEntry[],
  firstBp: number,
  pair: Pair,
  names: Names,
): string {
  const total = entries.reduce((s, e) => s + e.amount, 0);
  if (total === 0) return "These don't change Ebb & flow.";
  const firstPaid = entries
    .filter((e) => e.paidBy === pair.first)
    .reduce((s, e) => s + e.amount, 0);
  const secondPaid = total - firstPaid;
  const ratio = `${Math.round(firstBp / 100)} / ${Math.round((10000 - firstBp) / 100)}`;
  const firstShare = shareOf(total, firstBp);
  const secondShare = total - firstShare;
  const cents = { cents: true };
  const payer = firstPaid === total ? pair.first : secondPaid === total ? pair.second : null;
  if (payer) {
    const share = payer === pair.first ? firstShare : secondShare;
    const diff = total - share;
    return `${names[payer]} paid for all ${formatMoney(total, cents)} of these. At ${ratio}, ${names[payer]}'s share is ${formatMoney(share, cents)}, so ${names[payer]} covered ${formatMoney(diff, cents)} more.`;
  }
  const diff = firstPaid - firstShare;
  const who = diff >= 0 ? pair.first : pair.second;
  return `${names[pair.first]} paid ${formatMoney(firstPaid, cents)} and ${names[pair.second]} paid ${formatMoney(secondPaid, cents)} of these. At ${ratio}, ${names[who]} covered ${formatMoney(Math.abs(diff), cents)} more.`;
}

/** Our rhythm from two salaries, to the nearest whole percent. Salaries are never stored. */
export function rhythmFromSalaries(first: number, second: number): number {
  if (!(first > 0) || !(second > 0)) throw new Error("Both salaries are needed");
  const pct = Math.round((first / (first + second)) * 100);
  return Math.min(99, Math.max(1, pct)) * 100;
}

/** "58 / 42" */
export function rhythmLabel(firstBp: number): string {
  return `${Math.round(firstBp / 100)} / ${Math.round((10000 - firstBp) / 100)}`;
}
