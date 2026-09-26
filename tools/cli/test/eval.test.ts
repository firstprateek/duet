import { addByHand, SorterClient, Store, setupHousehold } from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";
import { describe, expect, it } from "vitest";
import { describeReport, evaluate } from "../src/eval.ts";

function letters(text: string): number[] {
  const v = new Array(26).fill(0);
  for (const ch of text.toLowerCase()) {
    const i = ch.charCodeAt(0) - 97;
    if (i >= 0 && i < 26) v[i] += 1;
  }
  return v;
}

function fakeSorter() {
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname.replace(/^\/sort/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (path === "/v1/health") {
      return json({
        ok: true,
        ollama: true,
        embed: { model: "letters", ready: true },
        llm: { model: "tiny", ready: true },
        laya: { ready: false },
      });
    }
    if (path === "/v1/embed") return json({ model: "letters", vectors: body.texts.map(letters) });
    if (path === "/v1/generate") {
      const categoryId = /VET/.test(body.prompt) ? "pets" : "uncategorized";
      return json({ output: { categoryId, confidence: 0.9 } });
    }
    return new Response("{}", { status: 404 });
  };
  return new SorterClient("https://mini.ts.net/sort", { fetch });
}

async function history() {
  const store = await Store.open(new NodeSqliteDriver(), { deviceId: "d-jack" });
  const { members } = await setupHousehold(store, {
    names: ["Jack", "Jill"],
    me: 0,
    firstBp: 5000,
    fromMonth: "2026-01",
  });
  const rows: Array<[string, string]> = [
    ["BLUE BOTTLE COFFEE OAKLAND", "coffee"],
    ["UNKNOWN BISTRO 12", "dining-out"],
    ["BLUE BOTTLE COFFEE SF", "coffee"],
    ["EAST BAY VET CLINIC", "pets"],
    ["BLUE BOTTLE COFFEE BERKELEY", "coffee"],
    ["UNKNOWN BISTRO 99", "dining-out"],
    ["NORTH BAY VET", "pets"],
  ];
  let day = 1;
  for (const [merchant, categoryId] of rows) {
    await addByHand(store, {
      amount: 1500,
      merchant,
      date: `2026-08-${String(day++).padStart(2, "0")}`,
      categoryId,
      share: "ours",
      accountId: null,
      paidBy: members[0]!.id,
    });
  }
  return store;
}

describe("duet eval", () => {
  it("replays rows oldest first, each suggested from what came before", async () => {
    const report = await evaluate(await history());
    expect(report.rows).toBe(7);
    expect(report.embeddings).toBeNull();
    // Blue Bottle is known from the pack; the bistro and the vets have to be learned.
    expect(report.right.local).toBeGreaterThanOrEqual(3);
    expect(report.right.local).toBeLessThan(7);
  });

  it("adds the Mac mini's steps, and says how each did", async () => {
    const report = await evaluate(await history(), { sorter: fakeSorter() });
    expect(report.embeddings).not.toBeNull();
    expect(report.model?.answered).toBeGreaterThan(0);
    expect(report.right.model).toBeGreaterThanOrEqual(report.right.local);
    const text = describeReport(report);
    expect(text).toContain("Right without a correction:");
    expect(text).toContain("small LLM");
  });
});
