import {
  type CreateHouseholdRequest,
  type DeviceGrant,
  type DeviceInfo,
  type Health,
  INVITE_MINUTES,
  type InviteRequest,
  type InviteResponse,
  type JoinRequest,
  KEY_ID_HEADER,
  KEY_PROOF_HEADER,
  MAX_CIPHERTEXT,
  MAX_PUSH,
  MIN_PROTOCOL,
  type NewWrappedKey,
  PROTOCOL,
  PROTOCOL_HEADER,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RestoreRequest,
  type RestoreResponse,
} from "@duet/core/protocol";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * The relay on the Mac mini. It numbers encrypted change records and hands them out; it can
 * never read them. It also pairs devices (one-time invites), keeps each person's wrapped copy
 * of the household key, and lets a recovery phrase restore a wiped Mac.
 *
 * Written against the standard Request and Response, so the same code runs under Bun on the
 * Mac mini and under Node in the tests.
 */

export type SqlParam = string | number | null;

/** The little the relay needs from SQLite: bun:sqlite on the Mac mini, node:sqlite in tests. */
export interface RelayDb {
  all<T>(sql: string, ...params: SqlParam[]): T[];
  get<T>(sql: string, ...params: SqlParam[]): T | undefined;
  run(sql: string, ...params: SqlParam[]): { changes: number };
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

export const RELAY_SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS keys (
  key_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT,
  proof_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS envelopes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL,
  id TEXT NOT NULL,
  stream TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (household_id, id)
);
CREATE INDEX IF NOT EXISTS envelopes_household_seq ON envelopes (household_id, seq);
`;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": `Authorization, Content-Type, ${PROTOCOL_HEADER}, ${KEY_ID_HEADER}, ${KEY_PROOF_HEADER}`,
  "access-control-max-age": "600",
};

const MAX_BODY = 8 * 1024 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

const encoder = new TextEncoder();

export function hashHex(value: string): string {
  return Array.from(sha256(encoder.encode(value)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new HttpError(400, `The ${name} is missing or too long.`);
  }
  return value.trim();
}

function token(value: unknown, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    !BASE64URL.test(value)
  ) {
    throw new HttpError(400, `The ${name} doesn't look right.`);
  }
  return value;
}

function wrappedKey(value: unknown): NewWrappedKey {
  const key = (value ?? {}) as Partial<NewWrappedKey>;
  return {
    keyId: text(key.keyId, "key id", 64),
    proof: token(key.proof, "key proof", 128),
    nonce: token(key.nonce, "key nonce", 64),
    ciphertext: token(key.ciphertext, "wrapped key", 256),
  };
}

type Caller =
  | { kind: "device"; deviceId: string; householdId: string; memberId: string | null }
  | { kind: "phrase"; householdId: string; memberId: string | null };

type DeviceCaller = Extract<Caller, { kind: "device" }>;

export interface RelayOptions {
  db: RelayDb;
  /** The relay's own version, for the settings screen. */
  version?: string;
  now?: () => Date;
  /** How often an open event stream says it's still there. */
  keepAliveMs?: number;
}

export class Relay {
  private readonly db: RelayDb;
  private readonly version: string;
  private readonly now: () => Date;
  private readonly keepAliveMs: number;
  private readonly listeners = new Map<string, Set<(latest: number) => void>>();
  private readonly failedRestores: number[] = [];

  constructor(options: RelayOptions) {
    this.db = options.db;
    this.version = options.version ?? "0.1.0";
    this.now = options.now ?? (() => new Date());
    this.keepAliveMs = options.keepAliveMs ?? 25_000;
    this.db.exec(RELAY_SCHEMA);
  }

  async handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;
    try {
      if (method === "GET" && path === "/v1/health") return json(this.health());
      this.checkProtocol(request);
      if (method === "POST" && path === "/v1/households") {
        return json(this.createHousehold(await readJson<CreateHouseholdRequest>(request)), 201);
      }
      if (method === "POST" && path === "/v1/devices") {
        return json(this.join(await readJson<JoinRequest>(request)), 201);
      }
      if (method === "POST" && path === "/v1/restore") {
        return json(this.restore(await readJson<RestoreRequest>(request)), 201);
      }
      if (method === "GET" && path === "/v1/changes")
        return json(this.pull(this.caller(request), url));
      if (method === "POST" && path === "/v1/changes") {
        return json(this.push(this.device(request), await readJson<PushRequest>(request)));
      }
      if (method === "GET" && path === "/v1/events")
        return this.events(this.device(request), request.signal);
      if (method === "GET" && path === "/v1/keys") return json(this.keys(this.caller(request)));
      if (method === "PUT" && path === "/v1/keys") {
        return json(
          this.replaceKey(this.device(request), await readJson<{ key: NewWrappedKey }>(request)),
        );
      }
      if (method === "POST" && path === "/v1/invites") {
        return json(this.invite(this.device(request), await readJson<InviteRequest>(request)), 201);
      }
      if (method === "GET" && path === "/v1/devices")
        return json(this.devices(this.device(request)));
      const removal = path.match(/^\/v1\/devices\/([^/]+)$/);
      if (method === "DELETE" && removal) {
        return json(this.revoke(this.device(request), decodeURIComponent(removal[1]!)));
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Something went wrong on the Mac mini." }, 500);
    }
  }

  private checkProtocol(request: Request): void {
    const header = request.headers.get(PROTOCOL_HEADER);
    const version = header === null ? PROTOCOL : Number(header);
    if (!Number.isInteger(version))
      throw new HttpError(400, "The protocol version doesn't look right.");
    if (version > PROTOCOL) {
      throw new HttpError(
        426,
        "The Mac mini has an older Duet relay. Update it with duet-server update.",
      );
    }
    if (version < MIN_PROTOCOL) {
      throw new HttpError(
        426,
        "This Duet is older than the relay on the Mac mini. Update the app.",
      );
    }
  }

  private iso(offsetMs = 0): string {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }

  private health(): Health {
    const ready = !!this.db.get<{ id: string }>("SELECT id FROM households LIMIT 1");
    return {
      ok: true,
      protocol: PROTOCOL,
      minProtocol: MIN_PROTOCOL,
      version: this.version,
      ready,
    };
  }

  /** A device, from its token. */
  private device(request: Request): DeviceCaller {
    const header = request.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!bearer) throw new HttpError(401, "This Mac isn't paired with the Mac mini yet.");
    const row = this.db.get<{
      id: string;
      household_id: string;
      member_id: string | null;
      revoked_at: string | null;
      last_seen_at: string | null;
    }>(
      "SELECT id, household_id, member_id, revoked_at, last_seen_at FROM devices WHERE token_hash = ?",
      hashHex(bearer),
    );
    if (!row) throw new HttpError(401, "The Mac mini doesn't know this Mac. Pair it again.");
    if (row.revoked_at) throw new HttpError(401, "This Mac was removed from the household.");
    const now = this.iso();
    if (!row.last_seen_at || now.slice(0, 16) !== row.last_seen_at.slice(0, 16)) {
      this.db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", now, row.id);
    }
    return {
      kind: "device",
      deviceId: row.id,
      householdId: row.household_id,
      memberId: row.member_id,
    };
  }

  /** A device, or someone holding a recovery phrase (read-only, for duet export). */
  private caller(request: Request): Caller {
    const keyId = request.headers.get(KEY_ID_HEADER);
    const proof = request.headers.get(KEY_PROOF_HEADER);
    if (!keyId || !proof) return this.device(request);
    const key = this.db.get<{ household_id: string; member_id: string | null; proof_hash: string }>(
      "SELECT household_id, member_id, proof_hash FROM keys WHERE key_id = ?",
      keyId,
    );
    if (!key || !sameHash(key.proof_hash, hashHex(proof))) {
      throw new HttpError(401, "That recovery phrase isn't known on this Mac mini.");
    }
    return { kind: "phrase", householdId: key.household_id, memberId: key.member_id };
  }

  private newDevice(householdId: string, memberId: string | null, name: string): DeviceGrant {
    const deviceId = crypto.randomUUID();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const deviceToken = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    this.db.run(
      "INSERT INTO devices (id, household_id, member_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      deviceId,
      householdId,
      memberId,
      name,
      hashHex(deviceToken),
      this.iso(),
    );
    return { householdId, deviceId, deviceToken, memberId };
  }

  /** One wrapped key per person: a new phrase replaces the old one. */
  private saveKey(householdId: string, memberId: string | null, key: NewWrappedKey): void {
    if (memberId)
      this.db.run(
        "DELETE FROM keys WHERE household_id = ? AND member_id = ?",
        householdId,
        memberId,
      );
    this.db.run(
      `INSERT INTO keys (key_id, household_id, member_id, proof_hash, nonce, ciphertext, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key_id) DO UPDATE SET household_id = excluded.household_id, member_id = excluded.member_id,
         proof_hash = excluded.proof_hash, nonce = excluded.nonce, ciphertext = excluded.ciphertext`,
      key.keyId,
      householdId,
      memberId,
      hashHex(key.proof),
      key.nonce,
      key.ciphertext,
      this.iso(),
    );
  }

  private createHousehold(body: CreateHouseholdRequest): DeviceGrant {
    const deviceName = text(body.deviceName, "device name", 80);
    const memberId = text(body.memberId, "member", 64);
    const key = wrappedKey(body.key);
    return this.db.transaction(() => {
      if (this.db.get<{ id: string }>("SELECT id FROM households LIMIT 1")) {
        throw new HttpError(
          409,
          "This Mac mini already has a household. Join it with a code from the other Mac, or restore with a recovery phrase.",
        );
      }
      const householdId = crypto.randomUUID();
      this.db.run("INSERT INTO households (id, created_at) VALUES (?, ?)", householdId, this.iso());
      this.saveKey(householdId, memberId, key);
      return this.newDevice(householdId, memberId, deviceName);
    });
  }

  private invite(caller: DeviceCaller, body: InviteRequest): InviteResponse {
    const memberId = text(body.memberId, "member", 64);
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const invite = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const expiresAt = this.iso(INVITE_MINUTES * 60_000);
    this.db.run(
      "INSERT INTO invites (token_hash, household_id, member_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)",
      hashHex(invite),
      caller.householdId,
      memberId,
      caller.deviceId,
      expiresAt,
    );
    return { invite, expiresAt };
  }

  private join(body: JoinRequest): DeviceGrant {
    const invite = token(body.invite, "join code", 128);
    const deviceName = text(body.deviceName, "device name", 80);
    const key = wrappedKey(body.key);
    return this.db.transaction(() => {
      const row = this.db.get<{
        household_id: string;
        member_id: string;
        expires_at: string;
        used_at: string | null;
      }>(
        "SELECT household_id, member_id, expires_at, used_at FROM invites WHERE token_hash = ?",
        hashHex(invite),
      );
      if (!row)
        throw new HttpError(
          404,
          "The Mac mini doesn't know that join code. Make a new one on the other Mac.",
        );
      if (row.used_at)
        throw new HttpError(
          410,
          "That join code was already used. Make a new one on the other Mac.",
        );
      if (row.expires_at <= this.iso()) {
        throw new HttpError(410, "That join code has expired. Make a new one on the other Mac.");
      }
      this.db.run(
        "UPDATE invites SET used_at = ? WHERE token_hash = ?",
        this.iso(),
        hashHex(invite),
      );
      this.saveKey(row.household_id, row.member_id, key);
      return this.newDevice(row.household_id, row.member_id, deviceName);
    });
  }

  private restore(body: RestoreRequest): RestoreResponse {
    const keyId = text(body.keyId, "key id", 64);
    const proof = token(body.proof, "key proof", 128);
    const deviceName = text(body.deviceName, "device name", 80);
    const now = this.now().getTime();
    while (this.failedRestores.length && this.failedRestores[0]! < now - 60_000)
      this.failedRestores.shift();
    if (this.failedRestores.length >= 20) {
      throw new HttpError(429, "Too many tries. Wait a minute and try again.");
    }
    const key = this.db.get<{
      household_id: string;
      member_id: string | null;
      proof_hash: string;
      nonce: string;
      ciphertext: string;
    }>(
      "SELECT household_id, member_id, proof_hash, nonce, ciphertext FROM keys WHERE key_id = ?",
      keyId,
    );
    if (!key || !sameHash(key.proof_hash, hashHex(proof))) {
      this.failedRestores.push(now);
      throw new HttpError(401, "That recovery phrase isn't known on this Mac mini.");
    }
    const grant = this.db.transaction(() =>
      this.newDevice(key.household_id, key.member_id, deviceName),
    );
    return { ...grant, key: { keyId, nonce: key.nonce, ciphertext: key.ciphertext } };
  }

  private latest(householdId: string): number {
    const row = this.db.get<{ latest: number | null }>(
      "SELECT MAX(seq) AS latest FROM envelopes WHERE household_id = ?",
      householdId,
    );
    return Number(row?.latest ?? 0);
  }

  private push(caller: DeviceCaller, body: PushRequest): PushResponse {
    const envelopes = Array.isArray(body.envelopes) ? body.envelopes : null;
    if (!envelopes) throw new HttpError(400, "Nothing to push.");
    if (envelopes.length > MAX_PUSH)
      throw new HttpError(413, `Push at most ${MAX_PUSH} changes at a time.`);
    const clean = envelopes.map((e) => {
      if (e.deviceId !== caller.deviceId) {
        throw new HttpError(403, "A change can only be pushed by the device that made it.");
      }
      return {
        id: text(e.id, "change id", 64),
        stream: text(e.stream, "stream", 32),
        nonce: token(e.nonce, "nonce", 64),
        ciphertext: token(e.ciphertext, "change", Math.ceil((MAX_CIPHERTEXT * 4) / 3) + 4),
      };
    });
    const now = this.iso();
    const stored = this.db.transaction(() => {
      let count = 0;
      for (const e of clean) {
        count += this.db.run(
          `INSERT OR IGNORE INTO envelopes (household_id, id, stream, device_id, nonce, ciphertext, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          caller.householdId,
          e.id,
          e.stream,
          caller.deviceId,
          e.nonce,
          e.ciphertext,
          now,
        ).changes;
      }
      return count;
    });
    const latest = this.latest(caller.householdId);
    if (stored > 0)
      for (const listener of this.listeners.get(caller.householdId) ?? []) listener(latest);
    return { stored, latest };
  }

  private pull(caller: Caller, url: URL): PullResponse {
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 1000)));
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) {
      throw new HttpError(400, "The sequence number doesn't look right.");
    }
    const rows = this.db.all<{
      seq: number;
      id: string;
      stream: string;
      device_id: string;
      nonce: string;
      ciphertext: string;
    }>(
      "SELECT seq, id, stream, device_id, nonce, ciphertext FROM envelopes WHERE household_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      caller.householdId,
      after,
      limit + 1,
    );
    const more = rows.length > limit;
    return {
      envelopes: rows.slice(0, limit).map((r) => ({
        seq: Number(r.seq),
        id: r.id,
        stream: r.stream,
        deviceId: r.device_id,
        nonce: r.nonce,
        ciphertext: r.ciphertext,
      })),
      latest: this.latest(caller.householdId),
      more,
    };
  }

  /** Server-sent events: "there is something new", and a keep-alive now and then. */
  private events(caller: DeviceCaller, signal?: AbortSignal): Response {
    let stop: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            stop?.();
          }
        };
        const listener = (latest: number) =>
          send(`event: changes\ndata: ${JSON.stringify({ latest })}\n\n`);
        const set = this.listeners.get(caller.householdId) ?? new Set();
        set.add(listener);
        this.listeners.set(caller.householdId, set);
        const beat = setInterval(() => send(": still here\n\n"), this.keepAliveMs);
        stop = () => {
          clearInterval(beat);
          set.delete(listener);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        signal?.addEventListener("abort", () => stop?.());
        send(
          `retry: 5000\nevent: hello\ndata: ${JSON.stringify({ latest: this.latest(caller.householdId) })}\n\n`,
        );
      },
      cancel: () => stop?.(),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        ...CORS,
      },
    });
  }

  private keys(caller: Caller) {
    const rows = this.db.all<{
      key_id: string;
      member_id: string | null;
      nonce: string;
      ciphertext: string;
      created_at: string;
    }>(
      "SELECT key_id, member_id, nonce, ciphertext, created_at FROM keys WHERE household_id = ? ORDER BY created_at",
      caller.householdId,
    );
    return {
      keys: rows.map((r) => ({
        keyId: r.key_id,
        memberId: r.member_id,
        nonce: r.nonce,
        ciphertext: r.ciphertext,
        createdAt: r.created_at,
      })),
    };
  }

  /** A new recovery phrase for this device's person; the old one stops working. */
  private replaceKey(caller: DeviceCaller, body: { key: NewWrappedKey }) {
    if (!caller.memberId) throw new HttpError(400, "This device isn't linked to one of us.");
    const key = wrappedKey(body.key);
    this.db.transaction(() => this.saveKey(caller.householdId, caller.memberId, key));
    return { ok: true };
  }

  private devices(caller: DeviceCaller): { devices: DeviceInfo[] } {
    const rows = this.db.all<{
      id: string;
      name: string;
      member_id: string | null;
      created_at: string;
      last_seen_at: string | null;
    }>(
      "SELECT id, name, member_id, created_at, last_seen_at FROM devices WHERE household_id = ? AND revoked_at IS NULL ORDER BY created_at",
      caller.householdId,
    );
    return {
      devices: rows.map((r) => ({
        id: r.id,
        name: r.name,
        memberId: r.member_id,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id === caller.deviceId,
      })),
    };
  }

  private revoke(caller: DeviceCaller, deviceId: string) {
    const changed = this.db.run(
      "UPDATE devices SET revoked_at = ? WHERE id = ? AND household_id = ? AND revoked_at IS NULL",
      this.iso(),
      deviceId,
      caller.householdId,
    ).changes;
    if (!changed) throw new HttpError(404, "That device isn't in the household.");
    return { ok: true };
  }
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new HttpError(413, "That's too much at once.");
  const body = await request.text();
  if (body.length > MAX_BODY) throw new HttpError(413, "That's too much at once.");
  try {
    return JSON.parse(body || "{}") as T;
  } catch {
    throw new HttpError(400, "That request isn't JSON.");
  }
}
