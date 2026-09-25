import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectFormat, readStatement } from "../src/index.ts";
import { parseCents, parseDate } from "../src/values.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "../fixtures", name)));
const read = (name: string) => readStatement(fixture(name), name);
const kinds = (name: string) => read(name).rows.map((r) => [r.amount, r.kind]);

describe("parseCents", () => {
  it.each([
    ["86.42", 8642],
    ["$1,234.56", 123456],
    ["(12.34)", -1234],
    ["-5", -500],
    ["12.34-", -1234],
    ["−$2,340.18", -234018],
    ["45.00 CR", -4500],
    ["+3", 300],
    [".5", 50],
    ["1.005", 101],
    [42.18, 4218],
    [-24.99, -2499],
  ])("reads %j", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([[""], ["abc"], ["1.2.3"], [Number.NaN], [null]])("rejects %j", (input) => {
    expect(parseCents(input as string)).toBeNull();
  });
});

describe("parseDate", () => {
  it.each([
    ["08/28/2026", "2026-08-28"],
    ["8/1/26", "2026-08-01"],
    ["2026-08-28", "2026-08-28"],
    ["20260819120000[0:GMT]", "2026-08-19"],
    ["Aug 28, 2026", "2026-08-28"],
    ["28 Aug 2026", "2026-08-28"],
    [46262, "2026-08-28"],
  ])("reads %j", (input, iso) => {
    expect(parseDate(input)).toBe(iso);
  });

  it("rejects days that don't exist", () => {
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("13/01/2026")).toBeNull();
  });
});

describe("bank profiles", () => {
  it("American Express: charges positive, card number from Account #", () => {
    const s = read("amex-activity.csv");
    expect(s.profileId).toBe("amex-csv");
    expect(s.institution).toBe("American Express");
    expect(s.accountLast4).toBe("1008");
    expect(s.rows).toHaveLength(6);
    expect(s.rows[0]).toMatchObject({
      date: "2026-08-28",
      amount: 8642,
      kind: "purchase",
      bankCategory: "Merchandise & Supplies-Groceries",
      person: "JACK MORGAN",
    });
    expect(kinds("amex-activity.csv")).toContainEqual([-234018, "payment"]);
    expect(kinds("amex-activity.csv")).toContainEqual([-2499, "refund"]);
    expect(s.firstDate).toBe("2026-08-09");
    expect(s.lastDate).toBe("2026-08-28");
  });

  it("Capital One: separate Debit and Credit columns", () => {
    const s = read("capital-one.csv");
    expect(s.profileId).toBe("capital-one-csv");
    expect(s.accountLast4).toBe("4417");
    expect(kinds("capital-one.csv")).toEqual([
      [14320, "purchase"],
      [1875, "purchase"],
      [-50000, "payment"],
      [5210, "purchase"],
    ]);
  });

  it("Discover: payments and rewards from the category column", () => {
    expect(read("discover.csv").profileId).toBe("discover-csv");
    expect(kinds("discover.csv")).toEqual([
      [6418, "purchase"],
      [-25000, "payment"],
      [-1234, "deposit"],
      [1549, "purchase"],
    ]);
  });

  it("Chase card: charges negative, Type marks payments and returns", () => {
    expect(read("chase-card.csv").profileId).toBe("chase-card-csv");
    expect(kinds("chase-card.csv")).toEqual([
      [14210, "purchase"],
      [-120000, "payment"],
      [2380, "purchase"],
      [-620, "refund"],
    ]);
  });

  it("Chase checking: card payments, transfers and deposits", () => {
    const s = read("chase-checking.csv");
    expect(s.profileId).toBe("chase-checking-csv");
    expect(s.accountKind).toBe("checking");
    expect(kinds("chase-checking.csv")).toEqual([
      [234018, "payment"],
      [50000, "purchase"],
      [-420000, "deposit"],
      [30000, "transfer"],
    ]);
  });

  it("Apple Card: clean merchant and who bought it", () => {
    const s = read("apple-card.csv");
    expect(s.profileId).toBe("apple-card-csv");
    expect(s.rows[0]).toMatchObject({ merchant: "Starbucks", person: "Jill Rivera", amount: 645 });
    expect(kinds("apple-card.csv")).toEqual([
      [645, "purchase"],
      [-30000, "payment"],
      [1099, "purchase"],
      [-120, "deposit"],
    ]);
  });

  it("Citi: skips pending rows", () => {
    const s = read("citi.csv");
    expect(s.profileId).toBe("citi-csv");
    expect(s.skipped).toBe(1);
    expect(kinds("citi.csv")).toEqual([
      [21466, "purchase"],
      [-80000, "payment"],
      [1199, "purchase"],
    ]);
  });

  it("Wells Fargo: no header row", () => {
    const s = read("wells-fargo.csv");
    expect(s.profileId).toBe("wells-fargo-csv");
    expect(kinds("wells-fargo.csv")).toEqual([
      [234018, "transfer"],
      [8630, "purchase"],
      [-390000, "deposit"],
    ]);
  });

  it("Bank of America checking: skips the summary block", () => {
    const s = read("bofa-checking.csv");
    expect(s.profileId).toBe("bofa-checking-csv");
    expect(s.skipped).toBe(1);
    expect(kinds("bofa-checking.csv")).toEqual([
      [2345, "purchase"],
      [25000, "payment"],
      [-420000, "deposit"],
    ]);
  });

  it("Bank of America card", () => {
    expect(read("bofa-card.csv").profileId).toBe("bofa-card-csv");
    expect(kinds("bofa-card.csv")).toEqual([
      [1435, "purchase"],
      [-10000, "payment"],
    ]);
  });
});

describe("OFX and QFX", () => {
  it("reads SGML QFX from a card", () => {
    const s = read("chase-card.qfx");
    expect(detectFormat(fixture("chase-card.qfx"), "chase-card.qfx")).toBe("ofx");
    expect(s.institution).toBe("Chase");
    expect(s.accountKind).toBe("credit");
    expect(s.accountLast4).toBe("9876");
    expect(s.rows.map((r) => [r.date, r.amount, r.kind])).toEqual([
      ["2026-08-19", 14210, "purchase"],
      ["2026-08-14", -120000, "payment"],
      ["2026-08-12", 2380, "purchase"],
    ]);
    expect(s.rows[2]?.description).toBe("UBER *TRIP HELP.UBER.COM");
    expect(s.rows[0]?.bankId).toBe("2026081924692166229100012345678");
  });

  it("reads XML OFX from checking", () => {
    const s = read("dcu-checking.ofx");
    expect(s.institution).toBe("DCU");
    expect(s.accountKind).toBe("checking");
    expect(s.accountLast4).toBe("6789");
    expect(s.rows.map((r) => [r.description, r.amount, r.kind])).toEqual([
      ["STOP & SHOP 0612 POS PURCHASE", 5820, "purchase"],
      ["DIRECT DEPOSIT ACME", -210000, "deposit"],
      ["MONTHLY SERVICE FEE", 4500, "fee"],
    ]);
  });
});

describe("XLSX", () => {
  it("reads an Amex spreadsheet with a title block above the headers", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Transaction Details", null, null, null, null],
      ["Blue Cash Preferred / Aug 2026", null, null, null, null],
      [],
      ["Date", "Description", "Card Member", "Account #", "Amount"],
      [new Date(2026, 7, 28), "TRADER JOE S #552 OAKLAND CA", "JACK MORGAN", "-41008", 86.42],
      [new Date(2026, 7, 24), "AUTOPAY PAYMENT - THANK YOU", "JACK MORGAN", "-41008", -2340.18],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Activity");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const s = readStatement(bytes, "activity.xlsx");
    expect(s.format).toBe("xlsx");
    expect(s.profileId).toBe("amex-csv");
    expect(s.rows.map((r) => [r.date, r.amount, r.kind])).toEqual([
      ["2026-08-28", 8642, "purchase"],
      ["2026-08-24", -234018, "payment"],
    ]);
  });
});

describe("unknown layouts", () => {
  const unknown = new TextEncoder().encode(
    "When,What,How much,Kind\n08/03/2026,FARMERS MARKET,36.00,Food\n08/04/2026,BOOKSHOP,-12.50,Books\n",
  );

  it("asks for a one-time column match", () => {
    const s = readStatement(unknown, "bread.csv");
    expect(s.profileId).toBeNull();
    expect(s.rows).toHaveLength(0);
    expect(s.headers).toEqual(["When", "What", "How much", "Kind"]);
    expect(s.sample[0]).toEqual(["08/03/2026", "FARMERS MARKET", "36.00", "Food"]);
  });

  it("reads the file once the columns are matched", () => {
    const s = readStatement(unknown, "bread.csv", {
      mapping: {
        headerRow: 0,
        date: 0,
        description: 1,
        amount: { column: 2, spendingIs: "positive" },
        bankCategory: 3,
        accountKind: "credit",
      },
    });
    expect(s.rows.map((r) => [r.amount, r.kind, r.bankCategory])).toEqual([
      [3600, "purchase", "Food"],
      [-1250, "refund", "Books"],
    ]);
  });
});
