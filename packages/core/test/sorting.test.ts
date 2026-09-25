import { describe, expect, it } from "vitest";
import { mapBankCategory } from "../src/bankCategories.ts";
import { STARTER_CATEGORIES } from "../src/categories.ts";
import {
  type DetectRow,
  findDuplicates,
  findTransfers,
  isPartnerTransfer,
  matchRefund,
  similarity,
} from "../src/detect.ts";
import {
  type MonthTotals,
  monthHeadline,
  monthInsights,
  trendNotes,
  typicalMonth,
} from "../src/insights.ts";
import { cleanMerchant, findKnownMerchant, merchantKey } from "../src/merchants.ts";
import { parseQuickAdd } from "../src/quickadd.ts";
import { findRule, type Rule } from "../src/rules.ts";
import { buildHistory, levelOf, suggest } from "../src/suggest.ts";

const categories = STARTER_CATEGORIES;
const name = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

describe("merchants", () => {
  it.each([
    ["TRADER JOE S #552 OAKLAND CA", "Trader Joe's"],
    ["SQ *BLUE BOTTLE COFFE 0423", "Blue Bottle Coffee"],
    ["ALASKA AIR 0272174 SEATTLE WA", "Alaska Airlines"],
    ["AMZN Mktp US*2K4L81JQ3 Amzn.com/bill WA", "Amazon"],
    ["UBER   *EATS PENDING", "Uber Eats"],
    ["UBER   *TRIP", "Uber"],
    ["PGANDE WEB ONLINE", "PG&E"],
    ["TST* FLOUR + WATER 1234 SAN FRANCISCO CA", "Flour + Water"],
    ["CHECKCARD 0802 CORNER DELI #12 OAKLAND CA", "Corner Deli"],
  ])("cleans %j", (raw, clean) => {
    expect(cleanMerchant(raw)).toBe(clean);
  });

  it("matches short names only as words", () => {
    expect(findKnownMerchant("CAPITAL ONE MOBILE PYMT")).toBeUndefined();
    expect(findKnownMerchant("MOBIL 0442 OAKLAND")?.name).toBe("Mobil");
    expect(findKnownMerchant("CVS/PHARMACY #09876")?.name).toBe("CVS");
    expect(findKnownMerchant("COMEDY CELLAR")).toBeUndefined();
  });

  it("gives the same key to the same merchant", () => {
    expect(merchantKey("AMZN Mktp US REFUND")).toBe(merchantKey("AMZN Mktp US*2K4L81JQ3"));
  });
});

describe("bank categories", () => {
  it.each([
    ["Merchandise & Supplies-Groceries", "groceries"],
    ["Food & Drink", "dining-out"],
    ["Restaurant-Restaurant", "dining-out"],
    ["Gas/Automotive", "gas"],
    ["Travel-Airline", "flights"],
    ["Travel-Lodging", "stays"],
    ["Supermarkets", "groceries"],
    ["Bills & Utilities", "utilities"],
    ["Merchandise", "household-goods"],
  ])("maps %j", (label, id) => {
    expect(mapBankCategory(label)).toBe(id);
  });
});

describe("rules", () => {
  const rules: Rule[] = [
    {
      id: "r1",
      match: "contains",
      pattern: "TRADER JOE",
      categoryId: "groceries",
      share: "ours",
      scope: "household",
    },
    {
      id: "r2",
      match: "contains",
      pattern: "AMAZON",
      categoryId: "household-goods",
      share: null,
      scope: "household",
    },
    {
      id: "r3",
      match: "contains",
      pattern: "AMAZON",
      categoryId: "electronics",
      share: "mine",
      scope: "personal",
    },
    {
      id: "r4",
      match: "exact",
      pattern: "PGANDE WEB ONLINE",
      categoryId: "utilities",
      share: "ours",
      scope: "household",
    },
  ];

  it("personal rules win, then exact, then longest", () => {
    expect(findRule(rules, "AMAZON.COM*123", "Amazon")?.id).toBe("r3");
    expect(findRule(rules, "PGANDE WEB ONLINE", "PG&E")?.id).toBe("r4");
    expect(findRule(rules, "TRADER JOE S #552", "Trader Joe's")?.id).toBe("r1");
    expect(findRule(rules, "SAFEWAY", "Safeway")).toBeNull();
  });
});

describe("suggest", () => {
  const history = buildHistory([
    ...Array.from({ length: 12 }, () => ({
      description: "SQ *BLUE BOTTLE COFFE 0423",
      categoryId: "coffee",
      share: "mine" as const,
    })),
    ...Array.from({ length: 4 }, () => ({
      description: "AMZN Mktp US*1",
      categoryId: "household-goods",
      share: "ours" as const,
    })),
    ...Array.from({ length: 3 }, () => ({
      description: "AMZN Mktp US*2",
      categoryId: "electronics",
      share: "ours" as const,
    })),
  ]);
  const ctx = {
    rules: [
      {
        id: "r1",
        match: "contains",
        pattern: "TRADER JOE",
        categoryId: "groceries",
        share: "ours",
        scope: "household",
      },
    ] as Rule[],
    history,
    categories,
  };

  it("uses our rule first", () => {
    const s = suggest(
      {
        description: "TRADER JOE S #552 OAKLAND CA",
        merchant: "Trader Joe's",
        accountDefault: "mine",
      },
      ctx,
    );
    expect(s).toMatchObject({
      categoryId: "groceries",
      tier: "rule",
      confidence: 1,
      share: "ours",
    });
    expect(s.why).toBe("Your rule says Trader Joe's is always Groceries, for both of you.");
  });

  it("learns from history, Ours or Mine included", () => {
    const s = suggest(
      {
        description: "SQ *BLUE BOTTLE COFFE 0423",
        merchant: "Blue Bottle Coffee",
        accountDefault: "ours",
      },
      ctx,
    );
    expect(s.categoryId).toBe("coffee");
    expect(s.share).toBe("mine");
    expect(levelOf(s.confidence)).toBe("sure");
    expect(s.why).toBe(
      "The last 12 Blue Bottle Coffee visits were Coffee, and all of them were just for you.",
    );
  });

  it("says when it isn't sure", () => {
    const s = suggest(
      { description: "AMZN Mktp US*9", merchant: "Amazon", accountDefault: "ours" },
      ctx,
    );
    expect(levelOf(s.confidence)).toBe("unsure");
    expect(s.alternatives.map((a) => a.categoryId)).toEqual(["household-goods", "electronics"]);
    expect(s.why).toBe(
      "Not sure about this one. Past Amazon purchases were Household goods four times and Electronics three times.",
    );
  });

  it("falls back to the starter pack and the bank's category", () => {
    const pack = suggest(
      {
        description: "ALASKA AIR 0272174 SEATTLE WA",
        merchant: "Alaska Airlines",
        bankCategory: "Travel-Airline",
        accountDefault: "ours",
      },
      ctx,
    );
    expect(pack).toMatchObject({ categoryId: "flights", tier: "pack" });
    const bank = suggest(
      {
        description: "CORNER DELI",
        merchant: "Corner Deli",
        bankCategory: "Food & Drink",
        accountDefault: "ours",
      },
      ctx,
    );
    expect(bank).toMatchObject({ categoryId: "dining-out", tier: "bank", confidence: 0.7 });
    const none = suggest({ description: "XYZ 123", merchant: "Xyz", accountDefault: "mine" }, ctx);
    expect(none).toMatchObject({ categoryId: null, tier: "none", share: "mine" });
  });
});

describe("detect", () => {
  const row = (over: Partial<DetectRow>): DetectRow => ({
    id: "x",
    accountId: "amex",
    accountKind: "credit",
    ownerId: "jack",
    fileId: "f2",
    date: "2026-08-01",
    amount: 6410,
    description: "TRADER JOE S #552 OAKLAND CA",
    kind: "purchase",
    ...over,
  });

  it("finds exact and near duplicates from other files", () => {
    const existing = [
      row({ id: "old1", fileId: "f1" }),
      row({
        id: "old2",
        fileId: "f1",
        date: "2026-07-30",
        amount: 1150,
        description: "SQ *BLUE BOTTLE COFFE 0423",
      }),
    ];
    const rows = [
      row({ id: "new1" }),
      row({ id: "new2", date: "2026-08-01", amount: 1150, description: "SQ *BLUE BOTTLE COFFEE" }),
      row({ id: "new3", amount: 999 }),
    ];
    const found = findDuplicates(rows, existing);
    expect(found.get("new1")).toEqual({ type: "exact", of: "old1" });
    expect(found.get("new2")).toEqual({ type: "near", of: "old2" });
    expect(found.has("new3")).toBe(false);
    expect(similarity("SQ *BLUE BOTTLE COFFE", "SQ *BLUE BOTTLE COFFEE")).toBeGreaterThan(0.9);
  });

  it("matches a card payment to the bank debit", () => {
    const rows = [
      row({
        id: "card",
        kind: "payment",
        amount: -234018,
        date: "2026-08-24",
        description: "AUTOPAY PAYMENT - THANK YOU",
      }),
      row({
        id: "bank",
        accountId: "wf",
        accountKind: "checking",
        kind: "transfer",
        amount: 234018,
        date: "2026-08-24",
        description: "ONLINE TRANSFER TO AMEX",
      }),
      row({ id: "lonely", kind: "payment", amount: -5000, date: "2026-08-02" }),
    ];
    const found = findTransfers(rows);
    expect(found.get("card")).toBe("bank");
    expect(found.get("bank")).toBe("card");
    expect(found.get("lonely")).toBeNull();
  });

  it("spots money moving between the two of us", () => {
    expect(isPartnerTransfer("Zelle payment to Jill 18762345", ["Jill"])).toBe(true);
    expect(isPartnerTransfer("VENMO *JILL RIVERA", ["Jill Rivera"])).toBe(true);
    expect(isPartnerTransfer("Zelle payment to Landlord LLC", ["Jill"])).toBe(false);
    expect(isPartnerTransfer("JILL THAI RESTAURANT", ["Jill"])).toBe(false);
  });

  it("matches a refund to the purchase it reverses", () => {
    const purchases = [
      {
        id: "p1",
        date: "2026-08-09",
        amount: 2499,
        description: "AMZN Mktp US*2K4L81JQ3",
        merchant: "Amazon",
        categoryId: "household-goods",
        share: "ours" as const,
      },
      {
        id: "p2",
        date: "2026-08-15",
        amount: 5000,
        description: "AMZN Mktp US*9ZZ",
        merchant: "Amazon",
        categoryId: "electronics",
        share: "mine" as const,
      },
      {
        id: "p3",
        date: "2026-03-01",
        amount: 2499,
        description: "AMZN Mktp US*OLD",
        merchant: "Amazon",
        categoryId: "clothes",
        share: "ours" as const,
      },
    ];
    expect(
      matchRefund(
        { date: "2026-08-21", amount: -2499, description: "AMZN Mktp US REFUND" },
        purchases,
      )?.id,
    ).toBe("p1");
    expect(
      matchRefund(
        { date: "2026-08-21", amount: -1000, description: "AMZN Mktp US REFUND" },
        purchases,
      )?.id,
    ).toBe("p2");
    expect(
      matchRefund({ date: "2026-08-21", amount: -1000, description: "TARGET RETURN" }, purchases),
    ).toBeNull();
  });
});

describe("quick add", () => {
  const today = "2026-09-23";

  it("reads the example from the spec", () => {
    const r = parseQuickAdd("42.18 trader joes groceries yesterday", { today, categories });
    expect(r).toMatchObject({
      amount: 4218,
      merchant: "Trader Joe's",
      categoryId: "groceries",
      date: "2026-09-22",
      share: null,
    });
    expect(r.fromWords).toEqual({
      amount: true,
      merchant: true,
      category: true,
      date: true,
      share: false,
    });
  });

  it("reads Ours and Mine", () => {
    expect(parseQuickAdd("mine 18 sweetgreen lunch", { today, categories })).toMatchObject({
      amount: 1800,
      merchant: "Sweetgreen",
      categoryId: "dining-out",
      share: "mine",
    });
    expect(parseQuickAdd("ours 64 dinner friday", { today, categories })).toMatchObject({
      amount: 6400,
      merchant: "Dinner",
      categoryId: "dining-out",
      date: "2026-09-18",
      share: "ours",
    });
  });

  it("knows when the amount is missing", () => {
    const r = parseQuickAdd("coffee yesterday", { today, categories });
    expect(r.amount).toBeNull();
    expect(r.fromWords.amount).toBe(false);
  });

  it("reads dates like 9/5 and Sep 5", () => {
    expect(parseQuickAdd("12 parking 9/5", { today, categories }).date).toBe("2026-09-05");
    expect(parseQuickAdd("12 parking sep 5", { today, categories }).date).toBe("2026-09-05");
    expect(parseQuickAdd("12 parking dec 5", { today, categories }).date).toBe("2025-12-05");
  });
});

describe("insights", () => {
  const month = (m: string, cats: Record<string, number>): MonthTotals => {
    const byCategory = new Map(Object.entries(cats));
    return { month: m, total: [...byCategory.values()].reduce((a, b) => a + b, 0), byCategory };
  };
  const top = [
    month("2026-02", { home: 330000, food: 150000, travel: 30000, shopping: 60000 }),
    month("2026-03", { home: 330000, food: 150000, travel: 30000, shopping: 60000 }),
    month("2026-04", { home: 330000, food: 152000, travel: 34000, shopping: 61000 }),
    month("2026-05", { home: 330000, food: 152000, travel: 34000, shopping: 61000 }),
    month("2026-06", { home: 330000, food: 152000, travel: 34000, shopping: 61000 }),
    month("2026-07", { home: 330000, food: 152000, travel: 34000, shopping: 61000 }),
  ];
  const august = month("2026-08", { home: 330400, food: 145200, travel: 118000, shopping: 73100 });

  it("typical month is the median of the six before", () => {
    const t = typicalMonth(top, "2026-08");
    expect(t.byCategory.get("travel")).toBe(34000);
    expect(t.total).toBe(577000);
  });

  it("headline says how the month compares", () => {
    const h = monthHeadline(august, typicalMonth(top, "2026-08"), name);
    expect(h.label).toBe("A bit more than usual · +$897");
    expect(h.sentence).toBe("Mostly Travel.");
  });

  it("notices the difference, the lightest month and overlapping subscriptions", () => {
    const detailHistory = top.map((t, i) =>
      month(t.month, {
        "dining-out": [70000, 65000, 68000, 66000, 67200, 69000][i]!,
        groceries: 85000,
      }),
    );
    const insights = monthInsights({
      month: "2026-08",
      top: august,
      detail: month("2026-08", { "dining-out": 48600, groceries: 90000 }),
      topHistory: top,
      detailHistory,
      subscriptions: [
        { name: "Spotify", tag: "music", amount: 1199 },
        { name: "Apple Music", tag: "music", amount: 1099 },
      ],
      names: name,
      icons: () => "sparkle",
    });
    expect(insights.map((i) => i.text)).toEqual([
      "Travel was most of the difference. It came to $1,180, about $840 over usual.",
      "Dining out was the lightest in six months: $486, about $190 under usual.",
      "Two music services, Spotify and Apple Music: $22.98 a month together.",
    ]);
  });

  it("trend notes are gentle", () => {
    const history = [
      month("2026-03", { groceries: 80000, subscriptions: 5800 }),
      month("2026-04", { groceries: 80000, subscriptions: 6000 }),
      month("2026-05", { groceries: 80000, subscriptions: 6400 }),
      month("2026-06", { groceries: 90000, subscriptions: 7000 }),
      month("2026-07", { groceries: 91000, subscriptions: 7800 }),
      month("2026-08", { groceries: 92000, subscriptions: 8600 }),
    ];
    expect(trendNotes(history, name).map((n) => n.text)).toEqual([
      "Groceries have been above $850 three months running.",
      "Subscriptions are $86 a month now, up from $58 in March.",
    ]);
  });
});
