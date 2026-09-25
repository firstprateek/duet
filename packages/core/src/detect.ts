import { daysBetween, type ISODate } from "./dates.ts";
import { merchantKey, normalizeText } from "./merchants.ts";
import type { Cents } from "./money.ts";

/**
 * Finding what isn't new spending: duplicates, card payments and transfers between our own
 * accounts, money moving between the two of us, and refunds of earlier purchases.
 * Amounts are spending-positive throughout.
 */

export interface DetectRow {
  id: string;
  accountId: string;
  accountKind: "credit" | "checking" | "savings" | "cash" | "wallet";
  /** Whose account it is. */
  ownerId: string;
  /** Statement file the row came from; rows from the same file are never duplicates. */
  fileId: string | null;
  date: ISODate;
  amount: Cents;
  description: string;
  kind: "purchase" | "refund" | "payment" | "deposit" | "transfer" | "fee" | "interest";
}

/** A past purchase a refund can be matched to. */
export interface PastPurchase {
  id: string;
  date: ISODate;
  amount: Cents;
  description: string;
  merchant: string;
  categoryId: string | null;
  share: "ours" | "mine" | null;
}

export type DuplicateMatch = { type: "exact" | "near"; of: string };

function dedupeText(text: string): string {
  return normalizeText(text)
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const s = text.replace(/ /g, "");
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice similarity of two descriptions, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(dedupeText(a));
  const y = bigrams(dedupeText(b));
  let overlap = 0;
  let total = 0;
  for (const [g, n] of x) {
    overlap += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * Rows already seen: an exact match on account, date, amount and description is set aside;
 * a near match (same account and amount within 3 days, similar text) is flagged.
 */
export function findDuplicates(
  rows: readonly DetectRow[],
  existing: readonly DetectRow[],
): Map<string, DuplicateMatch> {
  const out = new Map<string, DuplicateMatch>();
  const exactIndex = new Map<string, DetectRow>();
  const key = (r: DetectRow) => `${r.accountId}|${r.date}|${r.amount}|${dedupeText(r.description)}`;
  for (const e of existing) exactIndex.set(key(e), e);
  for (const row of rows) {
    const exact = exactIndex.get(key(row));
    if (exact && exact.fileId !== row.fileId) {
      out.set(row.id, { type: "exact", of: exact.id });
      continue;
    }
    const near = existing.find(
      (e) =>
        e.fileId !== row.fileId &&
        e.accountId === row.accountId &&
        e.amount === row.amount &&
        Math.abs(daysBetween(e.date, row.date)) <= 3 &&
        similarity(e.description, row.description) >= 0.5,
    );
    if (near) out.set(row.id, { type: "near", of: near.id });
  }
  return out;
}

/**
 * Card payments and transfers between our own accounts. A payment on a card and the
 * matching debit from checking within 5 days are both left out; so is a transfer with
 * its opposite on another of our accounts. Returns row id → the row it matched (or null
 * when only one side is in our files).
 */
export function findTransfers(rows: readonly DetectRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const candidates = rows.filter((r) => r.kind === "payment" || r.kind === "transfer");
  const used = new Set<string>();
  for (const row of candidates) {
    if (used.has(row.id)) continue;
    const match = rows.find(
      (other) =>
        other.id !== row.id &&
        !used.has(other.id) &&
        other.accountId !== row.accountId &&
        (other.kind === "payment" || other.kind === "transfer" || other.kind === "deposit") &&
        other.amount === -row.amount &&
        Math.abs(daysBetween(other.date, row.date)) <= 5,
    );
    if (match) {
      used.add(row.id);
      used.add(match.id);
      out.set(row.id, match.id);
      out.set(match.id, row.id);
    } else {
      out.set(row.id, null);
    }
  }
  return out;
}

const PERSON_TO_PERSON = /\b(ZELLE|VENMO|CASH ?APP|SQ ?CASH|APPLE ?CASH|PAYPAL)\b/;

/**
 * Money moving between the two of us ("Zelle payment to Jill") is suggested as a Clean
 * slate, not spending. `partnerNames` are the other person's first names.
 */
export function isPartnerTransfer(description: string, partnerNames: readonly string[]): boolean {
  const d = normalizeText(description);
  if (!PERSON_TO_PERSON.test(d)) return false;
  return partnerNames.some((name) => {
    const n = normalizeText(name).split(" ")[0];
    return !!n && new RegExp(`(^|[^A-Z])${n}([^A-Z]|$)`).test(d);
  });
}

/**
 * Matches a refund to the purchase it reverses: same merchant, within 90 days before,
 * preferring the same amount, else the most recent purchase at least as large.
 */
export function matchRefund(
  refund: { date: ISODate; amount: Cents; description: string },
  purchases: readonly PastPurchase[],
): PastPurchase | null {
  const key = merchantKey(refund.description);
  const size = Math.abs(refund.amount);
  const eligible = purchases.filter((p) => {
    const days = daysBetween(p.date, refund.date);
    return p.amount > 0 && days >= 0 && days <= 90 && merchantKey(p.description) === key;
  });
  if (eligible.length === 0) return null;
  const same = eligible.filter((p) => p.amount === size);
  const pool = same.length > 0 ? same : eligible.filter((p) => p.amount >= size);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
}
