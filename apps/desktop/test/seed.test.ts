import {
  countToSort,
  ebbFlowView,
  getFiles,
  monthView,
  previewAdd,
  Store,
  signedLabel,
  trendsView,
} from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";
import { beforeAll, describe, expect, it } from "vitest";
import { seedSampleHousehold } from "../src/demo/seed.ts";

// The sample household is what the designs show; these keep the two in step.
describe("sample household", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.open(new NodeSqliteDriver());
    await seedSampleHousehold(store);
  });

  it("August is the This month design", async () => {
    const v = await monthView(store, "2026-08");
    const [jack, jill] = [v.pair.first, v.pair.second];
    expect(v.total).toBe(784200);
    expect(v.ours).toBe(631800);
    expect(v.mineByMember[jack]).toBe(81200);
    expect(v.mineByMember[jill]).toBe(71200);
    expect(v.byTop.map((t) => [t.category.id, t.amount])).toEqual([
      ["home", 330400],
      ["food", 145200],
      ["travel", 118000],
      ["shopping", 73100],
      ["getting-around", 41400],
      ["fun", 22800],
      ["gifts", 21000],
      ["health", 16600],
      ["personal-care", 15700],
    ]);
    expect(v.headline.label).toBe("A bit more than usual · +$862");
    expect(v.headline.sentence).toBe("Mostly Travel. Every other category was close to usual.");
    expect(v.insights.map((i) => i.text)).toEqual([
      "Travel was most of the difference. It came to $1,180, about $840 over usual.",
      "Dining out was the lightest since March: $486, about $190 under usual.",
      "Two music services, Spotify and Apple Music: $22.98 a month together.",
    ]);
    expect(v.lastSix.map((m) => m.total / 100)).toEqual([6940, 7310, 6880, 7450, 7020, 7842]);
    expect(v.typicalTotal).toBe(698000);
    expect(v.ebb.monthSentence).toBe("In August, Jill carried $262 extra.");
    expect(v.ebb.overallSentence).toBe("Jill's been carrying a little extra: $418 overall.");
    expect(v.addedAfterSlate).toBeNull();
  });

  it("History is the Ebb & flow design", async () => {
    const v = await ebbFlowView(store, "2026-08");
    const rows = [...v.flow.months].reverse();
    expect(rows.map((r) => signedLabel(r.raw, v.pair, v.names))).toEqual([
      "Jill +$262",
      "Jill +$500",
      "Jill +$36",
      "Jill +$85",
      "Jack +$140",
      "Jill +$190",
      "Jill +$60",
      "Jack +$75",
      "Jill +$380",
      "Jill +$210",
      "Jack +$90",
      "Jill +$140",
    ]);
    expect(rows.map((r) => signedLabel(r.overallAfter, v.pair, v.names))).toEqual([
      "Jill +$418",
      "Jill +$156",
      "Jill +$156",
      "Jill +$120",
      "Jill +$35",
      "Jill +$175",
      "In step",
      "Jack +$75",
      "In step",
      "Jill +$260",
      "Jill +$50",
      "Jill +$140",
    ]);
    expect(v.currentFirstBp).toBe(5800);
    expect(v.rhythmSince).toBe("2026-01");
  });

  it("Trends is the Trends design", async () => {
    const v = await trendsView(store, { through: "2026-08", count: 12 });
    expect(v.months.map((m) => m.total / 100)).toEqual([
      6820, 7120, 7480, 8640, 6540, 6700, 6940, 7310, 6880, 7450, 7020, 7842,
    ]);
    expect(v.typicalTotal).toBe(698000);
    expect(v.latest?.difference).toBe(86200);
    expect(v.typicalByTop.map((t) => [t.category.id, t.amount / 100])).toEqual([
      ["home", 3350],
      ["food", 1520],
      ["shopping", 610],
      ["getting-around", 430],
      ["travel", 340],
      ["fun", 260],
      ["health", 180],
      ["gifts", 150],
      ["personal-care", 140],
    ]);
    expect(v.notes.map((n) => n.text)).toEqual([
      "Groceries have been above $850 four months running. They used to be about $780.",
      "Subscriptions are $86 a month now, up from $58 a year ago.",
      "Dining out keeps getting lighter: $486 in August, the least since March.",
    ]);
  });

  it("Uploads and To sort are the Uploads and To sort designs", async () => {
    expect(await countToSort(store)).toBe(23);
    const files = await getFiles(store);
    const amex = files.find((f) => f.fileName === "amex-activity-aug.csv")!;
    expect([amex.rowCount, amex.pending]).toEqual([64, 23]);
    const add = await previewAdd(store, amex.id);
    expect([add.ours.count, add.ours.total]).toEqual([29, 242580]);
    expect([add.mine.count, add.mine.total]).toEqual([9, 31245]);
    expect(add.aside.count).toBe(3);
    expect(files.find((f) => f.fileName === "DCU_Export_0901.xlsx")?.status).toBe("needs-setup");
    const month = await monthView(store, "2026-08");
    // Citi hasn't come in yet; DCU's file is in, waiting for its one-time setup.
    expect(month.coverage).toMatchObject({ covered: 9, total: 10 });
  });
});
