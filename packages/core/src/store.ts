import { chunk, placeholders, type SqlDriver, type SqlValue, type Statement } from "./db/driver.ts";
import { migrate, SCHEMA_VERSION } from "./db/schema.ts";
import { type Hlc, HybridClock } from "./hlc.ts";
import { randomToken, uuidv7 } from "./ids.ts";

/**
 * The local store. Every change to a shared entity is a small record stamped with a hybrid
 * logical clock; the store applies it, remembers the clock per field, keeps it in the local
 * history, and (for shared entities) queues it in the outbox for the relay. Remote records
 * merge per field: the newest clock wins and the device id breaks ties.
 */

export type FieldValue = string | number | boolean | null;

type Kind = "text" | "int" | "bool";

interface FieldDef {
  column: string;
  kind: Kind;
}

interface EntityDef {
  table: string;
  /** Shared entities go to the household log; the rest stay on this Mac. */
  shared: boolean;
  fields: Record<string, FieldDef>;
}

const f = (column: string, kind: Kind = "text"): FieldDef => ({ column, kind });

const TRANSACTION_FIELDS = {
  accountId: f("account_id"),
  paidBy: f("paid_by"),
  date: f("date"),
  amount: f("amount", "int"),
  merchant: f("merchant"),
  description: f("description"),
  categoryId: f("category_id"),
  note: f("note"),
  source: f("source"),
  refundOf: f("refund_of"),
  addedAt: f("added_at"),
  addedBy: f("added_by"),
  editedAt: f("edited_at"),
  deletedAt: f("deleted_at"),
};

const RULE_FIELDS = {
  match: f("match"),
  pattern: f("pattern"),
  categoryId: f("category_id"),
  share: f("share"),
  createdAt: f("created_at"),
  createdBy: f("created_by"),
  deletedAt: f("deleted_at"),
};

export const ENTITIES = {
  member: {
    table: "members",
    shared: true,
    fields: {
      name: f("name"),
      color: f("color"),
      position: f("position", "int"),
      deletedAt: f("deleted_at"),
    },
  },
  sharePlan: {
    table: "share_plans",
    shared: true,
    fields: {
      fromMonth: f("from_month"),
      firstBp: f("first_bp", "int"),
      changedBy: f("changed_by"),
      note: f("note"),
      createdAt: f("created_at"),
      deletedAt: f("deleted_at"),
    },
  },
  category: {
    table: "categories",
    shared: true,
    fields: {
      name: f("name"),
      parentId: f("parent_id"),
      icon: f("icon"),
      color: f("color"),
      bubble: f("bubble"),
      archived: f("archived", "bool"),
      order: f("sort_order", "int"),
      deletedAt: f("deleted_at"),
    },
  },
  account: {
    table: "accounts",
    shared: true,
    fields: {
      ownerId: f("owner_id"),
      institution: f("institution"),
      name: f("name"),
      last4: f("last4"),
      kind: f("kind"),
      defaultShare: f("default_share"),
      profileId: f("profile_id"),
      createdAt: f("created_at"),
      archived: f("archived", "bool"),
      deletedAt: f("deleted_at"),
    },
  },
  transaction: { table: "transactions", shared: true, fields: TRANSACTION_FIELDS },
  mineTotal: {
    table: "mine_totals",
    shared: true,
    fields: {
      memberId: f("member_id"),
      month: f("month"),
      categoryId: f("category_id"),
      total: f("total", "int"),
      count: f("count", "int"),
    },
  },
  cleanSlate: {
    table: "clean_slates",
    shared: true,
    fields: {
      fromMember: f("from_member"),
      toMember: f("to_member"),
      amount: f("amount", "int"),
      date: f("date"),
      appliesTo: f("applies_to"),
      note: f("note"),
      addedAt: f("added_at"),
      addedBy: f("added_by"),
      deletedAt: f("deleted_at"),
    },
  },
  householdRule: { table: "household_rules", shared: true, fields: RULE_FIELDS },
  mineTransaction: { table: "mine_transactions", shared: false, fields: TRANSACTION_FIELDS },
  personalRule: { table: "personal_rules", shared: false, fields: RULE_FIELDS },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof ENTITIES;

/** One change, before it has a clock. */
export interface Change {
  entity: EntityName;
  id: string;
  fields: Record<string, FieldValue>;
}

/** The record that goes into the household log (encrypted before it leaves this Mac). */
export interface ChangeRecord {
  id: string;
  hlc: Hlc;
  entity: EntityName;
  entityId: string;
  fields: Record<string, FieldValue>;
  schema: number;
  memberId: string | null;
}

/** Thrown when a record comes from a newer Duet: the app should update rather than guess. */
export class NewerDataError extends Error {
  readonly schema: number;
  constructor(schema: number) {
    super(`Data from a newer version of Duet (schema ${schema}). Please update.`);
    this.schema = schema;
  }
}

function encode(def: FieldDef, value: FieldValue): SqlValue {
  if (value === null || value === undefined) return null;
  if (def.kind === "bool") return value ? 1 : 0;
  if (def.kind === "int") return typeof value === "number" ? Math.trunc(value) : Number(value);
  return String(value);
}

function upsert(def: EntityDef, id: string, fields: Record<string, FieldValue>): Statement {
  const entries = Object.entries(fields).filter(([name]) => def.fields[name]);
  if (entries.length === 0) {
    return { sql: `INSERT OR IGNORE INTO ${def.table} (id) VALUES (?)`, params: [id] };
  }
  const columns = entries.map(([name]) => def.fields[name]!.column);
  const values = entries.map(([name, value]) => encode(def.fields[name]!, value));
  const updates = columns.map((c) => `${c} = excluded.${c}`).join(", ");
  return {
    sql: `INSERT INTO ${def.table} (id, ${columns.join(", ")}) VALUES (?, ${placeholders(columns.length)}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    params: [id, ...values],
  };
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export type ChangeListener = (entities: ReadonlySet<string>) => void;

export class Store {
  readonly db: SqlDriver;
  readonly deviceId: string;
  memberId: string | null;
  readonly clock: HybridClock;
  private readonly listeners = new Set<ChangeListener>();
  private readonly mutex = new Mutex();

  // Plain fields rather than parameter properties, so Node can run core as TypeScript.
  private constructor(db: SqlDriver, deviceId: string, memberId: string | null, now: () => number) {
    this.db = db;
    this.deviceId = deviceId;
    this.memberId = memberId;
    this.clock = new HybridClock(deviceId, now);
  }

  /** Opens the database: runs migrations and restores this Mac's device id and clock. */
  static async open(
    db: SqlDriver,
    options: { now?: () => number; deviceId?: string } = {},
  ): Promise<Store> {
    await migrate(db);
    const meta = await readMeta(db, ["deviceId", "memberId", "clock"]);
    let deviceId = meta.deviceId;
    if (!deviceId) {
      deviceId = options.deviceId ?? `d-${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`;
      await writeMeta(db, { deviceId });
    }
    const store = new Store(db, deviceId, meta.memberId ?? null, options.now ?? (() => Date.now()));
    if (meta.clock) store.clock.receive(meta.clock);
    return store;
  }

  /** Runs a read-then-write flow without another flow slipping in between. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.lock(fn);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(entities: Iterable<string>): void {
    const set = new Set(entities);
    for (const l of this.listeners) l(set);
  }

  /** Statements and records for local changes, so callers can batch them with their own. */
  prepare(changes: readonly Change[]): { statements: Statement[]; records: ChangeRecord[] } {
    const statements: Statement[] = [];
    const records: ChangeRecord[] = [];
    const now = new Date().toISOString();
    for (const change of changes) {
      const def: EntityDef = ENTITIES[change.entity];
      const fields = Object.fromEntries(
        Object.entries(change.fields).filter(
          ([name, value]) => def.fields[name] && value !== undefined,
        ),
      );
      const hlc = this.clock.tick();
      const record: ChangeRecord = {
        id: uuidv7(),
        hlc,
        entity: change.entity,
        entityId: change.id,
        fields,
        schema: SCHEMA_VERSION,
        memberId: this.memberId,
      };
      records.push(record);
      statements.push(upsert(def, change.id, fields));
      for (const name of Object.keys(fields)) {
        statements.push({
          sql: "INSERT OR REPLACE INTO field_clocks (entity, entity_id, field, hlc) VALUES (?, ?, ?, ?)",
          params: [change.entity, change.id, name, hlc],
        });
      }
      statements.push(logStatement(record, this.deviceId, now));
      if (def.shared) {
        statements.push({
          sql: "INSERT INTO outbox (id, record, created_at) VALUES (?, ?, ?)",
          params: [record.id, JSON.stringify(record), now],
        });
      }
    }
    if (records.length > 0) {
      statements.push(metaStatement("clock", records[records.length - 1]!.hlc));
    }
    return { statements, records };
  }

  /** Applies local changes (and any extra statements) in one transaction. */
  async write(
    changes: readonly Change[],
    extra: readonly Statement[] = [],
  ): Promise<ChangeRecord[]> {
    const { statements, records } = this.prepare(changes);
    await this.db.batch([...statements, ...extra]);
    this.notify(changes.map((c) => c.entity));
    return records;
  }

  /**
   * Merges records from the other Mac. Records already seen are skipped, so pulling twice is
   * harmless. Returns how many were new.
   */
  applyRemote(records: readonly ChangeRecord[]): Promise<number> {
    return this.exclusive(async () => {
      for (const r of records) {
        if (r.schema > SCHEMA_VERSION || !(r.entity in ENTITIES))
          throw new NewerDataError(r.schema);
      }
      const known = new Set<string>();
      for (const ids of chunk(
        records.map((r) => r.id),
        400,
      )) {
        const rows = await this.db.all<{ id: string }>(
          `SELECT id FROM change_log WHERE id IN (${placeholders(ids.length)})`,
          ids,
        );
        for (const row of rows) known.add(row.id);
      }
      const fresh = records
        .filter((r) => !known.has(r.id))
        .sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
      if (fresh.length === 0) return 0;

      const clocks = new Map<string, string>();
      const byEntity = new Map<string, Set<string>>();
      for (const r of fresh) {
        const set = byEntity.get(r.entity) ?? new Set<string>();
        set.add(r.entityId);
        byEntity.set(r.entity, set);
      }
      for (const [entity, idSet] of byEntity) {
        for (const ids of chunk([...idSet], 400)) {
          const rows = await this.db.all<{ entity_id: string; field: string; hlc: string }>(
            `SELECT entity_id, field, hlc FROM field_clocks WHERE entity = ? AND entity_id IN (${placeholders(ids.length)})`,
            [entity, ...ids],
          );
          for (const row of rows) clocks.set(`${entity}|${row.entity_id}|${row.field}`, row.hlc);
        }
      }

      const statements: Statement[] = [];
      const now = new Date().toISOString();
      const touched = new Set<string>();
      for (const r of fresh) {
        const def: EntityDef = ENTITIES[r.entity];
        const winning: Record<string, FieldValue> = {};
        for (const [name, value] of Object.entries(r.fields)) {
          if (!def.fields[name]) continue;
          const key = `${r.entity}|${r.entityId}|${name}`;
          const current = clocks.get(key);
          if (!current || r.hlc > current) {
            winning[name] = value;
            clocks.set(key, r.hlc);
            statements.push({
              sql: "INSERT OR REPLACE INTO field_clocks (entity, entity_id, field, hlc) VALUES (?, ?, ?, ?)",
              params: [r.entity, r.entityId, name, r.hlc],
            });
          }
        }
        if (Object.keys(winning).length > 0) {
          statements.push(upsert(def, r.entityId, winning));
          touched.add(r.entity);
        }
        const deviceId = r.hlc.slice(30);
        statements.push(logStatement(r, deviceId, now));
        if (r.entity === "transaction" && typeof winning.deletedAt === "string") {
          // A transaction the other person removed or made Mine: keep no details here.
          statements.push({
            sql: "UPDATE transactions SET merchant = '', description = NULL, note = NULL WHERE id = ?",
            params: [r.entityId],
          });
          statements.push({
            sql: "DELETE FROM change_log WHERE entity = 'transaction' AND entity_id = ? AND id <> ?",
            params: [r.entityId, r.id],
          });
        }
        this.clock.receive(r.hlc);
      }
      statements.push(metaStatement("clock", this.clock.tick()));
      await this.db.batch(statements);
      this.notify(touched);
      return fresh.length;
    });
  }

  /** Every change to one entity, oldest first, for the Transactions history. */
  async history(
    entity: EntityName,
    id: string,
  ): Promise<Array<ChangeRecord & { deviceId: string }>> {
    const rows = await this.db.all<{
      id: string;
      hlc: string;
      entity: string;
      entity_id: string;
      fields: string;
      device_id: string;
      member_id: string | null;
    }>("SELECT * FROM change_log WHERE entity = ? AND entity_id = ? ORDER BY hlc", [entity, id]);
    return rows.map((r) => ({
      id: r.id,
      hlc: r.hlc,
      entity: r.entity as EntityName,
      entityId: r.entity_id,
      fields: JSON.parse(r.fields) as Record<string, FieldValue>,
      schema: SCHEMA_VERSION,
      memberId: r.member_id,
      deviceId: r.device_id,
    }));
  }

  async outbox(limit = 500): Promise<ChangeRecord[]> {
    const rows = await this.db.all<{ record: string }>(
      "SELECT record FROM outbox ORDER BY id LIMIT ?",
      [limit],
    );
    return rows.map((r) => JSON.parse(r.record) as ChangeRecord);
  }

  async clearOutbox(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.batch(
      chunk(ids, 400).map((part) => ({
        sql: `DELETE FROM outbox WHERE id IN (${placeholders(part.length)})`,
        params: [...part],
      })),
    );
  }

  getMeta(keys: string[]): Promise<Record<string, string | undefined>> {
    return readMeta(this.db, keys);
  }

  async setMeta(values: Record<string, string | null>): Promise<void> {
    await writeMeta(this.db, values);
  }
}

function logStatement(record: ChangeRecord, deviceId: string, receivedAt: string): Statement {
  return {
    sql: "INSERT OR IGNORE INTO change_log (id, hlc, entity, entity_id, fields, device_id, member_id, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    params: [
      record.id,
      record.hlc,
      record.entity,
      record.entityId,
      JSON.stringify(record.fields),
      deviceId,
      record.memberId,
      receivedAt,
    ],
  };
}

function metaStatement(key: string, value: string | null): Statement {
  return {
    sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [key, value],
  };
}

async function readMeta(
  db: SqlDriver,
  keys: string[],
): Promise<Record<string, string | undefined>> {
  if (keys.length === 0) return {};
  const rows = await db.all<{ key: string; value: string | null }>(
    `SELECT key, value FROM meta WHERE key IN (${placeholders(keys.length)})`,
    keys,
  );
  const out: Record<string, string | undefined> = {};
  for (const row of rows) if (row.value !== null) out[row.key] = row.value;
  return out;
}

async function writeMeta(db: SqlDriver, values: Record<string, string | null>): Promise<void> {
  await db.batch(Object.entries(values).map(([key, value]) => metaStatement(key, value)));
}
