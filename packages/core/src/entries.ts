import { FALLBACK_CATEGORY_ID } from "./categories.ts";
import type { ISODate, MonthKey } from "./dates.ts";
import { placeholders } from "./db/driver.ts";
import { uuidv7 } from "./ids.ts";
import type { CleanSlate, Transaction } from "./model.ts";
import type { Cents } from "./money.ts";
import type { Change, EntityName, FieldValue, Store } from "./store.ts";
import type { Share } from "./words.ts";

/**
 * Transactions in the month: added by hand, edited, moved between Ours and Mine, removed.
 * Ours transactions are shared; Mine stay on their owner's Mac and are shared only as
 * totals by month and category (MineTotal), which this module keeps up to date.
 */

interface TxRow {
  id: string;
  account_id: string | null;
  paid_by: string;
  date: string;
  month: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  note: string | null;
  source: string | null;
  refund_of: string | null;
  added_at: string;
  added_by: string;
  edited_at: string | null;
}

export const TX_COLUMNS =
  "id, account_id, paid_by, date, month, amount, merchant, description, category_id, note, source, refund_of, added_at, added_by, edited_at";

export function toTransaction(row: TxRow, share: Share): Transaction {
  return {
    id: row.id,
    share,
    accountId: row.account_id,
    paidBy: row.paid_by,
    date: row.date,
    month: row.month,
    amount: Number(row.amount),
    merchant: row.merchant ?? "",
    description: row.description,
    categoryId: row.category_id,
    note: row.note,
    source: row.source === "hand" ? "hand" : "statement",
    refundOf: row.refund_of,
    addedAt: row.added_at,
    addedBy: row.added_by,
    editedAt: row.edited_at,
  };
}

export function entityFor(share: Share): EntityName {
  return share === "ours" ? "transaction" : "mineTransaction";
}

export async function getTransaction(store: Store, id: string): Promise<Transaction | null> {
  const ours = await store.db.all<TxRow>(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (ours[0]) return toTransaction(ours[0], "ours");
  const mine = await store.db.all<TxRow>(
    `SELECT ${TX_COLUMNS} FROM mine_transactions WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return mine[0] ? toTransaction(mine[0], "mine") : null;
}

/**
 * Brings this person's Mine totals up to date for the given months and categories. Returns
 * the changes to write (nothing when a total is unchanged).
 */
export async function mineTotalChanges(
  store: Store,
  keys: Iterable<{ month: MonthKey; categoryId: string | null }>,
): Promise<Change[]> {
  const me = store.memberId;
  if (!me) return [];
  const unique = new Map<string, { month: MonthKey; categoryId: string }>();
  for (const k of keys) {
    const categoryId = k.categoryId ?? FALLBACK_CATEGORY_ID;
    unique.set(`${k.month}|${categoryId}`, { month: k.month, categoryId });
  }
  const changes: Change[] = [];
  for (const { month, categoryId } of unique.values()) {
    const [sum] = await store.db.all<{ total: number | null; count: number }>(
      `SELECT SUM(amount) AS total, COUNT(*) AS count FROM mine_transactions
       WHERE deleted_at IS NULL AND month = ? AND COALESCE(category_id, ?) = ?`,
      [month, FALLBACK_CATEGORY_ID, categoryId],
    );
    const total = Number(sum?.total ?? 0);
    const count = Number(sum?.count ?? 0);
    const id = `${me}:${month}:${categoryId}`;
    const [existing] = await store.db.all<{ total: number; count: number }>(
      "SELECT total, count FROM mine_totals WHERE id = ?",
      [id],
    );
    if (existing && Number(existing.total) === total && Number(existing.count) === count) continue;
    if (!existing && count === 0) continue;
    changes.push({
      entity: "mineTotal",
      id,
      fields: { memberId: me, month, categoryId, total, count },
    });
  }
  return changes;
}

export interface HandEntry {
  amount: Cents;
  merchant: string;
  date: ISODate;
  categoryId: string | null;
  share: Share;
  accountId: string | null;
  paidBy: string;
  note?: string | null;
}

/** Manual entries and quick add go straight to the month. */
export function addByHand(store: Store, entry: HandEntry): Promise<string> {
  return store.exclusive(async () => {
    const id = uuidv7();
    const now = new Date().toISOString();
    await store.write([
      {
        entity: entityFor(entry.share),
        id,
        fields: {
          accountId: entry.accountId,
          paidBy: entry.paidBy,
          date: entry.date,
          amount: entry.amount,
          merchant: entry.merchant.trim(),
          description: entry.merchant.trim(),
          categoryId: entry.categoryId,
          note: entry.note ?? null,
          source: "hand",
          addedAt: now,
          addedBy: store.memberId,
        },
      },
    ]);
    if (entry.share === "mine") {
      const totals = await mineTotalChanges(store, [
        { month: entry.date.slice(0, 7), categoryId: entry.categoryId },
      ]);
      if (totals.length) await store.write(totals);
    }
    if (entry.accountId) await store.setMeta({ lastPaidWith: entry.accountId });
    return id;
  });
}

export type TransactionEdit = Partial<{
  categoryId: string | null;
  note: string | null;
  merchant: string;
  amount: Cents;
  date: ISODate;
  paidBy: string;
  accountId: string | null;
}>;

export function editTransaction(
  store: Store,
  tx: Transaction,
  edit: TransactionEdit,
): Promise<void> {
  return store.exclusive(async () => {
    await store.write([
      {
        entity: entityFor(tx.share),
        id: tx.id,
        fields: { ...edit, editedAt: new Date().toISOString() },
      },
    ]);
    if (tx.share === "mine") {
      const totals = await mineTotalChanges(store, [
        { month: tx.month, categoryId: tx.categoryId },
        { month: (edit.date ?? tx.date).slice(0, 7), categoryId: edit.categoryId ?? tx.categoryId },
      ]);
      if (totals.length) await store.write(totals);
    }
  });
}

/**
 * Moves a transaction between Ours and Mine. Making it Mine removes it from the other Mac
 * (its details are blanked in the shared log) and folds it into the Mine totals.
 */
export function switchShare(store: Store, tx: Transaction, to: Share): Promise<void> {
  if (tx.share === to) return Promise.resolve();
  return store.exclusive(async () => {
    const now = new Date().toISOString();
    const fields = {
      accountId: tx.accountId,
      paidBy: tx.paidBy,
      date: tx.date,
      amount: tx.amount,
      merchant: tx.merchant,
      description: tx.description,
      categoryId: tx.categoryId,
      note: tx.note,
      source: tx.source,
      refundOf: tx.refundOf,
      addedAt: tx.addedAt,
      addedBy: tx.addedBy,
      editedAt: now,
      deletedAt: null,
    };
    const removal: Record<string, FieldValue> =
      tx.share === "ours"
        ? { deletedAt: now, merchant: "", description: null, note: null }
        : { deletedAt: now };
    await store.write([
      { entity: entityFor(to), id: tx.id, fields },
      { entity: entityFor(tx.share), id: tx.id, fields: removal },
    ]);
    const totals = await mineTotalChanges(store, [{ month: tx.month, categoryId: tx.categoryId }]);
    if (totals.length) await store.write(totals);
  });
}

export function deleteTransaction(store: Store, tx: Transaction): Promise<void> {
  return store.exclusive(async () => {
    const now = new Date().toISOString();
    const fields: Record<string, FieldValue> =
      tx.share === "ours"
        ? { deletedAt: now, merchant: "", description: null, note: null }
        : { deletedAt: now };
    await store.write([{ entity: entityFor(tx.share), id: tx.id, fields }]);
    if (tx.share === "mine") {
      const totals = await mineTotalChanges(store, [
        { month: tx.month, categoryId: tx.categoryId },
      ]);
      if (totals.length) await store.write(totals);
    }
  });
}

export interface CleanSlateInput {
  from: string;
  to: string;
  amount: Cents;
  date: ISODate;
  appliesTo: MonthKey | "overall";
  note?: string | null;
}

/** Records who gave whom how much, and what it evens out: one month, or everything so far. */
export async function recordCleanSlate(store: Store, input: CleanSlateInput): Promise<string> {
  if (input.from === input.to) throw new Error("A Clean slate goes from one of us to the other.");
  if (!(input.amount > 0)) throw new Error("A Clean slate needs an amount.");
  const id = uuidv7();
  await store.write([
    {
      entity: "cleanSlate",
      id,
      fields: {
        fromMember: input.from,
        toMember: input.to,
        amount: input.amount,
        date: input.date,
        appliesTo: input.appliesTo,
        note: input.note ?? null,
        addedAt: new Date().toISOString(),
        addedBy: store.memberId,
      },
    },
  ]);
  return id;
}

export async function deleteCleanSlate(store: Store, id: string): Promise<void> {
  await store.write([
    { entity: "cleanSlate", id, fields: { deletedAt: new Date().toISOString() } },
  ]);
}

export async function getCleanSlates(store: Store): Promise<CleanSlate[]> {
  const rows = await store.db.all<{
    id: string;
    from_member: string;
    to_member: string;
    amount: number;
    date: string;
    applies_to: string;
    note: string | null;
    added_at: string;
    added_by: string;
  }>(
    "SELECT id, from_member, to_member, amount, date, applies_to, note, added_at, added_by FROM clean_slates WHERE deleted_at IS NULL ORDER BY date DESC, added_at DESC",
  );
  return rows.map((r) => ({
    id: r.id,
    fromMember: r.from_member,
    toMember: r.to_member,
    amount: Number(r.amount),
    date: r.date,
    appliesTo: r.applies_to,
    note: r.note,
    addedAt: r.added_at,
    addedBy: r.added_by,
  }));
}

/** Transactions by id from both tables (for refund lookups and history). */
export async function getTransactionsByIds(
  store: Store,
  ids: readonly string[],
): Promise<Transaction[]> {
  if (ids.length === 0) return [];
  const ours = await store.db.all<TxRow>(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
    [...ids],
  );
  const mine = await store.db.all<TxRow>(
    `SELECT ${TX_COLUMNS} FROM mine_transactions WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
    [...ids],
  );
  return [
    ...ours.map((r) => toTransaction(r, "ours")),
    ...mine.map((r) => toTransaction(r, "mine")),
  ];
}
