import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ChangeRecord,
  type Envelope,
  getAccounts,
  getCategories,
  getCleanSlates,
  getMembers,
  getRules,
  getSharePlans,
  keysFromPhrase,
  listTransactions,
  openRecord,
  RelayClient,
  Store,
  unwrapHouseholdKey,
  type WrappedKey,
} from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";

/**
 * `duet export`: everything in the household log, decrypted with a recovery phrase, as JSON,
 * CSV and a SQLite file in Duet's own format. Works on the relay's database or any backup of
 * it (on the Mac mini, or copied anywhere), or on the live relay over the tailnet.
 */

export interface LogSource {
  wrappedKey(keyId: string): Promise<WrappedKey | null>;
  envelopes(): AsyncIterable<Envelope[]>;
}

/** The relay's database file, or a nightly backup of it. Opened read-only. */
export function fileSource(path: string): LogSource {
  if (!existsSync(path)) throw new Error(`There's no relay database at ${path}.`);
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    async wrappedKey(keyId) {
      const row = db
        .prepare("SELECT key_id, nonce, ciphertext, household_id FROM keys WHERE key_id = ?")
        .get(keyId) as { key_id: string; nonce: string; ciphertext: string } | undefined;
      return row ? { keyId: row.key_id, nonce: row.nonce, ciphertext: row.ciphertext } : null;
    },
    async *envelopes() {
      let after = 0;
      for (;;) {
        const rows = db
          .prepare(
            "SELECT seq, id, stream, device_id, nonce, ciphertext FROM envelopes WHERE seq > ? ORDER BY seq LIMIT 1000",
          )
          .all(after) as Array<{
          seq: number;
          id: string;
          stream: string;
          device_id: string;
          nonce: string;
          ciphertext: string;
        }>;
        if (rows.length === 0) return;
        after = Number(rows[rows.length - 1]!.seq);
        yield rows.map((r) => ({
          seq: Number(r.seq),
          id: r.id,
          stream: r.stream,
          deviceId: r.device_id,
          nonce: r.nonce,
          ciphertext: r.ciphertext,
        }));
      }
    },
  };
}

/** The live relay. The phrase itself is the credential: the relay lets its holder read. */
export function relaySource(
  url: string,
  phrase: string,
  fetch?: (input: string, init?: RequestInit) => Promise<Response>,
): LogSource {
  const keys = keysFromPhrase(phrase);
  const client = new RelayClient(url, { keyAuth: { keyId: keys.keyId, proof: keys.proof }, fetch });
  return {
    async wrappedKey(keyId) {
      const { keys: all } = await client.keys();
      return all.find((k) => k.keyId === keyId) ?? null;
    },
    async *envelopes() {
      let after = 0;
      for (;;) {
        const page = await client.pull(after);
        if (page.envelopes.length === 0) return;
        after = page.envelopes[page.envelopes.length - 1]!.seq;
        yield page.envelopes;
        if (!page.more) return;
      }
    },
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

export interface ExportSummary {
  records: number;
  transactions: number;
  folder: string;
}

export async function exportHousehold(
  source: LogSource,
  phrase: string,
  options: { out: string; force?: boolean },
): Promise<ExportSummary> {
  const keys = keysFromPhrase(phrase);
  const wrapped = await source.wrappedKey(keys.keyId);
  if (!wrapped) throw new Error("That recovery phrase isn't known here.");
  const householdKey = unwrapHouseholdKey(wrapped, phrase);

  if (existsSync(options.out)) {
    if (!options.force)
      throw new Error(`${options.out} already exists. Choose another folder, or pass --force.`);
    rmSync(options.out, { recursive: true, force: true });
  }
  mkdirSync(options.out, { recursive: true });

  const store = await Store.open(new NodeSqliteDriver(join(options.out, "duet.db")), {
    deviceId: "d-export",
  });
  let count = 0;
  for await (const page of source.envelopes()) {
    const records: ChangeRecord[] = page.map((e) => openRecord(e, householdKey));
    count += await store.applyRemote(records);
  }

  const categories = await getCategories(store, true);
  const members = await getMembers(store);
  const names = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const accounts = await getAccounts(store, true);
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const transactions = await listTransactions(store, { share: "ours" }, categories);
  const mineTotals = await store.db.all<{
    member_id: string;
    month: string;
    category_id: string;
    total: number;
    count: number;
  }>(
    "SELECT member_id, month, category_id, total, count FROM mine_totals ORDER BY month, member_id",
  );

  writeFileSync(
    join(options.out, "household.json"),
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        members,
        sharePlans: await getSharePlans(store),
        accounts,
        categories,
        rules: await getRules(store),
        cleanSlates: await getCleanSlates(store),
        transactions,
        mineTotals: mineTotals.map((m) => ({
          memberId: m.member_id,
          month: m.month,
          categoryId: m.category_id,
          total: Number(m.total),
          count: Number(m.count),
        })),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(options.out, "transactions.csv"),
    toCsv([
      ["Date", "Merchant", "Amount", "Category", "Paid by", "Account", "Note", "Added"],
      ...transactions
        .slice()
        .reverse()
        .map((t) => [
          t.date,
          t.merchant,
          (t.amount / 100).toFixed(2),
          t.categoryId ? (categoryNames[t.categoryId] ?? t.categoryId) : "",
          names[t.paidBy] ?? t.paidBy,
          t.accountId ? (accountNames[t.accountId] ?? "") : "",
          t.note ?? "",
          t.addedAt.slice(0, 10),
        ]),
    ]),
  );
  writeFileSync(
    join(options.out, "mine-totals.csv"),
    toCsv([
      ["Month", "Whose", "Category", "Total", "Count"],
      ...mineTotals.map((m) => [
        m.month,
        names[m.member_id] ?? m.member_id,
        categoryNames[m.category_id] ?? m.category_id,
        (Number(m.total) / 100).toFixed(2),
        Number(m.count),
      ]),
    ]),
  );
  return { records: count, transactions: transactions.length, folder: options.out };
}

export interface RelaySummary {
  households: number;
  devices: Array<{ name: string; lastSeenAt: string | null; removed: boolean }>;
  changes: number;
  latest: number;
  firstAt: string | null;
  lastAt: string | null;
}

/** `duet inspect`: what's in a relay database, without opening anything encrypted. */
export function inspectRelay(path: string): RelaySummary {
  if (!existsSync(path)) throw new Error(`There's no relay database at ${path}.`);
  const db = new DatabaseSync(path, { readOnly: true });
  const one = <T>(sql: string) => db.prepare(sql).get() as T;
  const devices = db
    .prepare("SELECT name, last_seen_at, revoked_at FROM devices ORDER BY created_at")
    .all() as Array<{ name: string; last_seen_at: string | null; revoked_at: string | null }>;
  const stats = one<{
    n: number;
    latest: number | null;
    first: string | null;
    last: string | null;
  }>(
    "SELECT COUNT(*) AS n, MAX(seq) AS latest, MIN(received_at) AS first, MAX(received_at) AS last FROM envelopes",
  );
  return {
    households: Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM households").n),
    devices: devices.map((d) => ({
      name: d.name,
      lastSeenAt: d.last_seen_at,
      removed: !!d.revoked_at,
    })),
    changes: Number(stats.n),
    latest: Number(stats.latest ?? 0),
    firstAt: stats.first,
    lastAt: stats.last,
  };
}
