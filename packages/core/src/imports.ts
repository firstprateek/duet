import {
  type ColumnMapping,
  type ParsedRow,
  type ParsedStatement,
  readStatement,
} from "@duet/importers";
import type { Category } from "./categories.ts";
import { addDays, dayLabel, daysBetween, type MonthKey, monthOf } from "./dates.ts";
import { chunk, placeholders, type SqlValue, type Statement } from "./db/driver.ts";
import {
  type DetectRow,
  findDuplicates,
  findTransfers,
  isPartnerTransfer,
  matchRefund,
  type PastPurchase,
} from "./detect.ts";
import type { OursEntry } from "./ebbflow.ts";
import { entityFor, mineTotalChanges, recordCleanSlate } from "./entries.ts";
import { getAccounts, getCategories, getMembers } from "./household.ts";
import { sha256Hex, uuidv7 } from "./ids.ts";
import { cleanMerchant, normalizeText } from "./merchants.ts";
import type { Account, AccountKind, Decision, Draft, DraftFlags, StatementFile } from "./model.ts";
import { findRule, type Rule } from "./rules.ts";
import type { Change, Store } from "./store.ts";
import { buildHistory, type HistoryIndex, type Suggestion, suggest } from "./suggest.ts";
import type { Share } from "./words.ts";

/**
 * From a statement file to transactions in the month: recognize the file, find the account
 * (or ask about a new card), turn rows into drafts with duplicates, card payments, transfers
 * and refunds flagged, suggest a category and Ours or Mine for the rest, then add what we
 * sorted. Drafts, set-aside rows and the file itself never leave this Mac.
 */

export type ImportOutcome =
  | { status: "already"; file: StatementFile }
  | { status: "needs-setup"; parsed: ParsedStatement; sha256: string }
  | {
      status: "new-account";
      parsed: ParsedStatement;
      sha256: string;
      suggestion: NewAccountSuggestion;
    }
  | { status: "empty"; parsed: ParsedStatement; sha256: string }
  | { status: "ready"; fileId: string; accountId: string };

export interface NewAccountSuggestion {
  institution: string;
  name: string;
  last4: string | null;
  kind: AccountKind;
  rows: number;
  /** Words for the green note: "Citi's file layout is familiar: date, description, debit and credit." */
  layoutNote: string | null;
}

export interface FileInput {
  fileName: string;
  bytes: Uint8Array;
  parsed: ParsedStatement;
  path?: string | null;
}

const KIND_NAMES: Record<string, string> = {
  credit: "card",
  checking: "checking",
  savings: "savings",
};

export async function fileSha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

export async function findFileBySha(store: Store, sha256: string): Promise<StatementFile | null> {
  const files = await listFiles(store, "sha256 = ?", [sha256]);
  return files[0] ?? null;
}

/** Which of our accounts a statement belongs to, if we know it already. */
export function matchAccount(
  parsed: ParsedStatement,
  accounts: readonly Account[],
): Account | null {
  if (!parsed.institution) return null;
  const same = accounts.filter(
    (a) => a.institution.toLowerCase() === parsed.institution!.toLowerCase() && a.kind !== "cash",
  );
  if (parsed.accountLast4) {
    return same.find((a) => a.last4 === parsed.accountLast4) ?? null;
  }
  const byProfile = same.filter((a) => a.profileId && a.profileId === parsed.profileId);
  if (byProfile.length === 1) return byProfile[0]!;
  return same.length === 1 && !same[0]!.last4 ? same[0]! : null;
}

function layoutNote(parsed: ParsedStatement): string | null {
  if (!parsed.institution) return null;
  if (parsed.format === "ofx")
    return `${parsed.institution}'s ${parsed.format.toUpperCase()} file reads cleanly.`;
  const cols = parsed.headers.map((h) => h.toLowerCase());
  const parts: string[] = [];
  if (cols.some((c) => c.includes("date"))) parts.push("date");
  if (cols.some((c) => c.includes("description") || c.includes("payee"))) parts.push("description");
  if (cols.includes("debit") && cols.includes("credit")) parts.push("debit and credit");
  else if (cols.some((c) => c.startsWith("amount"))) parts.push("amount");
  if (parts.length === 0) return null;
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${parsed.institution}'s file layout is familiar: ${list}.`;
}

/** Step one: is this file new, and do we know its account? */
export async function beginImport(store: Store, input: FileInput): Promise<ImportOutcome> {
  const sha256 = await fileSha256(input.bytes);
  const existing = await findFileBySha(store, sha256);
  if (existing && existing.status !== "removed" && existing.status !== "needs-setup") {
    return { status: "already", file: existing };
  }
  const custom = await applyCustomProfile(store, input);
  if (custom) input = { ...input, parsed: custom };
  const { parsed } = input;
  if (!parsed.profileId && parsed.rows.length === 0)
    return { status: "needs-setup", parsed, sha256 };
  if (parsed.rows.length === 0) return { status: "empty", parsed, sha256 };
  const accounts = await getAccounts(store);
  const account = matchAccount(parsed, accounts);
  if (!account) {
    const institution = parsed.institution ?? "New account";
    const kind: AccountKind = parsed.accountKind ?? "credit";
    return {
      status: "new-account",
      parsed,
      sha256,
      suggestion: {
        institution,
        name: `${institution} ${KIND_NAMES[kind] ?? "account"}`,
        last4: parsed.accountLast4 ?? null,
        kind,
        rows: parsed.rows.length,
        layoutNote: layoutNote(parsed),
      },
    };
  }
  const fileId = await createDrafts(store, input, account, sha256);
  return { status: "ready", fileId, accountId: account.id };
}

/** Step two, after "New card found" or the column match: the account is known. */
export async function finishImport(
  store: Store,
  input: FileInput,
  accountId: string,
): Promise<ImportOutcome> {
  const sha256 = await fileSha256(input.bytes);
  const accounts = await getAccounts(store, true);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("That account doesn't exist.");
  await forgetSetupFile(store, sha256);
  const fileId = await createDrafts(store, input, account, sha256);
  return { status: "ready", fileId, accountId };
}

interface Context {
  me: string;
  partnerNames: string[];
  accounts: Account[];
  categories: Category[];
  rules: Rule[];
  history: HistoryIndex;
}

async function loadContext(store: Store): Promise<Context> {
  const members = await getMembers(store);
  const me = store.memberId ?? members[0]?.id ?? "";
  const partnerNames = members.filter((m) => m.id !== me).map((m) => m.name);
  const [accounts, categories, rules, history] = await Promise.all([
    getAccounts(store, true),
    getCategories(store),
    getRules(store),
    loadHistory(store),
  ]);
  return { me, partnerNames, accounts, categories, rules, history };
}

export async function getRules(store: Store): Promise<Rule[]> {
  type RuleRow = {
    id: string;
    match: string;
    pattern: string;
    category_id: string | null;
    share: string | null;
  };
  const household = await store.db.all<RuleRow>(
    "SELECT id, match, pattern, category_id, share FROM household_rules WHERE deleted_at IS NULL",
  );
  const personal = await store.db.all<RuleRow>(
    "SELECT id, match, pattern, category_id, share FROM personal_rules WHERE deleted_at IS NULL",
  );
  const toRule = (r: RuleRow, scope: Rule["scope"]): Rule => ({
    id: r.id,
    match: r.match === "exact" || r.match === "pattern" ? r.match : "contains",
    pattern: r.pattern ?? "",
    categoryId: r.category_id,
    share: r.share === "ours" || r.share === "mine" ? r.share : null,
    scope,
  });
  return [
    ...household.map((r) => toRule(r, "household")),
    ...personal.map((r) => toRule(r, "personal")),
  ];
}

/** Our sorted history: Ours from both of us, and this person's own Mine. */
async function loadHistory(store: Store): Promise<HistoryIndex> {
  const rows = await store.db.all<{
    description: string | null;
    merchant: string | null;
    category_id: string | null;
    share: string;
  }>(
    `SELECT description, merchant, category_id, 'ours' AS share FROM transactions WHERE deleted_at IS NULL
     UNION ALL
     SELECT description, merchant, category_id, 'mine' AS share FROM mine_transactions WHERE deleted_at IS NULL`,
  );
  return buildHistory(
    rows.map((r) => ({
      description: r.description || r.merchant || "",
      categoryId: r.category_id,
      share: r.share === "mine" ? "mine" : "ours",
    })),
  );
}

function detectRow(
  id: string,
  row: { date: string; amount: number; description: string; kind: string },
  account: Account,
  fileId: string | null,
): DetectRow {
  return {
    id,
    accountId: account.id,
    accountKind: account.kind,
    ownerId: account.ownerId,
    fileId,
    date: row.date,
    amount: row.amount,
    description: row.description,
    kind: row.kind as DetectRow["kind"],
  };
}

async function createDrafts(
  store: Store,
  input: FileInput,
  account: Account,
  sha256: string,
): Promise<string> {
  return store.exclusive(async () => {
    const ctx = await loadContext(store);
    const { parsed } = input;
    const fileId = uuidv7();
    const now = new Date().toISOString();
    const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
    const first = parsed.firstDate ?? parsed.rows[0]?.date ?? now.slice(0, 10);
    const last = parsed.lastDate ?? first;
    const windowFrom = addDays(first, -5);
    const windowTo = addDays(last, 5);

    const drafts = parsed.rows.map((row) => ({ id: uuidv7(), row }));
    const newRows = drafts.map(({ id, row }) => detectRow(id, row, account, fileId));

    // Rows we already have for this account: earlier drafts and added transactions.
    const existingDrafts = await store.db.all<{
      id: string;
      account_id: string;
      file_id: string | null;
      date: string;
      amount: number;
      description: string;
      kind: string;
      flags: string;
      decision: string;
    }>(
      "SELECT id, account_id, file_id, date, amount, description, kind, flags, decision FROM drafts WHERE date BETWEEN ? AND ?",
      [windowFrom, windowTo],
    );
    const existingTx = await store.db.all<{
      id: string;
      date: string;
      amount: number;
      description: string | null;
    }>(
      `SELECT id, date, amount, description FROM transactions WHERE deleted_at IS NULL AND account_id = ? AND date BETWEEN ? AND ?
       UNION ALL
       SELECT id, date, amount, description FROM mine_transactions WHERE deleted_at IS NULL AND account_id = ? AND date BETWEEN ? AND ?`,
      [account.id, windowFrom, windowTo, account.id, windowFrom, windowTo],
    );
    const existingForDupes: DetectRow[] = [
      ...existingDrafts
        .filter((d) => d.account_id === account.id)
        .map((d) => ({
          id: d.id,
          accountId: d.account_id,
          accountKind: account.kind,
          ownerId: account.ownerId,
          fileId: d.file_id,
          date: d.date,
          amount: Number(d.amount),
          description: d.description,
          kind: d.kind as DetectRow["kind"],
        })),
      ...existingTx.map((t) => ({
        id: t.id,
        accountId: account.id,
        accountKind: account.kind,
        ownerId: account.ownerId,
        fileId: "added",
        date: t.date,
        amount: Number(t.amount),
        description: t.description ?? "",
        kind: "purchase" as const,
      })),
    ];
    const duplicates = findDuplicates(newRows, existingForDupes);

    // Transfers can pair with rows from other files (the card payment and the bank debit).
    const otherMoneyMoves: DetectRow[] = existingDrafts
      .filter((d) => d.kind === "payment" || d.kind === "transfer" || d.kind === "deposit")
      .filter((d) => {
        const flags = JSON.parse(d.flags || "{}") as DraftFlags;
        return !flags.transfer?.matchedWith;
      })
      .map((d) => {
        const a = accountById.get(d.account_id);
        return {
          id: d.id,
          accountId: d.account_id,
          accountKind: a?.kind ?? "checking",
          ownerId: a?.ownerId ?? "",
          fileId: d.file_id,
          date: d.date,
          amount: Number(d.amount),
          description: d.description,
          kind: d.kind as DetectRow["kind"],
        };
      });
    const transfers = findTransfers([...newRows, ...otherMoneyMoves]);
    const earlierUpdates: Statement[] = [];
    for (const d of otherMoneyMoves) {
      const partner = transfers.get(d.id);
      if (partner && newRows.some((r) => r.id === partner)) {
        const original = existingDrafts.find((e) => e.id === d.id)!;
        const flags = {
          ...(JSON.parse(original.flags || "{}") as DraftFlags),
          transfer: { matchedWith: partner },
        };
        earlierUpdates.push({
          sql: "UPDATE drafts SET flags = ? WHERE id = ?",
          params: [JSON.stringify(flags), d.id],
        });
      }
    }

    // Purchases a refund may reverse: added ones, and purchases in this same file.
    const past = await pastPurchases(store, account, addDays(first, -90), last);
    for (const { id, row } of drafts) {
      if (row.kind === "purchase") {
        past.push({
          id,
          date: row.date,
          amount: row.amount,
          description: row.description,
          merchant: row.merchant ?? cleanMerchant(row.description),
          categoryId: null,
          share: null,
        });
      }
    }

    const statements: Statement[] = [
      {
        sql: `INSERT INTO statement_files (id, file_name, sha256, path, account_id, profile_id, format, first_date, last_date, brought_in_at, status, row_count, skipped_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sorting', ?, ?)`,
        params: [
          fileId,
          input.fileName,
          sha256,
          input.path ?? null,
          account.id,
          parsed.profileId,
          parsed.format,
          parsed.firstDate,
          parsed.lastDate,
          now,
          parsed.rows.length,
          parsed.skipped,
        ],
      },
    ];

    for (const { id, row } of drafts) {
      const merchant = row.merchant?.trim() || cleanMerchant(row.description);
      const flags: DraftFlags = {};
      let decision: Decision = "pending";
      let suggestion: Suggestion | null = null;
      let refundOf: string | null = null;
      let categoryId: string | null = null;

      const dupe = duplicates.get(id);
      if (dupe) flags.duplicate = dupe;

      if (dupe?.type === "exact") {
        decision = "aside";
        flags.asideReason = "Already added from an earlier file";
      } else if (row.kind === "payment") {
        decision = "aside";
        flags.cardPayment = true;
        flags.transfer = { matchedWith: transfers.get(id) ?? null };
        flags.asideReason = "Card payment, set aside for you";
      } else if (row.kind === "transfer") {
        decision = "aside";
        flags.transfer = { matchedWith: transfers.get(id) ?? null };
        flags.asideReason = "Moving money between our accounts";
      } else if (row.kind === "deposit") {
        decision = "aside";
        flags.deposit = true;
        flags.transfer = { matchedWith: transfers.get(id) ?? null };
        flags.asideReason = "Money coming in, set aside for you";
      } else if (row.amount > 0 && isPartnerTransfer(row.description, ctx.partnerNames)) {
        flags.cleanSlateCandidate = true;
      } else {
        suggestion = suggest(
          {
            description: row.description,
            merchant,
            bankCategory: row.bankCategory,
            accountDefault: account.defaultShare,
          },
          ctx,
        );
        categoryId = suggestion.categoryId;
        if (row.kind === "refund") {
          const match = matchRefund(row, past);
          flags.refund = { of: match?.id ?? null };
          if (match) {
            flags.refund.ofDate = match.date;
            refundOf = match.id;
            if (match.categoryId) categoryId = match.categoryId;
            suggestion = {
              ...suggestion,
              categoryId,
              share: match.share ?? suggestion.share,
              tier: "refund",
              confidence: 1,
              why: `A refund of the ${dayLabel(match.date)} ${match.merchant} purchase, so it follows that purchase's category and who it was for.`,
            };
          }
        }
        // A rule decides the row, unless it might be a duplicate: those wait for one of us.
        const rule = findRule(ctx.rules, row.description, merchant);
        if (!flags.duplicate && suggestion.tier === "rule" && rule?.share) decision = rule.share;
      }

      statements.push({
        sql: `INSERT INTO drafts (id, file_id, account_id, row_index, date, amount, description, merchant, bank_category, bank_id, kind, person,
                category_id, confidence, tier, alternatives, why, suggested_share, flags, decision, refund_of, decided_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          fileId,
          account.id,
          row.index,
          row.date,
          row.amount,
          row.description,
          merchant,
          row.bankCategory ?? null,
          row.bankId ?? null,
          row.kind,
          row.person ?? null,
          categoryId,
          suggestion?.confidence ?? 0,
          suggestion?.tier ?? "none",
          JSON.stringify(suggestion?.alternatives ?? []),
          suggestion?.why ?? null,
          suggestion?.share ?? null,
          JSON.stringify(flags),
          decision,
          refundOf,
          decision === "pending" ? null : now,
        ],
      });
    }
    await store.db.batch([...statements, ...earlierUpdates]);
    store.notify(["drafts", "files"]);
    return fileId;
  });
}

async function pastPurchases(
  store: Store,
  account: Account,
  from: string,
  to: string,
): Promise<PastPurchase[]> {
  const rows = await store.db.all<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
    merchant: string | null;
    category_id: string | null;
    share: string;
  }>(
    `SELECT t.id, t.date, t.amount, t.description, t.merchant, t.category_id, 'ours' AS share
       FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.deleted_at IS NULL AND t.amount > 0 AND a.owner_id = ? AND t.date BETWEEN ? AND ?
     UNION ALL
     SELECT m.id, m.date, m.amount, m.description, m.merchant, m.category_id, 'mine' AS share
       FROM mine_transactions m
      WHERE m.deleted_at IS NULL AND m.amount > 0 AND m.date BETWEEN ? AND ?
     UNION ALL
     SELECT d.id, d.date, d.amount, d.description, d.merchant, d.category_id,
            CASE d.decision WHEN 'mine' THEN 'mine' WHEN 'ours' THEN 'ours' ELSE '' END AS share
       FROM drafts d
      WHERE d.amount > 0 AND d.kind = 'purchase' AND d.account_id = ? AND d.date BETWEEN ? AND ?`,
    [account.ownerId, from, to, from, to, account.id, from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    description: r.description ?? r.merchant ?? "",
    merchant: r.merchant ?? "",
    categoryId: r.category_id,
    share: r.share === "ours" || r.share === "mine" ? r.share : null,
  }));
}

// ————— Reading files and drafts —————

interface FileRow {
  id: string;
  file_name: string;
  sha256: string;
  path: string | null;
  account_id: string | null;
  profile_id: string | null;
  format: string | null;
  first_date: string | null;
  last_date: string | null;
  brought_in_at: string;
  status: string;
  row_count: number;
  skipped_count: number;
  removed_at: string | null;
  pending: number | null;
  decided: number | null;
  added: number | null;
  aside: number | null;
}

async function listFiles(
  store: Store,
  where: string,
  params: SqlValue[],
): Promise<StatementFile[]> {
  const rows = await store.db.all<FileRow>(
    `SELECT f.*,
       (SELECT COUNT(*) FROM drafts d WHERE d.file_id = f.id AND d.decision = 'pending') AS pending,
       (SELECT COUNT(*) FROM drafts d WHERE d.file_id = f.id AND d.decision IN ('ours', 'mine') AND d.added_at IS NULL) AS decided,
       (SELECT COUNT(*) FROM drafts d WHERE d.file_id = f.id AND d.added_at IS NOT NULL) AS added,
       (SELECT COUNT(*) FROM drafts d WHERE d.file_id = f.id AND d.decision = 'aside') AS aside
     FROM statement_files f WHERE ${where} ORDER BY f.brought_in_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    sha256: r.sha256,
    path: r.path,
    accountId: r.account_id,
    profileId: r.profile_id,
    format: r.format,
    firstDate: r.first_date,
    lastDate: r.last_date,
    broughtInAt: r.brought_in_at,
    status: r.removed_at ? "removed" : (r.status as StatementFile["status"]),
    rowCount: Number(r.row_count),
    skippedCount: Number(r.skipped_count),
    pending: Number(r.pending ?? 0),
    decided: Number(r.decided ?? 0),
    added: Number(r.added ?? 0),
    aside: Number(r.aside ?? 0),
  }));
}

export function getFiles(store: Store): Promise<StatementFile[]> {
  return listFiles(store, "f.removed_at IS NULL", []);
}

export async function getFile(store: Store, id: string): Promise<StatementFile | null> {
  return (await listFiles(store, "f.id = ?", [id]))[0] ?? null;
}

interface DraftRow {
  id: string;
  file_id: string | null;
  account_id: string;
  row_index: number | null;
  date: string;
  amount: number;
  description: string;
  merchant: string;
  bank_category: string | null;
  bank_id: string | null;
  kind: string;
  person: string | null;
  category_id: string | null;
  confidence: number;
  tier: string;
  alternatives: string;
  why: string | null;
  suggested_share: string | null;
  flags: string;
  decision: string;
  note: string | null;
  refund_of: string | null;
  decided_at: string | null;
  added_at: string | null;
  added_tx_id: string | null;
}

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    fileId: r.file_id,
    accountId: r.account_id,
    rowIndex: r.row_index,
    date: r.date,
    amount: Number(r.amount),
    description: r.description,
    merchant: r.merchant,
    bankCategory: r.bank_category,
    bankId: r.bank_id,
    kind: r.kind,
    person: r.person,
    categoryId: r.category_id,
    confidence: Number(r.confidence),
    tier: r.tier as Draft["tier"],
    alternatives: JSON.parse(r.alternatives || "[]"),
    why: r.why,
    suggestedShare:
      r.suggested_share === "ours" || r.suggested_share === "mine" ? r.suggested_share : null,
    flags: JSON.parse(r.flags || "{}"),
    decision: r.decision as Decision,
    note: r.note,
    refundOf: r.refund_of,
    decidedAt: r.decided_at,
    addedAt: r.added_at,
    addedTxId: r.added_tx_id,
  };
}

/** Rows of one file, newest first, including the ones already added. */
export async function getDrafts(store: Store, fileId: string): Promise<Draft[]> {
  const rows = await store.db.all<DraftRow>(
    "SELECT * FROM drafts WHERE file_id = ? ORDER BY date DESC, row_index",
    [fileId],
  );
  return rows.map(toDraft);
}

/** Everything still waiting to be sorted or added, across files. */
export async function getOpenDrafts(store: Store): Promise<Draft[]> {
  const rows = await store.db.all<DraftRow>(
    "SELECT * FROM drafts WHERE added_at IS NULL AND decision <> 'aside' ORDER BY date DESC, row_index",
  );
  return rows.map(toDraft);
}

export async function countToSort(store: Store): Promise<number> {
  const [row] = await store.db.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM drafts d JOIN statement_files f ON f.id = d.file_id
     WHERE f.removed_at IS NULL AND d.decision = 'pending'`,
  );
  return Number(row?.n ?? 0);
}

// ————— Sorting —————

async function updateDrafts(
  store: Store,
  ids: readonly string[],
  set: string,
  params: SqlValue[],
): Promise<void> {
  if (ids.length === 0) return;
  await store.db.batch(
    chunk(ids, 400).map((part) => ({
      sql: `UPDATE drafts SET ${set} WHERE added_at IS NULL AND id IN (${placeholders(part.length)})`,
      params: [...params, ...part],
    })),
  );
  store.notify(["drafts", "files"]);
}

/** O, M and Delete in To sort: Ours, Mine, or set aside. */
export async function decide(
  store: Store,
  draftIds: readonly string[],
  decision: Decision,
): Promise<void> {
  await updateDrafts(store, draftIds, "decision = ?, decided_at = ?", [
    decision,
    decision === "pending" ? null : new Date().toISOString(),
  ]);
}

/**
 * Picks a category. With `always`, it also becomes a rule: a household rule when the row is
 * Ours, a personal rule (which stays on this Mac) when it is Mine.
 */
export async function setDraftCategory(
  store: Store,
  draftIds: readonly string[],
  categoryId: string,
  options: { always?: boolean } = {},
): Promise<void> {
  await updateDrafts(store, draftIds, "category_id = ?, tier = 'you', confidence = 1", [
    categoryId,
  ]);
  if (!options.always) return;
  const [draft] = await store.db.all<DraftRow>("SELECT * FROM drafts WHERE id = ?", [
    draftIds[0] ?? "",
  ]);
  if (!draft) return;
  const share: Share | null =
    draft.decision === "ours" || draft.decision === "mine"
      ? draft.decision
      : draft.suggested_share === "ours" || draft.suggested_share === "mine"
        ? draft.suggested_share
        : null;
  await addRule(store, { pattern: draft.merchant, categoryId, share });
}

export async function addRule(
  store: Store,
  input: { pattern: string; categoryId: string | null; share: Share | null; match?: Rule["match"] },
): Promise<string> {
  const id = uuidv7();
  await store.write([
    {
      entity: input.share === "mine" ? "personalRule" : "householdRule",
      id,
      fields: {
        match: input.match ?? "contains",
        pattern: normalizeText(input.pattern),
        categoryId: input.categoryId,
        share: input.share,
        createdAt: new Date().toISOString(),
        createdBy: store.memberId,
      },
    },
  ]);
  return id;
}

export async function deleteRule(store: Store, rule: Rule): Promise<void> {
  await store.write([
    {
      entity: rule.scope === "personal" ? "personalRule" : "householdRule",
      id: rule.id,
      fields: { deletedAt: new Date().toISOString() },
    },
  ]);
}

export async function setDraftNote(
  store: Store,
  draftId: string,
  note: string | null,
): Promise<void> {
  await updateDrafts(store, [draftId], "note = ?", [note]);
}

/** A Zelle or transfer between the two of us becomes a Clean slate instead of spending. */
export async function makeCleanSlateFromDraft(
  store: Store,
  draftId: string,
  appliesTo: MonthKey | "overall",
): Promise<string> {
  const [draft] = await store.db.all<DraftRow>("SELECT * FROM drafts WHERE id = ?", [draftId]);
  if (!draft) throw new Error("That row is gone.");
  const accounts = await getAccounts(store, true);
  const members = await getMembers(store);
  const owner = accounts.find((a) => a.id === draft.account_id)?.ownerId ?? store.memberId ?? "";
  const partner = members.find((m) => m.id !== owner)?.id ?? "";
  const giving = Number(draft.amount) > 0;
  const id = await recordCleanSlate(store, {
    from: giving ? owner : partner,
    to: giving ? partner : owner,
    amount: Math.abs(Number(draft.amount)),
    date: draft.date,
    appliesTo,
    note: null,
  });
  const flags = {
    ...(JSON.parse(draft.flags || "{}") as DraftFlags),
    cleanSlateId: id,
    asideReason: "Recorded as a Clean slate",
  };
  await store.db.run(
    "UPDATE drafts SET decision = 'aside', decided_at = ?, flags = ? WHERE id = ?",
    [new Date().toISOString(), JSON.stringify(flags), draftId],
  );
  store.notify(["drafts", "files"]);
  return id;
}

export interface AddSummary {
  ours: { count: number; total: number };
  mine: { count: number; total: number };
  aside: { count: number; reasons: string[] };
  waiting: number;
  months: MonthKey[];
  /** The Ours rows, for "How this changes Ebb & flow". */
  oursEntries: OursEntry[];
}

async function decidedDrafts(
  store: Store,
  fileId: string,
): Promise<{ ready: Draft[]; all: Draft[] }> {
  const all = await getDrafts(store, fileId);
  const ready = all.filter((d) => (d.decision === "ours" || d.decision === "mine") && !d.addedAt);
  return { ready, all };
}

/** What "Add to August" would do, for the confirmation screen. */
export async function previewAdd(store: Store, fileId: string): Promise<AddSummary> {
  const { ready, all } = await decidedDrafts(store, fileId);
  const accounts = await getAccounts(store, true);
  const owner = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.ownerId ?? store.memberId ?? "";
  const ours = ready.filter((d) => d.decision === "ours");
  const mine = ready.filter((d) => d.decision === "mine");
  const aside = all.filter((d) => d.decision === "aside" && !d.addedAt);
  const months = [...new Set(ready.map((d) => monthOf(d.date)))].sort();
  return {
    ours: { count: ours.length, total: ours.reduce((s, d) => s + d.amount, 0) },
    mine: { count: mine.length, total: mine.reduce((s, d) => s + d.amount, 0) },
    aside: { count: aside.length, reasons: aside.map((d) => d.flags.asideReason ?? "Set aside") },
    waiting: all.filter((d) => d.decision === "pending").length,
    months,
    oursEntries: ours.map((d) => ({
      month: monthOf(d.date),
      amount: d.amount,
      paidBy: owner(d.accountId),
    })),
  };
}

/** "Add 38 to August": sorted rows become transactions in the month. */
export function addToMonth(store: Store, fileId: string): Promise<AddSummary> {
  return store.exclusive(async () => {
    const summary = await previewAdd(store, fileId);
    const { ready, all } = await decidedDrafts(store, fileId);
    if (ready.length === 0) return summary;
    const accounts = await getAccounts(store, true);
    const now = new Date().toISOString();
    const changes: Change[] = [];
    const extra: Statement[] = [];
    for (const d of ready) {
      const share = d.decision as Share;
      const owner = accounts.find((a) => a.id === d.accountId)?.ownerId ?? store.memberId;
      const txId = d.id;
      changes.push({
        entity: entityFor(share),
        id: txId,
        fields: {
          accountId: d.accountId,
          paidBy: owner,
          date: d.date,
          amount: d.amount,
          merchant: d.merchant,
          description: d.description,
          categoryId: d.categoryId,
          note: d.note,
          source: "statement",
          refundOf: d.refundOf,
          addedAt: now,
          addedBy: store.memberId,
        },
      });
      extra.push({
        sql: "UPDATE drafts SET added_at = ?, added_tx_id = ? WHERE id = ?",
        params: [now, txId, d.id],
      });
    }
    const stillPending = all.some((d) => d.decision === "pending");
    extra.push({
      sql: "UPDATE statement_files SET status = ? WHERE id = ?",
      params: [stillPending ? "sorting" : "added", fileId],
    });
    await store.write(changes, extra);
    const totals = await mineTotalChanges(
      store,
      ready
        .filter((d) => d.decision === "mine")
        .map((d) => ({ month: monthOf(d.date), categoryId: d.categoryId })),
    );
    if (totals.length) await store.write(totals);
    store.notify(["drafts", "files"]);
    return summary;
  });
}

/** Removes a file. Its unsorted rows go too; with `removeAdded`, so do the transactions it added. */
export function removeFile(
  store: Store,
  fileId: string,
  options: { removeAdded: boolean },
): Promise<void> {
  return store.exclusive(async () => {
    const all = await getDrafts(store, fileId);
    const now = new Date().toISOString();
    if (options.removeAdded) {
      const addedIds = all.map((d) => d.addedTxId).filter((id): id is string => !!id);
      const ours = addedIds.length
        ? await store.db.all<{ id: string }>(
            `SELECT id FROM transactions WHERE deleted_at IS NULL AND id IN (${placeholders(addedIds.length)})`,
            addedIds,
          )
        : [];
      const mine = addedIds.length
        ? await store.db.all<{ id: string; month: string; category_id: string | null }>(
            `SELECT id, month, category_id FROM mine_transactions WHERE deleted_at IS NULL AND id IN (${placeholders(addedIds.length)})`,
            addedIds,
          )
        : [];
      await store.write([
        ...ours.map((r) => ({
          entity: "transaction" as const,
          id: r.id,
          fields: { deletedAt: now, merchant: "", description: null, note: null },
        })),
        ...mine.map((r) => ({
          entity: "mineTransaction" as const,
          id: r.id,
          fields: { deletedAt: now },
        })),
      ]);
      const totals = await mineTotalChanges(
        store,
        mine.map((r) => ({ month: r.month, categoryId: r.category_id })),
      );
      if (totals.length) await store.write(totals);
    }
    await store.db.batch([
      { sql: "DELETE FROM drafts WHERE file_id = ? AND added_at IS NULL", params: [fileId] },
      {
        sql: "UPDATE statement_files SET removed_at = ?, status = 'removed' WHERE id = ?",
        params: [now, fileId],
      },
    ]);
    store.notify(["drafts", "files"]);
  });
}

/**
 * Re-reads a file with an improved profile. Only rows not yet decided change; decided and
 * added rows are left as they are.
 */
export function rereadFile(store: Store, fileId: string, parsed: ParsedStatement): Promise<number> {
  return store.exclusive(async () => {
    const file = await getFile(store, fileId);
    if (!file?.accountId) throw new Error("That file is gone.");
    const drafts = await getDrafts(store, fileId);
    const byIndex = new Map(parsed.rows.map((r) => [r.index, r] as [number, ParsedRow]));
    const statements: Statement[] = [];
    let changed = 0;
    for (const d of drafts) {
      if (d.decision !== "pending" || d.rowIndex === null) continue;
      const row = byIndex.get(d.rowIndex);
      if (!row) continue;
      statements.push({
        sql: "UPDATE drafts SET date = ?, amount = ?, description = ?, merchant = ?, bank_category = ?, kind = ? WHERE id = ?",
        params: [
          row.date,
          row.amount,
          row.description,
          row.merchant?.trim() || cleanMerchant(row.description),
          row.bankCategory ?? null,
          row.kind,
          d.id,
        ],
      });
      changed++;
    }
    if (statements.length) await store.db.batch(statements);
    store.notify(["drafts"]);
    return changed;
  });
}

/** The accounts we expect a statement from each month, and which have one. */
const INSTITUTION_ALIASES: Record<string, string[]> = {
  "American Express": ["AMEX", "AMERICANEXPRESS"],
  "Capital One": ["CAPITALONE", "CAPONE"],
  Discover: ["DISCOVER"],
  Chase: ["CHASE"],
  "Apple Card": ["APPLECARD", "APPLE"],
  "Bread Cashback": ["BREAD"],
  Citi: ["CITI"],
  DCU: ["DCU"],
  "Wells Fargo": ["WF", "WELLSFARGO"],
  "Bank of America": ["BOFA", "BANKOFAMERICA"],
};

/**
 * Which of our accounts a file probably comes from, going by its name ("DCU_Export_0901.xlsx",
 * "Chase4417_Activity.CSV"). Only a hint for Uploads: the one-time setup still asks.
 */
export function guessAccountFromName(
  fileName: string,
  accounts: readonly Account[],
): Account | null {
  const upper = fileName.toUpperCase().replace(/\.[A-Z0-9]+$/, "");
  const tokens = new Set(upper.split(/[^A-Z0-9]+/).filter(Boolean));
  const joined = upper.replace(/[^A-Z]/g, "");
  const named = (institution: string) => {
    const first = institution.toUpperCase().split(/\s+/)[0] ?? "";
    const aliases = INSTITUTION_ALIASES[institution] ?? (first.length >= 3 ? [first] : []);
    return aliases.some((a) => (a.length <= 4 ? tokens.has(a) : joined.includes(a)));
  };
  const candidates = accounts.filter(
    (a) => a.kind !== "cash" && a.kind !== "wallet" && named(a.institution),
  );
  if (candidates.length === 1) return candidates[0]!;
  const byDigits = candidates.filter((a) => a.last4 && upper.includes(a.last4));
  return byDigits.length === 1 ? byDigits[0]! : null;
}

/**
 * Whether a statement belongs to a month. One of about a month (Jul 2 to Aug 1) belongs to
 * the month most of it falls in; a longer export belongs to every month it spans.
 */
export function fileCoversMonth(
  firstDate: string | null,
  lastDate: string | null,
  month: MonthKey,
): boolean {
  if (!firstDate || !lastDate) return false;
  const span = daysBetween(firstDate, lastDate);
  if (span <= 45) return monthOf(addDays(firstDate, Math.floor(span / 2))) === month;
  return firstDate <= `${month}-31` && lastDate >= `${month}-01`;
}

export interface AccountCoverage {
  account: Account;
  /** A statement for the month is in (or waiting for its one-time setup). */
  covered: boolean;
  /** The month's statement is waiting for its one-time setup. */
  needsSetup: boolean;
}

export async function accountCoverage(store: Store, month: MonthKey): Promise<AccountCoverage[]> {
  const accounts = (await getAccounts(store)).filter(
    (a) => a.kind !== "cash" && a.kind !== "wallet",
  );
  const files = await store.db.all<{
    account_id: string | null;
    file_name: string;
    status: string;
    first_date: string;
    last_date: string;
  }>(
    `SELECT account_id, file_name, status, first_date, last_date FROM statement_files
     WHERE removed_at IS NULL AND first_date <= ? AND last_date >= ?`,
    [`${month}-31`, `${month}-01`],
  );
  const fromTx = await store.db.all<{ account_id: string }>(
    "SELECT DISTINCT account_id FROM transactions WHERE deleted_at IS NULL AND source = 'statement' AND month = ?",
    [month],
  );
  // Our own statements are on this Mac; the other person's show through what they added.
  const inMonth = files.filter((f) => fileCoversMonth(f.first_date, f.last_date, month));
  const fromFiles = new Set(inMonth.filter((f) => f.account_id).map((f) => f.account_id!));
  const mine = accounts.filter((a) => a.ownerId === store.memberId);
  const waiting = new Set(
    inMonth
      .filter((f) => f.status === "needs-setup")
      .map((f) => guessAccountFromName(f.file_name, mine)?.id)
      .filter((id): id is string => !!id),
  );
  const added = new Set(fromTx.map((r) => r.account_id));
  return accounts.map((account) => {
    const inFiles =
      fromFiles.has(account.id) || (account.ownerId !== store.memberId && added.has(account.id));
    const needsSetup = !inFiles && waiting.has(account.id);
    return { account, covered: inFiles || needsSetup, needsSetup };
  });
}

/**
 * Keeps an unfamiliar file in Uploads ("New layout · one quick setup") when we choose to
 * match its columns later. Only its name, hash and location are kept.
 */
export async function rememberForSetup(
  store: Store,
  input: {
    fileName: string;
    sha256: string;
    path: string | null;
    format: string;
    firstDate?: string | null;
    lastDate?: string | null;
    rowCount?: number;
  },
): Promise<string> {
  const existing = await findFileBySha(store, input.sha256);
  if (existing && existing.status === "needs-setup") return existing.id;
  const id = uuidv7();
  await store.db.run(
    `INSERT INTO statement_files (id, file_name, sha256, path, format, first_date, last_date, brought_in_at, status, row_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs-setup', ?)`,
    [
      id,
      input.fileName,
      input.sha256,
      input.path,
      input.format,
      input.firstDate ?? null,
      input.lastDate ?? null,
      new Date().toISOString(),
      input.rowCount ?? 0,
    ],
  );
  store.notify(["files"]);
  return id;
}

/** Forgets a waiting file once it has been set up (its rows now come from a real import). */
export async function forgetSetupFile(store: Store, sha256: string): Promise<void> {
  await store.db.run("DELETE FROM statement_files WHERE sha256 = ? AND status = 'needs-setup'", [
    sha256,
  ]);
  store.notify(["files"]);
}

/** A column mapping we made by hand for one bank's layout, kept on this Mac. */
export interface CustomProfile {
  id: string;
  institution: string;
  /** The file's header row, normalized, as its signature. */
  signature: string;
  mapping: ColumnMapping;
}

function signatureOf(headers: readonly string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join("|");
}

export async function getCustomProfiles(store: Store): Promise<CustomProfile[]> {
  const meta = await store.getMeta(["customProfiles"]);
  try {
    return meta.customProfiles ? (JSON.parse(meta.customProfiles) as CustomProfile[]) : [];
  } catch {
    return [];
  }
}

/** Remembers a column mapping, so the next file with the same columns reads by itself. */
export async function saveCustomProfile(
  store: Store,
  input: { institution: string; headers: readonly string[]; mapping: ColumnMapping },
): Promise<CustomProfile> {
  const profiles = await getCustomProfiles(store);
  const signature = signatureOf(input.headers);
  const existing = profiles.find((p) => p.signature === signature);
  const profile: CustomProfile = {
    id: existing?.id ?? `custom-${uuidv7()}`,
    institution: input.institution,
    signature,
    mapping: input.mapping,
  };
  const next = [...profiles.filter((p) => p.signature !== signature), profile];
  await store.setMeta({ customProfiles: JSON.stringify(next) });
  return profile;
}

/** Reads a file with a saved mapping when its columns match one we set up before. */
export async function applyCustomProfile(
  store: Store,
  input: FileInput,
): Promise<ParsedStatement | null> {
  const { parsed } = input;
  if (parsed.profileId || parsed.rows.length > 0 || parsed.format === "ofx") return null;
  const profile = (await getCustomProfiles(store)).find(
    (p) => p.signature === signatureOf(parsed.headers),
  );
  if (!profile) return null;
  const read = readStatement(input.bytes, input.fileName, { mapping: profile.mapping });
  return { ...read, profileId: profile.id, institution: profile.institution };
}
