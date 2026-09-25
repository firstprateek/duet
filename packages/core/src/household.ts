import { type Category, STARTER_CATEGORIES } from "./categories.ts";
import type { MonthKey } from "./dates.ts";
import type { Pair } from "./ebbflow.ts";
import { uuidv7 } from "./ids.ts";
import type { Account, AccountKind, LocalSettings, Member, SharePlan } from "./model.ts";
import type { Change, Store } from "./store.ts";
import type { Share } from "./words.ts";

/** Setting up the two of us, and everything the household shares: accounts, categories, Our rhythm. */

export const PARTNER_COLORS = ["#2F6FB0", "#F5C451"] as const;

export interface SetupInput {
  names: [string, string];
  /** Which of the two is using this Mac. */
  me: 0 | 1;
  /** The first partner's share, in basis points (5800 = 58 / 42). */
  firstBp: number;
  /** The month Our rhythm starts from. */
  fromMonth: MonthKey;
}

export async function setupHousehold(
  store: Store,
  input: SetupInput,
): Promise<{ members: Member[] }> {
  const now = new Date().toISOString();
  const members: Member[] = input.names.map((name, position) => ({
    id: uuidv7(),
    name: name.trim(),
    color: PARTNER_COLORS[position]!,
    position,
  }));
  const me = members[input.me]!;
  store.memberId = me.id;
  const changes: Change[] = [
    ...members.map((m) => ({
      entity: "member" as const,
      id: m.id,
      fields: { name: m.name, color: m.color, position: m.position },
    })),
    {
      entity: "sharePlan",
      id: uuidv7(),
      fields: {
        fromMonth: input.fromMonth,
        firstBp: input.firstBp,
        changedBy: me.id,
        createdAt: now,
      },
    },
    ...STARTER_CATEGORIES.map((c) => ({
      entity: "category" as const,
      id: c.id,
      fields: {
        name: c.name,
        parentId: c.parentId,
        icon: c.icon,
        color: c.color,
        bubble: c.bubble,
        archived: false,
        order: c.order,
      },
    })),
    ...members.map((m) => ({
      entity: "account" as const,
      id: uuidv7(),
      fields: {
        ownerId: m.id,
        institution: "Cash",
        name: "Cash",
        kind: "cash",
        defaultShare: "ours",
        createdAt: now,
        archived: false,
      },
    })),
  ];
  await store.write(changes, []);
  await store.setMeta({ memberId: me.id, householdId: uuidv7(), setupAt: now });
  return { members };
}

export async function isSetUp(store: Store): Promise<boolean> {
  const meta = await store.getMeta(["memberId"]);
  if (!meta.memberId) return false;
  const rows = await store.db.all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL",
  );
  return Number(rows[0]?.n ?? 0) >= 2;
}

export async function getMembers(store: Store): Promise<Member[]> {
  const rows = await store.db.all<{ id: string; name: string; color: string; position: number }>(
    "SELECT id, name, color, position FROM members WHERE deleted_at IS NULL ORDER BY position",
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    color: r.color ?? PARTNER_COLORS[0],
    position: Number(r.position),
  }));
}

export async function getPair(store: Store): Promise<Pair & { members: Member[] }> {
  const members = await getMembers(store);
  const first = members.find((m) => m.position === 0);
  const second = members.find((m) => m.position === 1);
  if (!first || !second) throw new Error("The household isn't set up yet.");
  return { first: first.id, second: second.id, members };
}

export async function renameMember(store: Store, id: string, name: string): Promise<void> {
  await store.write([{ entity: "member", id, fields: { name: name.trim() } }]);
}

export async function getCategories(store: Store, includeArchived = false): Promise<Category[]> {
  const rows = await store.db.all<{
    id: string;
    name: string;
    parent_id: string | null;
    icon: string;
    color: string;
    bubble: string;
    archived: number;
    sort_order: number;
  }>(
    `SELECT id, name, parent_id, icon, color, bubble, archived, sort_order FROM categories
     WHERE deleted_at IS NULL ${includeArchived ? "" : "AND COALESCE(archived, 0) = 0"}
     ORDER BY sort_order, name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    parentId: r.parent_id,
    icon: r.icon ?? "dots",
    color: r.color ?? "#C9C0D3",
    bubble: r.bubble ?? "#F0ECE6",
    order: Number(r.sort_order ?? 0),
    archived: Number(r.archived ?? 0) === 1,
  }));
}

export async function addCategory(
  store: Store,
  input: { name: string; parentId: string | null; icon?: string },
  categories: readonly Category[],
): Promise<string> {
  const parent = input.parentId ? categories.find((c) => c.id === input.parentId) : undefined;
  const siblings = categories.filter((c) => c.parentId === input.parentId);
  const order = Math.max(parent?.order ?? 0, ...siblings.map((c) => c.order)) + 1;
  const id = uuidv7();
  await store.write([
    {
      entity: "category",
      id,
      fields: {
        name: input.name.trim(),
        parentId: input.parentId,
        icon: input.icon ?? parent?.icon ?? "dots",
        color: parent?.color ?? "#C9C0D3",
        bubble: parent?.bubble ?? "#F0ECE6",
        archived: false,
        order,
      },
    },
  ]);
  return id;
}

export async function updateCategory(
  store: Store,
  id: string,
  fields: Partial<{ name: string; archived: boolean; icon: string }>,
): Promise<void> {
  await store.write([{ entity: "category", id, fields }]);
}

export async function getAccounts(store: Store, includeArchived = false): Promise<Account[]> {
  const rows = await store.db.all<{
    id: string;
    owner_id: string;
    institution: string;
    name: string;
    last4: string | null;
    kind: string;
    default_share: string;
    profile_id: string | null;
    archived: number;
  }>(
    `SELECT id, owner_id, institution, name, last4, kind, default_share, profile_id, archived FROM accounts
     WHERE deleted_at IS NULL ${includeArchived ? "" : "AND COALESCE(archived, 0) = 0"}
     ORDER BY institution, name`,
  );
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    institution: r.institution ?? "",
    name: r.name ?? "",
    last4: r.last4,
    kind: (r.kind ?? "credit") as AccountKind,
    defaultShare: (r.default_share === "mine" ? "mine" : "ours") as Share,
    profileId: r.profile_id,
    archived: Number(r.archived ?? 0) === 1,
  }));
}

export async function addAccount(
  store: Store,
  input: {
    ownerId: string;
    institution: string;
    name: string;
    last4?: string | null;
    kind: AccountKind;
    defaultShare: Share;
    profileId?: string | null;
  },
): Promise<string> {
  const id = uuidv7();
  await store.write([
    {
      entity: "account",
      id,
      fields: {
        ownerId: input.ownerId,
        institution: input.institution,
        name: input.name.trim(),
        last4: input.last4 ?? null,
        kind: input.kind,
        defaultShare: input.defaultShare,
        profileId: input.profileId ?? null,
        createdAt: new Date().toISOString(),
        archived: false,
      },
    },
  ]);
  return id;
}

export async function updateAccount(
  store: Store,
  id: string,
  fields: Partial<{
    name: string;
    defaultShare: Share;
    archived: boolean;
    ownerId: string;
    kind: AccountKind;
  }>,
): Promise<void> {
  await store.write([{ entity: "account", id, fields }]);
}

export async function getSharePlans(store: Store): Promise<SharePlan[]> {
  const rows = await store.db.all<{
    id: string;
    from_month: string;
    first_bp: number;
    changed_by: string | null;
    note: string | null;
    created_at: string;
  }>(
    "SELECT id, from_month, first_bp, changed_by, note, created_at FROM share_plans WHERE deleted_at IS NULL ORDER BY from_month, created_at",
  );
  return rows.map((r) => ({
    id: r.id,
    fromMonth: r.from_month,
    firstBp: Number(r.first_bp),
    changedBy: r.changed_by,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/**
 * Sets Our rhythm from a month onward. A plan for the same month is replaced; either of us
 * can change it, and the other sees a gentle note in Settings.
 */
export async function setRhythm(
  store: Store,
  input: { fromMonth: MonthKey; firstBp: number; note?: string | null },
): Promise<void> {
  if (!Number.isInteger(input.firstBp) || input.firstBp < 100 || input.firstBp > 9900) {
    throw new Error("Our rhythm is between 1 / 99 and 99 / 1.");
  }
  const plans = await getSharePlans(store);
  const sameMonth = plans.filter((p) => p.fromMonth === input.fromMonth);
  const now = new Date().toISOString();
  await store.write([
    ...sameMonth.map((p) => ({
      entity: "sharePlan" as const,
      id: p.id,
      fields: { deletedAt: now },
    })),
    {
      entity: "sharePlan",
      id: uuidv7(),
      fields: {
        fromMonth: input.fromMonth,
        firstBp: input.firstBp,
        changedBy: store.memberId,
        note: input.note ?? null,
        createdAt: now,
      },
    },
  ]);
}

const SETTING_KEYS = [
  "appearance",
  "alwaysShowEbbFlow",
  "cleanSlateDefault",
  "relayUrl",
  "sorterUrl",
  "lastPaidWith",
] as const;

/** Settings that belong to this Mac only (appearance, Always show Ebb & flow, ...). */
export async function getLocalSettings(store: Store): Promise<LocalSettings> {
  const meta = await store.getMeta([...SETTING_KEYS]);
  return {
    appearance:
      meta.appearance === "light" || meta.appearance === "dark" ? meta.appearance : "auto",
    alwaysShowEbbFlow: meta.alwaysShowEbbFlow === "true",
    cleanSlateDefault: meta.cleanSlateDefault === "overall" ? "overall" : "month",
    relayUrl: meta.relayUrl ?? null,
    sorterUrl: meta.sorterUrl ?? null,
    lastPaidWith: meta.lastPaidWith ?? null,
  };
}

export async function setLocalSettings(
  store: Store,
  values: Partial<LocalSettings>,
): Promise<void> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    out[key] = value === null ? null : String(value);
  }
  await store.setMeta(out);
  store.notify(["settings"]);
}
