import type { SqlDriver } from "./driver.ts";

/**
 * The local database. Tables in the first group are shared through the household log (the
 * relay only ever sees them encrypted); the second group never leaves this Mac. Shared
 * columns are nullable because a remote change may carry only some fields.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    statements: [
      // Shared through the household log
      `CREATE TABLE members (
        id TEXT PRIMARY KEY,
        name TEXT,
        color TEXT,
        position INTEGER,
        deleted_at TEXT
      )`,
      `CREATE TABLE share_plans (
        id TEXT PRIMARY KEY,
        from_month TEXT,
        first_bp INTEGER,
        changed_by TEXT,
        note TEXT,
        created_at TEXT,
        deleted_at TEXT
      )`,
      `CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        icon TEXT,
        color TEXT,
        bubble TEXT,
        archived INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        deleted_at TEXT
      )`,
      `CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        institution TEXT,
        name TEXT,
        last4 TEXT,
        kind TEXT,
        default_share TEXT,
        profile_id TEXT,
        created_at TEXT,
        archived INTEGER DEFAULT 0,
        deleted_at TEXT
      )`,
      `CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        paid_by TEXT,
        date TEXT,
        month TEXT GENERATED ALWAYS AS (substr(date, 1, 7)) VIRTUAL,
        amount INTEGER,
        merchant TEXT,
        description TEXT,
        category_id TEXT,
        note TEXT,
        source TEXT,
        refund_of TEXT,
        added_at TEXT,
        added_by TEXT,
        edited_at TEXT,
        deleted_at TEXT
      )`,
      "CREATE INDEX transactions_month ON transactions(month)",
      `CREATE TABLE mine_totals (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        month TEXT,
        category_id TEXT,
        total INTEGER,
        count INTEGER
      )`,
      "CREATE INDEX mine_totals_month ON mine_totals(month)",
      `CREATE TABLE clean_slates (
        id TEXT PRIMARY KEY,
        from_member TEXT,
        to_member TEXT,
        amount INTEGER,
        date TEXT,
        applies_to TEXT,
        note TEXT,
        added_at TEXT,
        added_by TEXT,
        deleted_at TEXT
      )`,
      `CREATE TABLE household_rules (
        id TEXT PRIMARY KEY,
        match TEXT,
        pattern TEXT,
        category_id TEXT,
        share TEXT,
        created_at TEXT,
        created_by TEXT,
        deleted_at TEXT
      )`,

      // Only on this Mac
      `CREATE TABLE mine_transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        paid_by TEXT,
        date TEXT,
        month TEXT GENERATED ALWAYS AS (substr(date, 1, 7)) VIRTUAL,
        amount INTEGER,
        merchant TEXT,
        description TEXT,
        category_id TEXT,
        note TEXT,
        source TEXT,
        refund_of TEXT,
        added_at TEXT,
        added_by TEXT,
        edited_at TEXT,
        deleted_at TEXT
      )`,
      "CREATE INDEX mine_transactions_month ON mine_transactions(month)",
      `CREATE TABLE personal_rules (
        id TEXT PRIMARY KEY,
        match TEXT,
        pattern TEXT,
        category_id TEXT,
        share TEXT,
        created_at TEXT,
        created_by TEXT,
        deleted_at TEXT
      )`,
      `CREATE TABLE statement_files (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT,
        account_id TEXT,
        profile_id TEXT,
        format TEXT,
        first_date TEXT,
        last_date TEXT,
        brought_in_at TEXT NOT NULL,
        status TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        removed_at TEXT
      )`,
      "CREATE INDEX statement_files_sha ON statement_files(sha256)",
      `CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        file_id TEXT,
        account_id TEXT NOT NULL,
        row_index INTEGER,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT NOT NULL,
        merchant TEXT NOT NULL,
        bank_category TEXT,
        bank_id TEXT,
        kind TEXT NOT NULL,
        person TEXT,
        category_id TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'none',
        alternatives TEXT NOT NULL DEFAULT '[]',
        why TEXT,
        suggested_share TEXT,
        flags TEXT NOT NULL DEFAULT '{}',
        decision TEXT NOT NULL DEFAULT 'pending',
        note TEXT,
        refund_of TEXT,
        decided_at TEXT,
        added_at TEXT,
        added_tx_id TEXT
      )`,
      "CREATE INDEX drafts_file ON drafts(file_id)",
      "CREATE INDEX drafts_account_date ON drafts(account_id, date)",
      `CREATE TABLE embeddings (
        text_hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        vector TEXT NOT NULL
      )`,
      `CREATE TABLE field_clocks (
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field TEXT NOT NULL,
        hlc TEXT NOT NULL,
        PRIMARY KEY (entity, entity_id, field)
      )`,
      `CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        record TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE change_log (
        id TEXT PRIMARY KEY,
        hlc TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        fields TEXT NOT NULL,
        device_id TEXT NOT NULL,
        member_id TEXT,
        received_at TEXT NOT NULL
      )`,
      "CREATE INDEX change_log_entity ON change_log(entity, entity_id)",
      `CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
    ],
  },
];

export async function migrate(db: SqlDriver): Promise<number> {
  await db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)",
  );
  const rows = await db.all<{ version: number }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => Number(r.version)));
  let latest = rows.reduce((m, r) => Math.max(m, Number(r.version)), 0);
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        params: [migration.version, migration.name, new Date().toISOString()],
      },
    ]);
    latest = migration.version;
  }
  return latest;
}

/** The newest schema this build knows. An app that meets a newer one asks to update. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
