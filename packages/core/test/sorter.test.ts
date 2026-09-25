import { describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../src/db/node.ts";
import { addByHand } from "../src/entries.ts";
import { setupHousehold } from "../src/household.ts";
import {
  cosine,
  nearestCategories,
  proposeMapping,
  SorterClient,
  smartSort,
} from "../src/sorter.ts";
import { Store } from "../src/store.ts";

/** Letter counts: texts that share a merchant name land close together. */
function letters(text: string): number[] {
  const v = new Array(26).fill(0);
  for (const ch of text.toLowerCase()) {
    const i = ch.charCodeAt(0) - 97;
    if (i >= 0 && i < 26) v[i] += 1;
  }
  return v;
}

function fakeSorter(options: { llm?: boolean; embed?: boolean; down?: boolean } = {}) {
  const calls = { embed: 0, embedded: [] as string[], generate: 0 };
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (options.down) throw new Error("offline");
    const path = new URL(input).pathname.replace(/^\/sort/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (path === "/v1/health") {
      return json({
        ok: true,
        ollama: true,
        embed: { model: "letters", ready: options.embed ?? true },
        llm: { model: "tiny", ready: options.llm ?? true },
        laya: { ready: false },
      });
    }
    if (path === "/v1/embed") {
      calls.embed++;
      calls.embedded.push(...body.texts);
      return json({ model: "letters", vectors: body.texts.map(letters) });
    }
    if (path === "/v1/generate") {
      calls.generate++;
      const prompt: string = body.prompt;
      const categoryId = /VET|PET/.test(prompt) ? "pets" : "uncategorized";
      return json({ output: { categoryId, confidence: 0.97, reason: "A vet clinic, so Pets" } });
    }
    return new Response("{}", { status: 404 });
  };
  return { client: new SorterClient("https://mini.ts.net/sort", { fetch }), calls };
}

async function household() {
  const store = await Store.open(new NodeSqliteDriver(), { deviceId: "d-jack" });
  const { members } = await setupHousehold(store, {
    names: ["Jack", "Jill"],
    me: 0,
    firstBp: 5000,
    fromMonth: "2026-01",
  });
  const past: Array<[string, string]> = [
    ["BLUE BOTTLE COFFEE OAKLAND", "coffee"],
    ["BLUE BOTTLE COFFEE SF", "coffee"],
    ["SHELL OIL 57444", "gas"],
    ["CHEVRON 0204531", "gas"],
  ];
  for (const [merchant, categoryId] of past) {
    await addByHand(store, {
      amount: 500,
      merchant,
      date: "2026-07-10",
      categoryId,
      share: "ours",
      accountId: null,
      paidBy: members[0]!.id,
    });
  }
  const account = (await store.db.all<{ id: string }>("SELECT id FROM accounts LIMIT 1"))[0]!.id;
  const draft = async (id: string, description: string, extra: Record<string, unknown> = {}) => {
    const row = {
      id,
      file_id: "file-1",
      account_id: account,
      date: "2026-08-20",
      amount: 1234,
      description,
      merchant: description,
      kind: "purchase",
      tier: "none",
      confidence: 0,
      decision: "pending",
      ...extra,
    };
    const cols = Object.keys(row);
    await store.db.run(
      `INSERT INTO drafts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      Object.values(row) as Array<string | number>,
    );
  };
  await draft("d1", "BLUE BOTTLE COFFEE BERKELEY");
  await draft("d2", "EAST BAY VET CLINIC");
  await draft("d3", "SHELL OIL 12345", { tier: "you", category_id: "car", confidence: 1 });
  await draft("d4", "TRADER JOE S", { tier: "rule", category_id: "groceries", confidence: 1 });
  return store;
}

const row = async (store: Store, id: string) =>
  (
    await store.db.all<{
      category_id: string;
      confidence: number;
      tier: string;
      why: string;
      decision: string;
    }>("SELECT category_id, confidence, tier, why, decision FROM drafts WHERE id = ?", [id])
  )[0]!;

describe("smart sorting with the Mac mini", () => {
  it("finds the nearest past rows, and asks the model about new merchants", async () => {
    const store = await household();
    const { client, calls } = fakeSorter();
    const result = await smartSort(store, client, { fileId: "file-1" });
    expect(result).toEqual({ improved: 2, waiting: 0 });

    const coffee = await row(store, "d1");
    expect(coffee).toMatchObject({ category_id: "coffee", tier: "model", decision: "pending" });
    expect(coffee.confidence).toBeGreaterThanOrEqual(0.85);
    expect(coffee.why).toBe(
      "Like past rows at BLUE BOTTLE COFFEE SF and BLUE BOTTLE COFFEE OAKLAND, which were Coffee.",
    );

    const vet = await row(store, "d2");
    expect(vet).toMatchObject({
      category_id: "pets",
      tier: "model",
      why: "A vet clinic, so Pets.",
    });
    // What the model says about itself never makes a row look sure.
    expect(vet.confidence).toBeLessThan(0.85);
    expect(calls.generate).toBe(1);

    // Rows we picked ourselves, and rule rows, stay as they were.
    expect(await row(store, "d3")).toMatchObject({ category_id: "car", tier: "you" });
    expect(await row(store, "d4")).toMatchObject({ category_id: "groceries", tier: "rule" });
  });

  it("keeps vectors here, so the Mac mini isn't asked twice", async () => {
    const store = await household();
    const first = fakeSorter();
    await smartSort(store, first.client, { fileId: "file-1" });
    await store.db.run("UPDATE drafts SET tier = 'none', confidence = 0 WHERE id IN ('d1', 'd2')");
    const second = fakeSorter();
    await smartSort(store, second.client, { fileId: "file-1" });
    expect(second.calls.embed).toBe(0);
  });

  it("leaves everything waiting when the Mac mini is away", async () => {
    const store = await household();
    const { client } = fakeSorter({ down: true });
    expect(await smartSort(store, client, { fileId: "file-1" })).toEqual({
      improved: 0,
      waiting: 2,
    });
    expect((await row(store, "d1")).tier).toBe("none");
  });

  it("uses embeddings alone when there's no LLM yet", async () => {
    const store = await household();
    const { client, calls } = fakeSorter({ llm: false });
    const result = await smartSort(store, client, { fileId: "file-1" });
    expect(result).toEqual({ improved: 1, waiting: 1 });
    expect(calls.generate).toBe(0);
  });
});

describe("nearest categories", () => {
  it("vote by similarity, strongest first", () => {
    const pool = [
      { text: "a", merchant: "A", categoryId: "coffee", vector: [1, 0] },
      { text: "b", merchant: "B", categoryId: "coffee", vector: [0.9, 0.1] },
      { text: "c", merchant: "C", categoryId: "gas", vector: [0, 1] },
    ];
    const { candidates, neighbours } = nearestCategories([1, 0.05], pool);
    expect(neighbours[0]!.merchant).toBe("A");
    expect(candidates[0]!.categoryId).toBe("coffee");
    expect(candidates[0]!.score).toBeGreaterThan(0.99);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("proposing a column mapping", () => {
  const headers = ["Posted", "Payee", "Memo", "Withdrawal", "Deposit"];
  const rows = [
    ["08/01/2026", "DIVIDEND", "Share dividend", "", "1.84"],
    ["08/02/2026", "VENMO PAYMENT", "1022334455", "24", ""],
  ];
  const asking = (output: unknown) => {
    let prompt = "";
    const fetch = async (_input: string, init?: RequestInit): Promise<Response> => {
      prompt = JSON.parse(String(init?.body)).prompt;
      return new Response(JSON.stringify({ output }));
    };
    return {
      client: new SorterClient("https://mini.ts.net/sort", { fetch }),
      prompt: () => prompt,
    };
  };

  it("reads the model's answer into a mapping to confirm", async () => {
    const { client, prompt } = asking({
      date: 0,
      description: 1,
      amountStyle: "split",
      debit: 3,
      credit: 4,
      bankCategory: null,
      accountKind: "checking",
    });
    expect(await proposeMapping(client, headers, rows)).toEqual({
      date: 0,
      description: 1,
      amount: { debit: 3, credit: 4 },
      accountKind: "checking",
    });
    expect(prompt()).toContain("3: Withdrawal");
    expect(prompt()).toContain("08/02/2026 | VENMO PAYMENT");
  });

  it("turns down answers that point at columns that aren't there", async () => {
    const { client } = asking({
      date: 0,
      description: 9,
      amountStyle: "one",
      amount: 3,
      accountKind: "credit",
    });
    expect(await proposeMapping(client, headers, rows)).toBeNull();
  });
});
