import {
  keysFromPhrase,
  newHouseholdKey,
  newRecoveryPhrase,
  sealRecord,
  unwrapHouseholdKey,
  wrapHouseholdKey,
} from "@duet/core/crypto";
import type { DeviceGrant, PullResponse, RestoreResponse } from "@duet/core/protocol";
import { describe, expect, it } from "vitest";
import { backupName, backupsToRemove } from "../src/backup.ts";
import { nodeRelayDb } from "../src/node-db.ts";
import { Relay } from "../src/relay.ts";

const BASE = "https://mini.example.ts.net";

function setup(options: { now?: () => Date } = {}) {
  const relay = new Relay({ db: nodeRelayDb(), keepAliveMs: 50, ...options });
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> => {
    const res = await relay.handle(
      new Request(BASE + path, {
        method,
        headers: { "content-type": "application/json", "Duet-Protocol": "1", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as T };
  };
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  return { relay, call, auth };
}

async function household(options: { now?: () => Date } = {}) {
  const t = setup(options);
  const key = newHouseholdKey();
  const jackPhrase = newRecoveryPhrase();
  const jack = await t.call<DeviceGrant>("POST", "/v1/households", {
    deviceName: "Jack's MacBook Air",
    memberId: "jack",
    key: wrapHouseholdKey(key, jackPhrase),
  });
  expect(jack.status).toBe(201);
  return { ...t, key, jackPhrase, jack: jack.body };
}

function envelope(deviceId: string, key: Uint8Array, n: number) {
  return sealRecord(
    {
      id: `0192d0a4-0000-7000-8000-00000000000${n}`,
      hlc: `2026-09-23T18:04:1${n}.000Z-0000-d-jack`,
      entity: "transaction",
      entityId: `tx-${n}`,
      fields: { amount: n * 100 },
      schema: 1,
      memberId: "jack",
    },
    key,
    deviceId,
  );
}

describe("relay", () => {
  it("answers health without a token, and says when a household exists", async () => {
    const t = setup();
    expect((await t.call<{ ready: boolean }>("GET", "/v1/health")).body).toMatchObject({
      ok: true,
      protocol: 1,
      ready: false,
    });
    const h = await household();
    expect((await h.call<{ ready: boolean }>("GET", "/v1/health")).body.ready).toBe(true);
  });

  it("holds one household", async () => {
    const h = await household();
    const again = await h.call<{ error: string }>("POST", "/v1/households", {
      deviceName: "Someone else",
      memberId: "x",
      key: wrapHouseholdKey(newHouseholdKey(), newRecoveryPhrase()),
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("already has a household");
  });

  it("numbers pushed changes, ignores repeats, and hands them out in order", async () => {
    const h = await household();
    const batch = [1, 2, 3].map((n) => envelope(h.jack.deviceId, h.key, n));
    const first = await h.call<{ stored: number; latest: number }>(
      "POST",
      "/v1/changes",
      { envelopes: batch },
      h.auth(h.jack.deviceToken),
    );
    expect(first.body).toEqual({ stored: 3, latest: 3 });
    const repeat = await h.call<{ stored: number }>(
      "POST",
      "/v1/changes",
      { envelopes: batch },
      h.auth(h.jack.deviceToken),
    );
    expect(repeat.body.stored).toBe(0);
    const pulled = await h.call<PullResponse>(
      "GET",
      "/v1/changes?after=1",
      undefined,
      h.auth(h.jack.deviceToken),
    );
    expect(pulled.body.envelopes.map((e) => e.seq)).toEqual([2, 3]);
    expect(pulled.body.envelopes[0]).toMatchObject({ id: batch[1]!.id, deviceId: h.jack.deviceId });
    expect(pulled.body).toMatchObject({ latest: 3, more: false });
    const paged = await h.call<PullResponse>(
      "GET",
      "/v1/changes?after=0&limit=2",
      undefined,
      h.auth(h.jack.deviceToken),
    );
    expect(paged.body.more).toBe(true);
  });

  it("only takes a device's own changes", async () => {
    const h = await household();
    const res = await h.call<{ error: string }>(
      "POST",
      "/v1/changes",
      { envelopes: [envelope("someone-else", h.key, 1)] },
      h.auth(h.jack.deviceToken),
    );
    expect(res.status).toBe(403);
  });

  it("pairs a second device with an invite that works once", async () => {
    const h = await household();
    const invite = await h.call<{ invite: string; expiresAt: string }>(
      "POST",
      "/v1/invites",
      { memberId: "jill" },
      h.auth(h.jack.deviceToken),
    );
    expect(invite.status).toBe(201);
    const jillPhrase = newRecoveryPhrase();
    const join = () =>
      h.call<DeviceGrant & { error?: string }>("POST", "/v1/devices", {
        invite: invite.body.invite,
        deviceName: "Jill's MacBook Pro",
        key: wrapHouseholdKey(h.key, jillPhrase),
      });
    const jill = await join();
    expect(jill.status).toBe(201);
    expect(jill.body).toMatchObject({ householdId: h.jack.householdId, memberId: "jill" });
    const again = await join();
    expect(again.status).toBe(410);
    expect(again.body.error).toContain("already used");

    // Jill sees what Jack pushed.
    await h.call(
      "POST",
      "/v1/changes",
      { envelopes: [envelope(h.jack.deviceId, h.key, 1)] },
      h.auth(h.jack.deviceToken),
    );
    const pulled = await h.call<PullResponse>(
      "GET",
      "/v1/changes?after=0",
      undefined,
      h.auth(jill.body.deviceToken),
    );
    expect(pulled.body.envelopes).toHaveLength(1);

    const devices = await h.call<{ devices: Array<{ name: string; current: boolean }> }>(
      "GET",
      "/v1/devices",
      undefined,
      h.auth(jill.body.deviceToken),
    );
    expect(devices.body.devices.map((d) => [d.name, d.current])).toEqual([
      ["Jack's MacBook Air", false],
      ["Jill's MacBook Pro", true],
    ]);
  });

  it("lets an invite expire after ten minutes", async () => {
    let now = Date.parse("2026-09-23T18:00:00Z");
    const h = await household({ now: () => new Date(now) });
    const invite = await h.call<{ invite: string }>(
      "POST",
      "/v1/invites",
      { memberId: "jill" },
      h.auth(h.jack.deviceToken),
    );
    now += 11 * 60_000;
    const late = await h.call<{ error: string }>("POST", "/v1/devices", {
      invite: invite.body.invite,
      deviceName: "Jill's MacBook Pro",
      key: wrapHouseholdKey(h.key, newRecoveryPhrase()),
    });
    expect(late.status).toBe(410);
    expect(late.body.error).toContain("expired");
  });

  it("restores a wiped Mac from its recovery phrase", async () => {
    const h = await household();
    const keys = keysFromPhrase(h.jackPhrase);
    const res = await h.call<RestoreResponse>("POST", "/v1/restore", {
      keyId: keys.keyId,
      proof: keys.proof,
      deviceName: "Jack's new Mac",
    });
    expect(res.status).toBe(201);
    expect(res.body.memberId).toBe("jack");
    expect(unwrapHouseholdKey(res.body.key, h.jackPhrase)).toEqual(h.key);

    const wrong = keysFromPhrase(newRecoveryPhrase());
    const bad = await h.call("POST", "/v1/restore", {
      keyId: keys.keyId,
      proof: wrong.proof,
      deviceName: "x",
    });
    expect(bad.status).toBe(401);
  });

  it("lets a recovery phrase read the log, and nothing more", async () => {
    const h = await household();
    await h.call(
      "POST",
      "/v1/changes",
      { envelopes: [envelope(h.jack.deviceId, h.key, 1)] },
      h.auth(h.jack.deviceToken),
    );
    const keys = keysFromPhrase(h.jackPhrase);
    const headers = { "Duet-Key-Id": keys.keyId, "Duet-Key-Proof": keys.proof };
    const pulled = await h.call<PullResponse>("GET", "/v1/changes?after=0", undefined, headers);
    expect(pulled.body.envelopes).toHaveLength(1);
    const push = await h.call("POST", "/v1/changes", { envelopes: [] }, headers);
    expect(push.status).toBe(401);
  });

  it("stops listening to a removed device", async () => {
    const h = await household();
    const invite = await h.call<{ invite: string }>(
      "POST",
      "/v1/invites",
      { memberId: "jill" },
      h.auth(h.jack.deviceToken),
    );
    const jill = await h.call<DeviceGrant>("POST", "/v1/devices", {
      invite: invite.body.invite,
      deviceName: "Jill's MacBook Pro",
      key: wrapHouseholdKey(h.key, newRecoveryPhrase()),
    });
    const removed = await h.call(
      "DELETE",
      `/v1/devices/${jill.body.deviceId}`,
      undefined,
      h.auth(h.jack.deviceToken),
    );
    expect(removed.status).toBe(200);
    const after = await h.call<{ error: string }>(
      "GET",
      "/v1/changes?after=0",
      undefined,
      h.auth(jill.body.deviceToken),
    );
    expect(after.status).toBe(401);
    expect(after.body.error).toContain("removed");
  });

  it("asks whichever side is older to update", async () => {
    const h = await household();
    const res = await h.call<{ error: string }>("GET", "/v1/changes?after=0", undefined, {
      ...h.auth(h.jack.deviceToken),
      "Duet-Protocol": "2",
    });
    expect(res.status).toBe(426);
    expect(res.body.error).toContain("duet-server update");
  });

  it("tells an open event stream when something new arrives", async () => {
    const h = await household();
    const abort = new AbortController();
    const res = await h.relay.handle(
      new Request(`${BASE}/v1/events`, {
        headers: { authorization: `Bearer ${h.jack.deviceToken}`, "Duet-Protocol": "1" },
        signal: abort.signal,
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const read = async (until: string) => {
      while (!seen.includes(until)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value);
      }
    };
    await read("event: hello");
    await h.call(
      "POST",
      "/v1/changes",
      { envelopes: [envelope(h.jack.deviceId, h.key, 1)] },
      h.auth(h.jack.deviceToken),
    );
    await read("event: changes");
    expect(seen).toContain('data: {"latest":1}');
    abort.abort();
    await reader.cancel();
  });

  it("answers the app's cross-origin preflight", async () => {
    const t = setup();
    const res = await t.relay.handle(new Request(`${BASE}/v1/changes`, { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Duet-Protocol");
  });
});

describe("backups", () => {
  it("keep 30 days, then the first of each month for a year", () => {
    const today = new Date("2026-09-23T03:00:00Z");
    const names: string[] = [];
    for (let d = 0; d < 500; d++) {
      names.push(backupName(new Date(today.getTime() - d * 86_400_000)));
    }
    const removed = new Set(backupsToRemove([...names, "notes.txt"], today));
    const kept = names.filter((n) => !removed.has(n));
    expect(kept).toContain("relay-2026-09-23.db");
    expect(kept).toContain("relay-2026-08-25.db");
    expect(kept).not.toContain("relay-2026-08-20.db");
    expect(kept).toContain("relay-2026-08-01.db");
    expect(kept).toContain("relay-2025-10-01.db");
    expect(kept).not.toContain("relay-2025-09-01.db");
    expect(removed.has("notes.txt")).toBe(false);
    expect(kept.length).toBe(30 + 11);
  });
});

describe("the app at /app", () => {
  it("hands out only the app's own files", async () => {
    const files: Record<string, string> = {
      "latest.json": '{"version":"0.2.0"}',
      "Duet.app.tar.gz": "bundle",
    };
    const relay = new Relay({
      db: nodeRelayDb(),
      appFile: async (name) => (name in files ? new Blob([files[name]!]) : null),
    });
    const get = (path: string) => relay.handle(new Request(BASE + path));
    const manifest = await get("/app/latest.json");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/json");
    expect(await manifest.json()).toEqual({ version: "0.2.0" });
    expect(await (await get("/app/Duet.app.tar.gz")).text()).toBe("bundle");
    // Not there yet, not the app's, or reaching for something else.
    for (const path of ["/app/install.sh", "/app/relay.db", "/app/..%2Frelay.db", "/app/"]) {
      expect((await get(path)).status).toBe(404);
    }
  });
});
