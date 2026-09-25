import { type Category, FALLBACK_CATEGORY_ID, topLevelOf } from "./categories.ts";
import { addMonths, lastMonths, type MonthKey, monthName } from "./dates.ts";
import { placeholders, type SqlValue } from "./db/driver.ts";
import {
  type CleanSlateEntry,
  carrier,
  type EbbFlow,
  ebbAndFlow,
  type HistoryRow,
  type MonthFigure,
  monthSentence,
  type OursEntry,
  overallSentence,
  type Pair,
} from "./ebbflow.ts";
import { getCleanSlates, TX_COLUMNS, toTransaction } from "./entries.ts";
import { getCategories, getPair, getSharePlans } from "./household.ts";
import { accountCoverage } from "./imports.ts";
import {
  type Headline,
  type Insight,
  type MonthTotals,
  median,
  monthHeadline,
  monthInsights,
  type SubscriptionCharge,
  type TrendNote,
  trendNotes,
  typicalMonth,
} from "./insights.ts";
import { findKnownMerchant } from "./merchants.ts";
import type { CleanSlate, Member, Transaction } from "./model.ts";
import type { Cents } from "./money.ts";
import type { Store } from "./store.ts";

/** What each screen needs, computed from the local database. */

interface MonthCategoryRow {
  month: string;
  category_id: string;
  total: number;
}

interface MineRow extends MonthCategoryRow {
  member_id: string;
}

export interface Ledger {
  /** Ours by month and category (subcategory level). */
  ours: MonthCategoryRow[];
  /** Mine totals by member, month and category. */
  mine: MineRow[];
}

export async function loadLedger(store: Store, from: MonthKey, to: MonthKey): Promise<Ledger> {
  const ours = await store.db.all<MonthCategoryRow>(
    `SELECT month, COALESCE(category_id, ?) AS category_id, SUM(amount) AS total
     FROM transactions WHERE deleted_at IS NULL AND month BETWEEN ? AND ?
     GROUP BY month, COALESCE(category_id, ?)`,
    [FALLBACK_CATEGORY_ID, from, to, FALLBACK_CATEGORY_ID],
  );
  const mine = await store.db.all<MineRow>(
    "SELECT month, category_id, member_id, total FROM mine_totals WHERE month BETWEEN ? AND ? AND total <> 0",
    [from, to],
  );
  return {
    ours: ours.map((r) => ({ ...r, total: Number(r.total) })),
    mine: mine.map((r) => ({ ...r, total: Number(r.total) })),
  };
}

/** Month totals by category, at the subcategory ("detail") or top level, Ours and Mine together. */
export function monthTotals(
  ledger: Ledger,
  months: readonly MonthKey[],
  categories: readonly Category[],
  level: "detail" | "top",
  filter?: (row: { categoryId: string; kind: "ours" | "mine"; memberId?: string }) => boolean,
): MonthTotals[] {
  const topCache = new Map<string, string>();
  const key = (categoryId: string) => {
    if (level === "detail") return categoryId;
    let top = topCache.get(categoryId);
    if (!top) {
      top = topLevelOf(categoryId, categories)?.id ?? categoryId;
      topCache.set(categoryId, top);
    }
    return top;
  };
  const byMonth = new Map<MonthKey, MonthTotals>(
    months.map((m) => [m, { month: m, total: 0, byCategory: new Map() }]),
  );
  const add = (month: string, categoryId: string, amount: number) => {
    const t = byMonth.get(month);
    if (!t) return;
    const k = key(categoryId);
    t.byCategory.set(k, (t.byCategory.get(k) ?? 0) + amount);
    t.total += amount;
  };
  for (const r of ledger.ours)
    if (!filter || filter({ categoryId: r.category_id, kind: "ours" }))
      add(r.month, r.category_id, r.total);
  for (const r of ledger.mine) {
    if (!filter || filter({ categoryId: r.category_id, kind: "mine", memberId: r.member_id }))
      add(r.month, r.category_id, r.total);
  }
  return months.map((m) => byMonth.get(m)!);
}

export async function oursEntries(store: Store): Promise<OursEntry[]> {
  const rows = await store.db.all<{ month: string; amount: number; paid_by: string }>(
    "SELECT month, amount, paid_by FROM transactions WHERE deleted_at IS NULL",
  );
  return rows.map((r) => ({ month: r.month, amount: Number(r.amount), paidBy: r.paid_by }));
}

function slateEntries(slates: readonly CleanSlate[]): CleanSlateEntry[] {
  return slates.map((s) => ({
    id: s.id,
    from: s.fromMember,
    to: s.toMember,
    amount: s.amount,
    date: s.date,
    appliesTo: s.appliesTo === "overall" ? "overall" : s.appliesTo,
  }));
}

export interface EbbFlowView {
  pair: Pair;
  members: Member[];
  names: Record<string, string>;
  flow: EbbFlow;
  slates: CleanSlate[];
  currentFirstBp: number;
  rhythmSince: MonthKey | null;
}

export async function ebbFlowView(store: Store, through: MonthKey): Promise<EbbFlowView> {
  const pair = await getPair(store);
  const [entries, plans, slates] = await Promise.all([
    oursEntries(store),
    getSharePlans(store),
    getCleanSlates(store),
  ]);
  const rhythm = plans.map((p) => ({ fromMonth: p.fromMonth, firstBp: p.firstBp }));
  const flow = ebbAndFlow(entries, rhythm, slateEntries(slates), pair, through);
  const names = Object.fromEntries(pair.members.map((m) => [m.id, m.name]));
  const current = [...plans].filter((p) => p.fromMonth <= through).pop() ?? plans[0];
  return {
    pair,
    members: pair.members,
    names,
    flow,
    slates,
    currentFirstBp: current?.firstBp ?? 5000,
    rhythmSince: current?.fromMonth ?? null,
  };
}

export interface MonthView {
  month: MonthKey;
  total: Cents;
  ours: Cents;
  mineByMember: Record<string, Cents>;
  byTop: Array<{ category: Category; amount: Cents }>;
  headline: Headline;
  insights: Insight[];
  lastSix: Array<{ month: MonthKey; total: Cents }>;
  typicalTotal: Cents;
  coverage: { covered: number; total: number; missing: string[] };
  ebb: {
    figure: MonthFigure | null;
    overall: Cents;
    monthSentence: string;
    overallSentence: string;
    monthCarrier: string | null;
    overallCarrier: string | null;
  };
  /** "2 added after your clean slate on Sep 5" */
  addedAfterSlate: { count: number; date: string } | null;
  names: Record<string, string>;
  pair: Pair;
}

export async function monthView(store: Store, month: MonthKey): Promise<MonthView> {
  const categories = await getCategories(store, true);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names = (id: string) => byId.get(id)?.name ?? "Something else";
  const icons = (id: string) => byId.get(id)?.icon ?? "sparkle";
  const history = lastMonths(month, 13);
  const ledger = await loadLedger(store, history[0]!, month);
  const top = monthTotals(ledger, history, categories, "top");
  const detail = monthTotals(ledger, history, categories, "detail");
  const current = top[top.length - 1]!;
  const typical = typicalMonth(top, month);

  const ours = ledger.ours.filter((r) => r.month === month).reduce((s, r) => s + r.total, 0);
  const mineByMember: Record<string, Cents> = {};
  for (const r of ledger.mine.filter((r) => r.month === month)) {
    mineByMember[r.member_id] = (mineByMember[r.member_id] ?? 0) + r.total;
  }

  const byTop = [...current.byCategory.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([id, amount]) => ({
      category: byId.get(id) ?? {
        id,
        name: names(id),
        parentId: null,
        icon: "dots",
        color: "#C9C0D3",
        bubble: "#F0ECE6",
        order: 9999,
      },
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const subscriptions = await subscriptionCharges(store, month);
  const insights = monthInsights({
    month,
    top: current,
    detail: detail[detail.length - 1]!,
    topHistory: top.slice(0, -1),
    detailHistory: detail.slice(0, -1),
    subscriptions,
    names,
    icons,
  });

  const view = await ebbFlowView(store, month);
  const row: HistoryRow | undefined = view.flow.months.find((m) => m.month === month);
  const coverage = await accountCoverage(store, month);

  let addedAfterSlate: MonthView["addedAfterSlate"] = null;
  const slatesForMonth = view.slates.filter(
    (s) => s.appliesTo === month || s.appliesTo === "overall",
  );
  const latestSlate = slatesForMonth.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))[0];
  if (latestSlate) {
    const [row2] = await store.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL AND month = ? AND added_at > ?",
      [month, latestSlate.addedAt],
    );
    const count = Number(row2?.n ?? 0);
    if (count > 0) addedAfterSlate = { count, date: latestSlate.date };
  }

  return {
    month,
    total: current.total,
    ours,
    mineByMember,
    byTop,
    headline: monthHeadline(current, typical, names),
    insights,
    lastSix: top.slice(-6).map((t) => ({ month: t.month, total: t.total })),
    typicalTotal: typical.total,
    coverage: {
      covered: coverage.filter((c) => c.covered).length,
      total: coverage.length,
      missing: coverage.filter((c) => !c.covered).map((c) => c.account.id),
    },
    ebb: {
      figure: row ?? null,
      overall: view.flow.overall,
      monthSentence: row
        ? monthSentence(row, view.pair, view.names)
        : `You're in step in ${monthName(month)}.`,
      overallSentence: overallSentence(view.flow.overall, view.pair, view.names),
      monthCarrier: row ? carrier(row.net, view.pair) : null,
      overallCarrier: carrier(view.flow.overall, view.pair),
    },
    addedAfterSlate,
    names: view.names,
    pair: { first: view.pair.first, second: view.pair.second },
  };
}

/** Subscriptions this month from Ours and this person's own Mine, for the overlap insight. */
export async function subscriptionCharges(
  store: Store,
  month: MonthKey,
): Promise<SubscriptionCharge[]> {
  const rows = await store.db.all<{
    description: string | null;
    merchant: string | null;
    amount: number;
  }>(
    `SELECT description, merchant, amount FROM transactions WHERE deleted_at IS NULL AND month = ? AND category_id = 'subscriptions'
     UNION ALL
     SELECT description, merchant, amount FROM mine_transactions WHERE deleted_at IS NULL AND month = ? AND category_id = 'subscriptions'`,
    [month, month],
  );
  const out: SubscriptionCharge[] = [];
  for (const r of rows) {
    const known = findKnownMerchant(r.description || r.merchant || "");
    const tag = known?.tags?.[0];
    if (known && tag) out.push({ name: known.name, tag, amount: Number(r.amount) });
  }
  return out;
}

export interface TrendsView {
  months: Array<{ month: MonthKey; ours: Cents; first: Cents; second: Cents; total: Cents }>;
  typicalTotal: Cents;
  typicalByTop: Array<{ category: Category; amount: Cents }>;
  latest: { month: MonthKey; total: Cents; difference: Cents } | null;
  notes: TrendNote[];
  topCategories: Category[];
}

export async function trendsView(
  store: Store,
  options: { through: MonthKey; count: number; categoryId?: string | null },
): Promise<TrendsView> {
  const categories = await getCategories(store, true);
  const pair = await getPair(store);
  const months = lastMonths(options.through, options.count);
  const history = lastMonths(options.through, Math.max(options.count, 12));
  const ledger = await loadLedger(store, history[0]!, options.through);
  const inFilter = (categoryId: string) =>
    !options.categoryId ||
    categoryId === options.categoryId ||
    topLevelOf(categoryId, categories)?.id === options.categoryId;

  const series = months.map((month) => {
    const ours = ledger.ours
      .filter((r) => r.month === month && inFilter(r.category_id))
      .reduce((s, r) => s + r.total, 0);
    const mineOf = (member: string) =>
      ledger.mine
        .filter((r) => r.month === month && r.member_id === member && inFilter(r.category_id))
        .reduce((s, r) => s + r.total, 0);
    const first = mineOf(pair.first);
    const second = mineOf(pair.second);
    return { month, ours, first, second, total: ours + first + second };
  });

  const top = monthTotals(ledger, history, categories, "top");
  const detail = monthTotals(ledger, history, categories, "detail");
  const nextMonth = addMonths(options.through, 1);
  const typicalTop = typicalMonth(top, nextMonth);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const typicalByTop = [...typicalTop.byCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ category: byId.get(id)!, amount }))
    .filter((x) => x.category)
    .sort((a, b) => b.amount - a.amount);
  const typicalTotal = median(
    series
      .slice(-6)
      .filter((s) => s.total !== 0)
      .map((s) => s.total),
  );
  const latestRow = series[series.length - 1];
  const previousTypical = typicalMonth(top, options.through).total;
  const names = (id: string) => byId.get(id)?.name ?? "Something else";
  const notes = trendNotes(
    detail.filter((d) => d.total !== 0),
    names,
  );
  return {
    months: series,
    typicalTotal,
    typicalByTop,
    latest: latestRow
      ? {
          month: latestRow.month,
          total: latestRow.total,
          difference: latestRow.total - previousTypical,
        }
      : null,
    notes,
    topCategories: categories.filter((c) => !c.parentId && !c.archived),
  };
}

export interface TransactionFilter {
  month?: MonthKey | null;
  categoryId?: string | null;
  share?: "ours" | "mine" | "all";
  search?: string | null;
  accountId?: string | null;
}

/** Everything added: Ours, this person's Mine, newest first. */
export async function listTransactions(
  store: Store,
  filter: TransactionFilter = {},
  categories?: readonly Category[],
): Promise<Transaction[]> {
  const cats = categories ?? (await getCategories(store, true));
  const where: string[] = ["deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (filter.month) {
    where.push("month = ?");
    params.push(filter.month);
  }
  if (filter.categoryId) {
    const ids = cats
      .filter((c) => c.id === filter.categoryId || c.parentId === filter.categoryId)
      .map((c) => c.id);
    where.push(`category_id IN (${placeholders(ids.length || 1)})`);
    params.push(...(ids.length ? ids : [filter.categoryId]));
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.search) {
    where.push("(merchant LIKE ? OR description LIKE ? OR note LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  const clause = where.join(" AND ");
  const share = filter.share ?? "all";
  const out: Transaction[] = [];
  if (share !== "mine") {
    const rows = await store.db.all<Parameters<typeof toTransaction>[0]>(
      `SELECT ${TX_COLUMNS} FROM transactions WHERE ${clause} ORDER BY date DESC, added_at DESC LIMIT 2000`,
      params,
    );
    out.push(...rows.map((r) => toTransaction(r, "ours")));
  }
  if (share !== "ours") {
    const rows = await store.db.all<Parameters<typeof toTransaction>[0]>(
      `SELECT ${TX_COLUMNS} FROM mine_transactions WHERE ${clause} ORDER BY date DESC, added_at DESC LIMIT 2000`,
      params,
    );
    out.push(...rows.map((r) => toTransaction(r, "mine")));
  }
  return out.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.addedAt < b.addedAt ? 1 : -1,
  );
}

/** The months that have anything in them, oldest first. */
export async function activeMonths(store: Store): Promise<MonthKey[]> {
  const rows = await store.db.all<{ month: string }>(
    `SELECT month FROM transactions WHERE deleted_at IS NULL
     UNION SELECT month FROM mine_totals
     UNION SELECT substr(date, 1, 7) AS month FROM drafts
     ORDER BY month`,
  );
  return rows.map((r) => r.month).filter(Boolean);
}
