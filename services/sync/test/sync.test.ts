import {
  addByHand,
  ebbFlowView,
  type Fetch,
  getMembers,
  isSetUp,
  joinHousehold,
  listTransactions,
  loadCredentials,
  makeJoinCode,
  monthView,
  NewerDataError,
  restoreFromPhrase,
  type Secrets,
  Store,
  SyncEngine,
  sealRecord,
  setupHousehold,
  startHousehold,
} from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";
import { describe, expect, it } from "vitest";
import { nodeRelayDb } from "../src/node-db.ts";
import { Relay } from "../src/relay.ts";

/** A keychain stand-in. */
function memorySecrets(): Secrets {
  const values = new Map<string, string>();
  return {
    get: async (k) => values.get(k) ?? null,
    set: async (k, v) => {
      values.set(k, v);
    },
    delete: async (k) => {
      values.delete(k);
    },
  };
}

const RELAY_URL = "https://mac-mini.tail1234.ts.net";

/** A Mac mini in memory: requests go straight to the relay. */
function macMini() {
  const relay = new Relay({ db: nodeRelayDb() });
  const fetch = (input: string, init?: RequestInit) => relay.handle(new Request(input, init));
  return { relay, fetch };
}

async function mac(deviceId: string) {
  const store = await Store.open(new NodeSqliteDriver(), { deviceId });
  return { store, secrets: memorySecrets() };
}

async function engine(m: { store: Store; secrets: Secrets }, fetch: Fetch) {
  const credentials = await loadCredentials(m.store, m.secrets);
  if (!credentials) throw new Error("not paired");
  return new SyncEngine(m.store, credentials, { fetch });
}

describe("sync between our two Macs", () => {
  it("pairs, keeps both Macs in step, and restores a wiped Mac from its phrase", async () => {
    const mini = macMini();

    // Jack sets up on the first Mac and adds a few things before turning sync on.
    const jack = await mac("d-jack");
    const { members } = await setupHousehold(jack.store, {
      names: ["Jack", "Jill"],
      me: 0,
      firstBp: 5800,
      fromMonth: "2026-01",
    });
    const [jackId, jillId] = [members[0]!.id, members[1]!.id];
    await addByHand(jack.store, {
      amount: 631800,
      merchant: "Rent and the rest",
      date: "2026-08-01",
      categoryId: "rent",
      share: "ours",
      accountId: null,
      paidBy: jackId,
    });
    await addByHand(jack.store, {
      amount: 1150,
      merchant: "Blue Bottle Coffee",
      date: "2026-08-27",
      categoryId: "coffee",
      share: "mine",
      accountId: null,
      paidBy: jackId,
    });

    const { phrase: jackPhrase } = await startHousehold(jack.store, jack.secrets, {
      relayUrl: "mac-mini.tail1234.ts.net",
      deviceName: "Jack's MacBook Air",
      fetch: mini.fetch,
    });
    expect(jackPhrase.split(" ")).toHaveLength(24);
    const jackSync = await engine(jack, mini.fetch);
    const first = await jackSync.sync();
    expect(first.pushed).toBeGreaterThan(40);
    expect(await jack.store.outbox()).toHaveLength(0);

    // The relay only ever holds ciphertext.
    const stored = await mini.relay.handle(
      new Request(`${RELAY_URL}/v1/changes?after=0&limit=5000`, {
        headers: {
          authorization: `Bearer ${(await loadCredentials(jack.store, jack.secrets))!.deviceToken}`,
        },
      }),
    );
    const raw = await stored.text();
    expect(raw).not.toContain("Blue Bottle");
    expect(raw).not.toContain("Rent and the rest");

    // Jill joins on a fresh Mac with the code from Jack's.
    const { code } = await makeJoinCode(jack.store, jack.secrets, {
      memberId: jillId,
      fetch: mini.fetch,
    });
    const jill = await mac("d-jill");
    const { phrase: jillPhrase } = await joinHousehold(jill.store, jill.secrets, {
      code,
      deviceName: "Jill's MacBook Pro",
      fetch: mini.fetch,
    });
    expect(jillPhrase).not.toBe(jackPhrase);
    const jillSync = await engine(jill, mini.fetch);
    await jillSync.sync();

    expect(await isSetUp(jill.store)).toBe(true);
    expect(jill.store.memberId).toBe(jillId);
    expect((await getMembers(jill.store)).map((m) => m.name)).toEqual(["Jack", "Jill"]);
    // Jack's Ours arrived; Jack's Mine arrived only as a total.
    const jillView = await monthView(jill.store, "2026-08");
    expect(jillView.ours).toBe(631800);
    expect(jillView.mineByMember[jackId]).toBe(1150);
    const seen = await listTransactions(jill.store, { month: "2026-08", share: "all" });
    expect(seen.map((t) => t.merchant)).toEqual(["Rent and the rest"]);

    // Jill adds something Ours; Jack's Mac sees it on its next sync.
    await addByHand(jill.store, {
      amount: 8642,
      merchant: "Trader Joe's",
      date: "2026-08-28",
      categoryId: "groceries",
      share: "ours",
      accountId: null,
      paidBy: jillId,
    });
    await jillSync.sync();
    await jackSync.sync();
    const jackView = await monthView(jack.store, "2026-08");
    expect(jackView.ours).toBe(631800 + 8642);
    expect((await ebbFlowView(jack.store, "2026-08")).flow.overall).toBe(
      (await ebbFlowView(jill.store, "2026-08")).flow.overall,
    );

    // Jack's Mac is wiped. The recovery phrase brings the household back.
    const fresh = await mac("d-jack-new");
    await restoreFromPhrase(fresh.store, fresh.secrets, {
      relayUrl: RELAY_URL,
      phrase: jackPhrase,
      deviceName: "Jack's new Mac",
      fetch: mini.fetch,
    });
    await (await engine(fresh, mini.fetch)).sync();
    expect(fresh.store.memberId).toBe(jackId);
    expect(await isSetUp(fresh.store)).toBe(true);
    const restored = await monthView(fresh.store, "2026-08");
    expect(restored.ours).toBe(jackView.ours);
    expect(restored.mineByMember[jackId]).toBe(1150);
  });

  it("won't join or restore over a household that's already here", async () => {
    const mini = macMini();
    const jack = await mac("d-jack");
    await setupHousehold(jack.store, {
      names: ["Jack", "Jill"],
      me: 0,
      firstBp: 5000,
      fromMonth: "2026-01",
    });
    const { phrase } = await startHousehold(jack.store, jack.secrets, {
      relayUrl: RELAY_URL,
      deviceName: "Jack's Mac",
      fetch: mini.fetch,
    });
    await expect(
      restoreFromPhrase(jack.store, jack.secrets, {
        relayUrl: RELAY_URL,
        phrase,
        deviceName: "x",
        fetch: mini.fetch,
      }),
    ).rejects.toThrow("already has a household");
  });

  it("asks to update instead of guessing at data from a newer Duet", async () => {
    const mini = macMini();
    const jack = await mac("d-jack");
    const { members } = await setupHousehold(jack.store, {
      names: ["Jack", "Jill"],
      me: 0,
      firstBp: 5000,
      fromMonth: "2026-01",
    });
    await startHousehold(jack.store, jack.secrets, {
      relayUrl: RELAY_URL,
      deviceName: "Jack's Mac",
      fetch: mini.fetch,
    });
    const credentials = (await loadCredentials(jack.store, jack.secrets))!;
    const future = sealRecord(
      {
        id: "0192d0a4-0000-7000-8000-00000000ffff",
        hlc: "2030-01-01T00:00:00.000Z-0000-d-future",
        entity: "transaction",
        entityId: "tx-future",
        fields: {},
        schema: 99,
        memberId: members[0]!.id,
      },
      credentials.householdKey,
      credentials.deviceId,
    );
    await new SyncEngine(jack.store, credentials, { fetch: mini.fetch }).client.push([future]);
    const other = await mac("d-other");
    const { code } = await makeJoinCode(jack.store, jack.secrets, {
      memberId: members[1]!.id,
      fetch: mini.fetch,
    });
    await joinHousehold(other.store, other.secrets, {
      code,
      deviceName: "Jill's Mac",
      fetch: mini.fetch,
    });
    await expect((await engine(other, mini.fetch)).sync()).rejects.toBeInstanceOf(NewerDataError);
  });
});
