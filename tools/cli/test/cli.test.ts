import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addByHand,
  loadCredentials,
  newRecoveryPhrase,
  type Secrets,
  Store,
  SyncEngine,
  setupHousehold,
  startHousehold,
} from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";
import { nodeRelayDb } from "@duet/sync/src/node-db.ts";
import { Relay } from "@duet/sync/src/relay.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { exportHousehold, fileSource, inspectRelay, relaySource, toCsv } from "../src/export.ts";

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

describe("duet export", () => {
  const dir = mkdtempSync(join(tmpdir(), "duet-cli-"));
  const relayPath = join(dir, "relay.db");
  let relay: Relay;
  let fetch: (input: string, init?: RequestInit) => Promise<Response>;
  let phrase = "";

  beforeAll(async () => {
    relay = new Relay({ db: nodeRelayDb(relayPath) });
    fetch = (input, init) => relay.handle(new Request(input, init));
    const store = await Store.open(new NodeSqliteDriver(), { deviceId: "d-jack" });
    const secrets = memorySecrets();
    const { members } = await setupHousehold(store, {
      names: ["Jack", "Jill"],
      me: 0,
      firstBp: 5800,
      fromMonth: "2026-01",
    });
    await addByHand(store, {
      amount: 8642,
      merchant: 'Trader Joe\'s, "the big one"',
      date: "2026-08-28",
      categoryId: "groceries",
      share: "ours",
      accountId: null,
      paidBy: members[0]!.id,
    });
    await addByHand(store, {
      amount: 1150,
      merchant: "Blue Bottle Coffee",
      date: "2026-08-27",
      categoryId: "coffee",
      share: "mine",
      accountId: null,
      paidBy: members[0]!.id,
    });
    ({ phrase } = await startHousehold(store, secrets, {
      relayUrl: "https://mini.ts.net",
      deviceName: "Jack's Mac",
      fetch,
    }));
    await new SyncEngine(store, (await loadCredentials(store, secrets))!, { fetch }).sync();
  });

  it("opens a relay backup with the recovery phrase", async () => {
    const out = join(dir, "from-file");
    const summary = await exportHousehold(fileSource(relayPath), phrase, { out });
    expect(summary.transactions).toBe(1);
    const csv = readFileSync(join(out, "transactions.csv"), "utf8");
    expect(csv.split("\n")[0]).toBe("Date,Merchant,Amount,Category,Paid by,Account,Note,Added");
    expect(csv).toContain('2026-08-28,"Trader Joe\'s, ""the big one""",86.42,Groceries,Jack');
    expect(csv).not.toContain("Blue Bottle");
    const household = JSON.parse(readFileSync(join(out, "household.json"), "utf8"));
    expect(household.members.map((m: { name: string }) => m.name)).toEqual(["Jack", "Jill"]);
    expect(household.mineTotals).toEqual([
      expect.objectContaining({ month: "2026-08", categoryId: "coffee", total: 1150, count: 1 }),
    ]);
    expect(readFileSync(join(out, "mine-totals.csv"), "utf8")).toContain(
      "2026-08,Jack,Coffee,11.50,1",
    );
  });

  it("reads the live relay with the phrase as the only credential", async () => {
    const summary = await exportHousehold(
      relaySource("https://mini.ts.net", phrase, fetch),
      phrase,
      {
        out: join(dir, "from-relay"),
      },
    );
    expect(summary.transactions).toBe(1);
  });

  it("won't open with another phrase, or write over an export", async () => {
    await expect(
      exportHousehold(fileSource(relayPath), newRecoveryPhrase(), { out: join(dir, "x") }),
    ).rejects.toThrow("isn't known here");
    await expect(
      exportHousehold(fileSource(relayPath), phrase, { out: join(dir, "from-file") }),
    ).rejects.toThrow("already exists");
  });

  it("inspects a relay database without opening anything", () => {
    const s = inspectRelay(relayPath);
    expect(s.households).toBe(1);
    expect(s.devices.map((d) => d.name)).toEqual(["Jack's Mac"]);
    expect(s.changes).toBeGreaterThan(40);
  });

  it("writes CSV that spreadsheets read back", () => {
    expect(toCsv([["a", 'say "hi"', "x,y", null]])).toBe('a,"say ""hi""","x,y",\n');
  });
});
