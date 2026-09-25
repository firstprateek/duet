import { describe, expect, it } from "vitest";
import {
  batchImpactSentence,
  type CleanSlateEntry,
  ebbAndFlow,
  monthFigure,
  monthSentence,
  type OursEntry,
  overallSentence,
  rhythmFor,
  rhythmFromSalaries,
  signedLabel,
} from "../src/ebbflow.ts";

const pair = { first: "jack", second: "jill" };
const names = { jack: "Jack", jill: "Jill" };
const plans = [
  { fromMonth: "2025-01", firstBp: 6000 },
  { fromMonth: "2026-01", firstBp: 5800 },
];

describe("monthFigure", () => {
  it("matches August in the spec: Jill carried $262 more", () => {
    const entries: OursEntry[] = [
      { month: "2026-08", amount: 340200, paidBy: "jack" },
      { month: "2026-08", amount: 291600, paidBy: "jill" },
    ];
    const f = monthFigure("2026-08", entries, plans, [], pair);
    expect(f.total).toBe(631800);
    expect(f.firstShare).toBe(366444);
    expect(f.secondShare).toBe(265356);
    expect(f.raw).toBe(-26244);
    expect(monthSentence(f, pair, names)).toBe("In August, Jill carried $262 extra.");
  });

  it("uses the rhythm in effect for the month", () => {
    expect(rhythmFor("2024-06", plans)).toBe(6000);
    expect(rhythmFor("2025-12", plans)).toBe(6000);
    expect(rhythmFor("2026-01", plans)).toBe(5800);
    expect(rhythmFor("2026-08", [])).toBe(5000);
  });

  it("refunds come off the total", () => {
    const entries: OursEntry[] = [
      { month: "2026-08", amount: 10000, paidBy: "jack" },
      { month: "2026-08", amount: -2500, paidBy: "jack" },
    ];
    const f = monthFigure("2026-08", entries, plans, [], pair);
    expect(f.total).toBe(7500);
    expect(f.raw).toBe(7500 - 4350);
  });

  it("a Clean slate for the month brings it to zero", () => {
    const entries: OursEntry[] = [{ month: "2026-07", amount: 100000, paidBy: "jill" }];
    const slate: CleanSlateEntry = {
      from: "jack",
      to: "jill",
      amount: 58000,
      date: "2026-07-31",
      appliesTo: "2026-07",
    };
    const f = monthFigure("2026-07", entries, plans, [slate], pair);
    expect(f.raw).toBe(-58000);
    expect(f.net).toBe(0);
    expect(monthSentence(f, pair, names)).toBe("You're in step in July.");
  });

  it("rounds once per month, halves away from zero", () => {
    // 5800 bp of 101 cents is 58.58 cents → 59.
    const f = monthFigure(
      "2026-08",
      [{ month: "2026-08", amount: 101, paidBy: "jill" }],
      plans,
      [],
      pair,
    );
    expect(f.firstShare).toBe(59);
    expect(f.secondShare).toBe(42);
  });
});

describe("ebbAndFlow", () => {
  // The months on the History screen, Sep 2025 to Aug 2026, as raw figures from Jack's side.
  const raw: Array<[string, number]> = [
    ["2025-09", -14000],
    ["2025-10", 9000],
    ["2025-11", -21000],
    ["2025-12", -38000],
    ["2026-01", 7500],
    ["2026-02", -6000],
    ["2026-03", -19000],
    ["2026-04", 14000],
    ["2026-05", -8500],
    ["2026-06", -3600],
    ["2026-07", -50000],
    ["2026-08", -26200],
  ];
  // $1,000 of Ours each month; Jack pays share + raw.
  const entries: OursEntry[] = raw.flatMap(([month, figure]) => {
    const bp = rhythmFor(month, plans);
    const share = Math.round((100000 * bp) / 10000);
    const jackPaid = share + figure;
    return [
      { month, amount: jackPaid, paidBy: "jack" },
      { month, amount: 100000 - jackPaid, paidBy: "jill" },
    ];
  });
  const slates: CleanSlateEntry[] = [
    { from: "jack", to: "jill", amount: 50000, date: "2026-07-31", appliesTo: "2026-07" },
    { from: "jack", to: "jill", amount: 64000, date: "2025-12-31", appliesTo: "overall" },
  ];

  it("matches the History screen", () => {
    const flow = ebbAndFlow(entries, plans, slates, pair);
    expect(flow.months.map((m) => m.raw)).toEqual(raw.map(([, f]) => f));
    expect(flow.months.map((m) => signedLabel(m.overallAfter, pair, names))).toEqual([
      "Jill +$140",
      "Jill +$50",
      "Jill +$260",
      "In step",
      "Jack +$75",
      "In step",
      "Jill +$175",
      "Jill +$35",
      "Jill +$120",
      "Jill +$156",
      "Jill +$156",
      "Jill +$418",
    ]);
    expect(flow.overall).toBe(-41800);
    expect(overallSentence(flow.overall, pair, names)).toBe(
      "Jill's been carrying a little extra: $418 overall.",
    );
  });

  it("fills quiet months and runs through a later month", () => {
    const flow = ebbAndFlow(
      [{ month: "2026-01", amount: 1000, paidBy: "jack" }],
      plans,
      [],
      pair,
      "2026-03",
    );
    expect(flow.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(flow.months[2]?.overallAfter).toBe(420);
  });

  it("is the mirror image from the other side", () => {
    const flip = ebbAndFlow(entries, plans, slates, { first: "jill", second: "jack" });
    // Jill's side uses Jill's share, so rebuild the plans for the check.
    const flipped = ebbAndFlow(
      entries,
      plans.map((p) => ({ ...p, firstBp: 10000 - p.firstBp })),
      slates,
      { first: "jill", second: "jack" },
    );
    expect(flipped.overall).toBe(41800);
    expect(flip.months).toHaveLength(12);
  });

  it("an overall Clean slate of the running amount brings it to zero", () => {
    const before = ebbAndFlow(entries, plans, slates, pair).overall;
    const after = ebbAndFlow(
      entries,
      plans,
      [
        ...slates,
        { from: "jack", to: "jill", amount: -before, date: "2026-09-02", appliesTo: "overall" },
      ],
      pair,
    ).overall;
    expect(after).toBe(0);
  });
});

describe("sentences", () => {
  it("describes a batch paid by one person", () => {
    const entries: OursEntry[] = [{ month: "2026-08", amount: 242580, paidBy: "jack" }];
    expect(batchImpactSentence(entries, 5800, pair, names)).toBe(
      "Jack paid for all $2,425.80 of these. At 58 / 42, Jack's share is $1,406.96, so Jack covered $1,018.84 more.",
    );
  });

  it("works out Our rhythm from salaries", () => {
    expect(rhythmFromSalaries(145000, 105000)).toBe(5800);
    expect(() => rhythmFromSalaries(0, 1)).toThrow();
  });
});
