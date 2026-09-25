import {
  decodeJoinCode,
  encodeJoinCode,
  keysFromPhrase,
  newHouseholdKey,
  newRecoveryPhrase,
  openRecord,
  sealRecord,
  unwrapHouseholdKey,
  wrapHouseholdKey,
} from "./crypto.ts";
import { isSetUp } from "./household.ts";
import { fromBase64Url, toBase64Url } from "./ids.ts";
import {
  type CreateHouseholdRequest,
  type DeviceGrant,
  type DeviceInfo,
  type Envelope,
  type Health,
  type InviteResponse,
  type JoinRequest,
  KEY_ID_HEADER,
  KEY_PROOF_HEADER,
  type NewWrappedKey,
  PROTOCOL,
  PROTOCOL_HEADER,
  type PullResponse,
  type PushResponse,
  type RestoreRequest,
  type RestoreResponse,
  type WrappedKey,
} from "./protocol.ts";
import type { ChangeRecord, Store } from "./store.ts";

/**
 * Keeping our two Macs in step through the relay on the Mac mini (spec, "Sync and
 * encryption"). Local changes wait in the outbox, go out sealed with the household key, and
 * come back to the other Mac as envelopes it opens and merges field by field. Pairing, join
 * codes and restoring from a recovery phrase live here too, so the app only adds screens.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class RelayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** "mac-mini.tail1234.ts.net" → "https://mac-mini.tail1234.ts.net" */
export function normalizeRelayUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export class RelayClient {
  readonly url: string;
  private readonly token: string | null;
  private readonly keyAuth: { keyId: string; proof: string } | null;
  private readonly fetcher: Fetch;

  constructor(
    url: string,
    options: {
      token?: string | null;
      keyAuth?: { keyId: string; proof: string };
      fetch?: Fetch;
    } = {},
  ) {
    this.url = normalizeRelayUrl(url);
    this.token = options.token ?? null;
    this.keyAuth = options.keyAuth ?? null;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      [PROTOCOL_HEADER]: String(PROTOCOL),
      "content-type": "application/json",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.keyAuth) {
      headers[KEY_ID_HEADER] = this.keyAuth.keyId;
      headers[KEY_PROOF_HEADER] = this.keyAuth.proof;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.url + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new RelayError(0, "Can't reach the Mac mini. Is this Mac on the tailnet?");
    }
    if (!response.ok) {
      let message = `The Mac mini answered ${response.status}.`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // not JSON
      }
      throw new RelayError(response.status, message);
    }
    return (await response.json()) as T;
  }

  health(): Promise<Health> {
    return this.request("GET", "/v1/health");
  }
  createHousehold(body: CreateHouseholdRequest): Promise<DeviceGrant> {
    return this.request("POST", "/v1/households", body);
  }
  invite(memberId: string): Promise<InviteResponse> {
    return this.request("POST", "/v1/invites", { memberId });
  }
  join(body: JoinRequest): Promise<DeviceGrant> {
    return this.request("POST", "/v1/devices", body);
  }
  restore(body: RestoreRequest): Promise<RestoreResponse> {
    return this.request("POST", "/v1/restore", body);
  }
  push(envelopes: Envelope[]): Promise<PushResponse> {
    return this.request("POST", "/v1/changes", { envelopes });
  }
  pull(after: number, limit = 1000): Promise<PullResponse> {
    return this.request("GET", `/v1/changes?after=${after}&limit=${limit}`);
  }
  keys(): Promise<{ keys: Array<WrappedKey & { memberId: string | null; createdAt: string }> }> {
    return this.request("GET", "/v1/keys");
  }
  replaceKey(key: NewWrappedKey): Promise<{ ok: true }> {
    return this.request("PUT", "/v1/keys", { key });
  }
  devices(): Promise<{ devices: DeviceInfo[] }> {
    return this.request("GET", "/v1/devices");
  }
  removeDevice(id: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/v1/devices/${encodeURIComponent(id)}`);
  }

  /**
   * Listens for "there is something new" until the stream ends or `signal` aborts. Uses a
   * streaming fetch rather than EventSource, so the device token travels as a header.
   */
  async listen(onChanges: (latest: number) => void, signal: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}/v1/events`, { headers: this.headers(), signal });
    } catch (error) {
      if (signal.aborted) return;
      throw new RelayError(0, error instanceof Error ? error.message : "Can't reach the Mac mini.");
    }
    if (!response.ok || !response.body)
      throw new RelayError(response.status, "The Mac mini closed the event stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end = buffer.indexOf("\n\n");
        while (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (data) {
            try {
              const latest = (JSON.parse(data) as { latest?: number }).latest;
              if (typeof latest === "number") onChanges(latest);
            } catch {
              // a comment or something we don't know
            }
          }
          end = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }
}

// ————— Where the keys and settings live —————

/** The keychain on the desktop (an in-memory stand-in in the browser preview and tests). */
export interface Secrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const SECRET_HOUSEHOLD_KEY = "householdKey";
const SECRET_DEVICE_TOKEN = "deviceToken";
const META_KEYS = ["syncRelayUrl", "syncHouseholdId", "syncDeviceId", "syncSeq"];

export interface SyncCredentials {
  relayUrl: string;
  householdId: string;
  deviceId: string;
  deviceToken: string;
  householdKey: Uint8Array;
}

export async function loadCredentials(
  store: Store,
  secrets: Secrets,
): Promise<SyncCredentials | null> {
  const meta = await store.getMeta(META_KEYS);
  if (!meta.syncRelayUrl || !meta.syncDeviceId) return null;
  const [key, token] = await Promise.all([
    secrets.get(SECRET_HOUSEHOLD_KEY),
    secrets.get(SECRET_DEVICE_TOKEN),
  ]);
  if (!key || !token) return null;
  return {
    relayUrl: meta.syncRelayUrl,
    householdId: meta.syncHouseholdId ?? "",
    deviceId: meta.syncDeviceId,
    deviceToken: token,
    householdKey: fromBase64Url(key),
  };
}

async function saveCredentials(
  store: Store,
  secrets: Secrets,
  relayUrl: string,
  grant: DeviceGrant,
  householdKey: Uint8Array,
): Promise<SyncCredentials> {
  await secrets.set(SECRET_HOUSEHOLD_KEY, toBase64Url(householdKey));
  await secrets.set(SECRET_DEVICE_TOKEN, grant.deviceToken);
  await store.setMeta({
    syncRelayUrl: relayUrl,
    syncHouseholdId: grant.householdId,
    syncDeviceId: grant.deviceId,
    syncSeq: "0",
  });
  store.notify(["sync"]);
  return {
    relayUrl,
    householdId: grant.householdId,
    deviceId: grant.deviceId,
    deviceToken: grant.deviceToken,
    householdKey,
  };
}

/** Stops syncing on this Mac: forgets the keys and the relay. The data stays. */
export async function forgetSync(store: Store, secrets: Secrets): Promise<void> {
  await secrets.delete(SECRET_HOUSEHOLD_KEY);
  await secrets.delete(SECRET_DEVICE_TOKEN);
  await store.setMeta(Object.fromEntries(META_KEYS.map((k) => [k, null])));
  store.notify(["sync"]);
}

// ————— Pairing —————

/**
 * The first of us turns sync on: a new household on the Mac mini, and a recovery phrase to
 * show once. Everything already on this Mac goes up with the first sync.
 */
export async function startHousehold(
  store: Store,
  secrets: Secrets,
  input: { relayUrl: string; deviceName: string; fetch?: Fetch },
): Promise<{ phrase: string; credentials: SyncCredentials }> {
  if (!store.memberId) throw new Error("Set up the two of us first.");
  const relayUrl = normalizeRelayUrl(input.relayUrl);
  const householdKey = newHouseholdKey();
  const phrase = newRecoveryPhrase();
  const client = new RelayClient(relayUrl, { fetch: input.fetch });
  const grant = await client.createHousehold({
    deviceName: input.deviceName,
    memberId: store.memberId,
    key: wrapHouseholdKey(householdKey, phrase),
  });
  const credentials = await saveCredentials(store, secrets, relayUrl, grant, householdKey);
  return { phrase, credentials };
}

/** A join code for the other one of us: works once, for ten minutes. */
export async function makeJoinCode(
  store: Store,
  secrets: Secrets,
  input: { memberId: string; fetch?: Fetch },
): Promise<{ code: string; expiresAt: string }> {
  const credentials = await loadCredentials(store, secrets);
  if (!credentials) throw new Error("Sync isn't set up on this Mac yet.");
  const client = new RelayClient(credentials.relayUrl, {
    token: credentials.deviceToken,
    fetch: input.fetch,
  });
  const { invite, expiresAt } = await client.invite(input.memberId);
  const code = encodeJoinCode({
    relayUrl: credentials.relayUrl,
    invite,
    householdKey: credentials.householdKey,
    householdId: credentials.householdId,
    memberId: input.memberId,
  });
  return { code, expiresAt };
}

async function assertFresh(store: Store): Promise<void> {
  if (await isSetUp(store)) {
    throw new Error(
      "This Mac already has a household of its own. Joining works from a fresh start.",
    );
  }
}

/** The second of us joins with the code from the first Mac, and gets their own phrase. */
export async function joinHousehold(
  store: Store,
  secrets: Secrets,
  input: { code: string; deviceName: string; fetch?: Fetch },
): Promise<{ phrase: string; credentials: SyncCredentials }> {
  await assertFresh(store);
  const code = decodeJoinCode(input.code);
  const phrase = newRecoveryPhrase();
  const client = new RelayClient(code.relayUrl, { fetch: input.fetch });
  const grant = await client.join({
    invite: code.invite,
    deviceName: input.deviceName,
    key: wrapHouseholdKey(code.householdKey, phrase),
  });
  const memberId = grant.memberId ?? code.memberId;
  store.memberId = memberId;
  await store.setMeta({ memberId });
  const credentials = await saveCredentials(
    store,
    secrets,
    code.relayUrl,
    grant,
    code.householdKey,
  );
  return { phrase, credentials };
}

/** A new or wiped Mac: the recovery phrase opens the household key, and the log rebuilds the rest. */
export async function restoreFromPhrase(
  store: Store,
  secrets: Secrets,
  input: { relayUrl: string; phrase: string; deviceName: string; fetch?: Fetch },
): Promise<SyncCredentials> {
  await assertFresh(store);
  const relayUrl = normalizeRelayUrl(input.relayUrl);
  const keys = keysFromPhrase(input.phrase);
  const client = new RelayClient(relayUrl, { fetch: input.fetch });
  const restored = await client.restore({
    keyId: keys.keyId,
    proof: keys.proof,
    deviceName: input.deviceName,
  });
  const householdKey = unwrapHouseholdKey(restored.key, input.phrase);
  if (restored.memberId) {
    store.memberId = restored.memberId;
    await store.setMeta({ memberId: restored.memberId });
  }
  return saveCredentials(store, secrets, relayUrl, restored, householdKey);
}

/** A new recovery phrase for whoever is on this Mac; the old one stops working. */
export async function replacePhrase(
  store: Store,
  secrets: Secrets,
  fetch?: Fetch,
): Promise<string> {
  const credentials = await loadCredentials(store, secrets);
  if (!credentials) throw new Error("Sync isn't set up on this Mac yet.");
  const phrase = newRecoveryPhrase();
  const client = new RelayClient(credentials.relayUrl, { token: credentials.deviceToken, fetch });
  await client.replaceKey(wrapHouseholdKey(credentials.householdKey, phrase));
  return phrase;
}

// ————— Syncing —————

const PUSH_BATCH = 200;

export interface SyncResult {
  pushed: number;
  pulled: number;
}

export class SyncEngine {
  readonly client: RelayClient;
  private readonly store: Store;
  private readonly credentials: SyncCredentials;
  private running: Promise<SyncResult> | null = null;
  private again = false;

  constructor(store: Store, credentials: SyncCredentials, options: { fetch?: Fetch } = {}) {
    this.store = store;
    this.credentials = credentials;
    this.client = new RelayClient(credentials.relayUrl, {
      token: credentials.deviceToken,
      fetch: options.fetch,
    });
  }

  /** Sends everything waiting in the outbox. */
  async push(): Promise<number> {
    let pushed = 0;
    for (;;) {
      const records = await this.store.outbox(PUSH_BATCH);
      if (records.length === 0) return pushed;
      const envelopes = records.map((r) =>
        sealRecord(r, this.credentials.householdKey, this.credentials.deviceId),
      );
      await this.client.push(envelopes);
      await this.store.clearOutbox(records.map((r) => r.id));
      pushed += records.length;
      if (records.length < PUSH_BATCH) return pushed;
    }
  }

  /** Brings in everything after the last change we've seen, and merges it. */
  async pull(): Promise<number> {
    let pulled = 0;
    for (;;) {
      const meta = await this.store.getMeta(["syncSeq"]);
      const after = Number(meta.syncSeq ?? 0);
      const page = await this.client.pull(after);
      if (page.envelopes.length === 0) return pulled;
      const records: ChangeRecord[] = page.envelopes.map((e) =>
        openRecord(e, this.credentials.householdKey),
      );
      pulled += await this.store.applyRemote(records);
      const last = page.envelopes[page.envelopes.length - 1]!.seq;
      await this.store.setMeta({ syncSeq: String(last) });
      if (!page.more) return pulled;
    }
  }

  /** Push, then pull. Overlapping calls share one run, and one more follows if asked for meanwhile. */
  sync(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let total: SyncResult = { pushed: 0, pulled: 0 };
      try {
        do {
          this.again = false;
          const pushed = await this.push();
          const pulled = await this.pull();
          total = { pushed: total.pushed + pushed, pulled: total.pulled + pulled };
        } while (this.again);
        await this.store.setMeta({ syncLastAt: new Date().toISOString() });
        return total;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
