import {
  addMonths,
  addRule,
  addToMonth,
  beginImport,
  type Cents,
  type Change,
  cleanMerchant,
  type Decision,
  type Draft,
  decide,
  fileSha256,
  getAccounts,
  getDrafts,
  lastDayOf,
  type MonthKey,
  mineTotalChanges,
  rememberForSetup,
  type Share,
  type Store,
  setDraftCategory,
  setDraftNote,
  setupHousehold,
  shareOf,
  uuidv7,
} from "@duet/core";
import { readStatement, writeXlsx } from "@duet/importers";
import { sampleFiles } from "./files.ts";

/**
 * A year of a made-up household, Jack and Jill, for the browser preview and screenshots.
 * The numbers are the ones in the designs: August comes to $7,842 with $6,318 of it Ours,
 * Jill carried $262 extra in August and $418 overall, and a typical month is $6,980.
 *
 * Jack is on this Mac. Jack's statements for August were uploaded as real files (Chase and
 * Wells Fargo added, Amex part-sorted, DCU waiting for its one-time setup); everything
 * earlier, and all of Jill's, is written as it would arrive. Jill's Mine is only totals.
 */

type Who = "jack" | "jill";
type AccountKey =
  | "amex"
  | "chase"
  | "wf"
  | "dcu"
  | "citi"
  | "jackCash"
  | "apple"
  | "capone"
  | "discover"
  | "bread"
  | "bofa";

const MONTHS: MonthKey[] = [
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
];
const AUGUST = "2026-08";

/** Ebb & flow each month from Jack's side, before Clean slates (the History screen). */
const RAW: Record<MonthKey, Cents> = {
  "2025-09": -14000,
  "2025-10": 9000,
  "2025-11": -21000,
  "2025-12": -38000,
  "2026-01": 7500,
  "2026-02": -6000,
  "2026-03": -19000,
  "2026-04": 14000,
  "2026-05": -8500,
  "2026-06": -3600,
  "2026-07": -50000,
  "2026-08": -26244,
};

/**
 * Everything spent each month by top-level category, in dollars: home, food, shopping,
 * getting around, travel, fun, health, gifts & giving, personal care. The six months
 * before August have the design's typical month as their middle.
 */
const TOP: number[][] = [
  [3330, 1557, 640, 440, 183, 245, 170, 120, 135],
  [3345, 1615, 590, 425, 440, 270, 190, 95, 150],
  [3390, 1581, 820, 460, 489, 255, 165, 180, 140],
  [3450, 1728, 760, 470, 1002, 300, 150, 620, 160],
  [3440, 1485, 480, 410, 40, 240, 260, 60, 125],
  [3390, 1520, 615, 402, 95, 258, 209, 90, 121],
  [3420, 1409, 514, 423, 419, 259, 205, 149, 142],
  [3310, 1520, 613, 437, 620, 287, 182, 188, 153],
  [3243, 1656, 573, 466, 182, 264, 178, 151, 167],
  [3236, 1623, 679, 422, 837, 229, 161, 147, 116],
  [3424, 1508, 607, 466, 261, 261, 150, 205, 138],
  [3304, 1452, 731, 414, 1180, 228, 166, 210, 157],
];
// Groceries stepped up in May; dining out has been getting lighter since spring.
const GROCERIES = [772, 788, 815, 826, 760, 765, 840, 770, 866, 881, 872, 893];
const DINING = [705, 742, 688, 812, 655, 700, 470, 690, 720, 662, 560, 486];
const UTILITIES = [150, 165, 210, 262, 275, 248, 212, 190, 170, 163, 171, 175];
const RENT = 275000;
const PHONES = { ours: 8000, jack: 4500, jill: 5500 };
const INSURANCE = [2500, 11800];

/** August's Mine, from the design: Jack $812, Jill $712. */
const AUGUST_MINE = { jack: 81200, jill: 71200 };

const cents = (dollars: number): Cents => Math.round(dollars * 100);

function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Part {
  sub: string;
  ours: Cents;
  jack: Cents;
  jill: Cents;
}

interface Subscription {
  d: string;
  amount: Cents;
  who: Who;
  acct: AccountKey;
  day: number;
  share: Share;
}

function subscriptions(month: MonthKey): Subscription[] {
  const list: Subscription[] = [
    {
      d: "NETFLIX.COM LOS GATOS CA",
      amount: month >= "2026-01" ? 1799 : 1549,
      who: "jack",
      acct: "amex",
      day: 1,
      share: "ours",
    },
    { d: "SPOTIFY USA", amount: 1199, who: "jack", acct: "amex", day: 14, share: "ours" },
    {
      d: "HULU 877-8244858 CA",
      amount: month >= "2026-06" ? 1799 : 1099,
      who: "jill",
      acct: "discover",
      day: 9,
      share: "ours",
    },
    { d: "NYTIMES*NYTDIGITAL", amount: 1700, who: "jack", acct: "chase", day: 20, share: "ours" },
    {
      d: "APPLE.COM/BILL ICLOUD",
      amount: month >= "2026-02" ? 999 : 299,
      who: "jill",
      acct: "apple",
      day: 27,
      share: "ours",
    },
  ];
  if (month >= "2026-03") {
    list.push({
      d: "APPLE MUSIC 866-712-7753",
      amount: 1099,
      who: "jack",
      acct: "chase",
      day: 16,
      share: "mine",
    });
  }
  return list;
}

/** A month by subcategory, and who each part was for. */
function monthParts(index: number): Part[] {
  const month = MONTHS[index]!;
  const [home, food, shopping, around, travel, fun, health, gifts, care] = TOP[index]!.map(
    cents,
  ) as [Cents, Cents, Cents, Cents, Cents, Cents, Cents, Cents, Cents];
  const r = Math.round;
  const parts: Part[] = [];
  const add = (sub: string, ours: Cents, jack = 0, jill = 0) => parts.push({ sub, ours, jack, jill });

  const utilities = cents(UTILITIES[index]!);
  const insurance = INSURANCE[0]! + INSURANCE[1]!;
  const phones = PHONES.ours + PHONES.jack + PHONES.jill;
  add("rent", RENT);
  add("utilities", utilities);
  add("internet-phone", PHONES.ours, PHONES.jack, PHONES.jill);
  add("insurance", insurance);
  add("home-upkeep", home - RENT - utilities - phones - insurance);

  const groceries = cents(GROCERIES[index]!);
  const dining = cents(DINING[index]!);
  const lunches = r(dining * 0.15);
  add("groceries", groceries);
  add("dining-out", dining - 2 * lunches, lunches, lunches);
  const coffee = food - groceries - dining;
  const coffeeJack = r(coffee * 0.55);
  add("coffee", 0, coffeeJack, coffee - coffeeJack);

  const clothes = r(shopping * 0.38);
  const electronics = r(shopping * 0.12);
  const clothesJack = r(clothes * 0.45);
  add("household-goods", shopping - clothes - electronics);
  add("clothes", 0, clothesJack, clothes - clothesJack);
  add("electronics", 0, electronics);

  const gas = r(around * 0.42);
  const transit = r(around * 0.12);
  const rides = r(around * 0.14);
  const parking = r(around * 0.12);
  const ridesMine = r(rides * 0.25);
  add("gas", gas);
  add("transit", 0, transit);
  add("rideshare", rides - 2 * ridesMine, ridesMine, ridesMine);
  add("parking", parking);
  add("car", around - gas - transit - rides - parking);

  if (travel < 15000) {
    add("travel-other", travel);
  } else {
    const flights = r(travel * 0.48);
    const stays = r(travel * 0.42);
    add("flights", flights);
    add("stays", stays);
    add("travel-other", travel - flights - stays);
  }

  const subs = subscriptions(month);
  const subsOurs = subs.filter((s) => s.share === "ours").reduce((t, s) => t + s.amount, 0);
  const subsJack = subs.filter((s) => s.share === "mine").reduce((t, s) => t + s.amount, 0);
  add("subscriptions", subsOurs, subsJack);
  const funRest = fun - subsOurs - subsJack;
  const hobbies = r(funRest * 0.4);
  const hobbiesJack = r(hobbies / 2);
  add("entertainment", funRest - hobbies);
  add("hobbies", 0, hobbiesJack, hobbies - hobbiesJack);

  add("fitness", 0, 2500, 4900);
  const healthRest = health - 7400;
  const pharmacy = r(healthRest * 0.4);
  const doctorJack = r((healthRest - pharmacy) * 0.4);
  add("pharmacy", pharmacy);
  add("doctor", 0, doctorJack, healthRest - pharmacy - doctorJack);

  const giving = r(gifts * 0.15);
  add("gifts-given", gifts - giving);
  add("giving", giving);

  const hairJack = r(care * 0.35);
  add("hair-beauty", 0, hairJack, care - hairJack);

  if (month === AUGUST) {
    // Nudge a little Ours into Mine so August's Mine matches the design.
    const move = (who: Who, amount: Cents, from: string[]) => {
      let left = amount;
      for (const sub of from) {
        const p = parts.find((x) => x.sub === sub);
        if (!p || left <= 0) continue;
        const take = Math.min(p.ours, left);
        p.ours -= take;
        p[who] += take;
        left -= take;
      }
      if (left !== 0) throw new Error("The sample August doesn't add up.");
    };
    move("jack", AUGUST_MINE.jack - parts.reduce((t, p) => t + p.jack, 0), [
      "household-goods",
      "entertainment",
    ]);
    move("jill", AUGUST_MINE.jill - parts.reduce((t, p) => t + p.jill, 0), [
      "dining-out",
      "gifts-given",
    ]);
  }
  return parts.filter((p) => p.ours + p.jack + p.jill !== 0);
}

interface Template {
  d: string;
  who?: Who;
  acct: AccountKey;
  day?: number;
}

/** Where each kind of spending usually happens, and who usually pays. */
const PLACES: Record<
  string,
  { n: number; ours?: Template[]; jack?: Template[]; jackN?: number; jillN?: number }
> = {
  utilities: {
    n: 2,
    ours: [
      { d: "PGANDE WEB ONLINE", who: "jill", acct: "bofa", day: 19 },
      { d: "EBMUD WATER BILL", who: "jack", acct: "wf", day: 11 },
    ],
  },
  "internet-phone": {
    n: 1,
    ours: [{ d: "COMCAST CABLE COMM 800-COMCAST", who: "jack", acct: "wf", day: 12 }],
    jack: [{ d: "GOOGLE *FI 3JK2LQ", acct: "dcu", day: 22 }],
    jackN: 1,
    jillN: 1,
  },
  "home-upkeep": {
    n: 2,
    ours: [
      { d: "THE HOME DEPOT #0641", who: "jack", acct: "citi" },
      { d: "ACE HARDWARE 14552", who: "jill", acct: "bread" },
    ],
  },
  groceries: {
    n: 7,
    ours: [
      { d: "TRADER JOE S #552 OAKLAND CA", who: "jack", acct: "amex" },
      { d: "BERKELEY BOWL WEST", who: "jill", acct: "apple" },
      { d: "SAFEWAY #1711 OAKLAND CA", who: "jack", acct: "amex" },
      { d: "COSTCO WHSE #0144 RICHMOND CA", who: "jack", acct: "citi" },
      { d: "WHOLEFDS OAK 10234", who: "jill", acct: "apple" },
      { d: "TRADER JOE S #552 OAKLAND CA", who: "jill", acct: "apple" },
      { d: "SPROUTS FARMERS MKT #412", who: "jill", acct: "bread" },
    ],
  },
  "dining-out": {
    n: 4,
    ours: [
      { d: "TST* HOMESTEAD OAKLAND CA", who: "jack", acct: "chase" },
      { d: "SQ *NOODLE THEORY OAKLAND", who: "jill", acct: "apple" },
      { d: "DOORDASH*THAI HOUSE", who: "jack", acct: "amex" },
      { d: "SQ *SUNNY SIDE CAFE OAKLAND CA", who: "jill", acct: "capone" },
    ],
    jack: [
      { d: "SWEETGREEN BERKELEY CA", acct: "chase" },
      { d: "CHIPOTLE 1841", acct: "amex" },
      { d: "SQ *BURMA LOVE", acct: "chase" },
    ],
    jackN: 3,
    jillN: 4,
  },
  coffee: {
    n: 0,
    jack: [
      { d: "SQ *BLUE BOTTLE COFFE 0423", acct: "amex" },
      { d: "PHILZ COFFEE 12", acct: "chase" },
    ],
    jackN: 6,
    jillN: 6,
  },
  "household-goods": {
    n: 3,
    ours: [
      { d: "AMZN Mktp US*2K4L81JQ3", who: "jack", acct: "amex" },
      { d: "TARGET 00012345 EMERYVILLE CA", who: "jill", acct: "apple" },
      { d: "IKEA EMERYVILLE", who: "jack", acct: "citi" },
    ],
    jack: [
      { d: "AMZN Mktp US*9P1XX2WQ1", acct: "chase" },
      { d: "MUJI SAN FRANCISCO", acct: "chase" },
    ],
    jackN: 2,
  },
  clothes: {
    n: 0,
    jack: [
      { d: "UNIQLO USA LLC", acct: "citi" },
      { d: "NIKE.COM", acct: "chase" },
    ],
    jackN: 1,
    jillN: 2,
  },
  electronics: { n: 0, jack: [{ d: "BEST BUY 00010488", acct: "citi" }], jackN: 1 },
  gas: {
    n: 3,
    ours: [
      { d: "CHEVRON 0204531", who: "jill", acct: "capone" },
      { d: "SHELL OIL 57444", who: "jack", acct: "amex" },
      { d: "COSTCO GAS #0144", who: "jack", acct: "citi" },
    ],
  },
  transit: { n: 0, jack: [{ d: "CLIPPER SERVICE", acct: "dcu" }], jackN: 2 },
  rideshare: {
    n: 2,
    ours: [
      { d: "LYFT *RIDE SAT 11PM", who: "jill", acct: "apple" },
      { d: "UBER *TRIP HELP.UBER.COM", who: "jack", acct: "chase" },
    ],
    jack: [{ d: "LYFT *RIDE TUE 8AM", acct: "chase" }],
    jackN: 1,
    jillN: 1,
  },
  parking: {
    n: 3,
    ours: [
      { d: "PARKMOBILE", who: "jack", acct: "amex" },
      { d: "FASTRAK CSC", who: "jill", acct: "bofa" },
      { d: "LAZ PARKING 440", who: "jack", acct: "chase" },
    ],
  },
  car: {
    n: 2,
    ours: [
      { d: "JIFFY LUBE #1893", who: "jill", acct: "capone" },
      { d: "OAKLAND CAR WASH", who: "jack", acct: "citi" },
    ],
  },
  flights: {
    n: 1,
    ours: [
      { d: "SOUTHWEST 5262139877", who: "jack", acct: "chase" },
      { d: "UNITED AIRLINES 0162234", who: "jill", acct: "capone" },
    ],
  },
  stays: {
    n: 2,
    ours: [
      { d: "AIRBNB * HMQ8ZXW2", who: "jill", acct: "capone" },
      { d: "HILTON HOTELS PORTLAND", who: "jack", acct: "chase" },
    ],
  },
  "travel-other": {
    n: 1,
    ours: [
      { d: "SFO PARKING CENTRAL", who: "jack", acct: "chase" },
      { d: "EXPEDIA 7263552", who: "jill", acct: "capone" },
    ],
  },
  entertainment: {
    n: 2,
    ours: [
      { d: "AMC ONLINE #1180", who: "jack", acct: "amex" },
      { d: "TICKETMASTER", who: "jill", acct: "discover" },
      { d: "SFJAZZ CENTER", who: "jack", acct: "chase" },
    ],
  },
  hobbies: {
    n: 0,
    jack: [
      { d: "REI #58 BERKELEY", acct: "citi" },
      { d: "GUITAR CENTER 721", acct: "chase" },
    ],
    jackN: 1,
    jillN: 1,
  },
  fitness: { n: 0, jack: [{ d: "PLANET FITNESS", acct: "dcu", day: 17 }], jackN: 1, jillN: 1 },
  pharmacy: {
    n: 1,
    ours: [
      { d: "CVS/PHARMACY #09876", who: "jill", acct: "discover" },
      { d: "WALGREENS #3319", who: "jack", acct: "amex" },
    ],
  },
  doctor: { n: 0, jack: [{ d: "SUTTER HEALTH COPAY", acct: "citi" }], jackN: 1, jillN: 1 },
  "gifts-given": {
    n: 2,
    ours: [
      { d: "ETSY.COM*MAKERSHOP", who: "jack", acct: "amex" },
      { d: "NORDSTROM #0427", who: "jill", acct: "discover" },
      { d: "UNCOMMON GOODS", who: "jack", acct: "chase" },
    ],
  },
  giving: {
    n: 1,
    ours: [
      { d: "KIVA.ORG", who: "jack", acct: "chase" },
      { d: "SF-MARIN FOOD BANK", who: "jill", acct: "bofa" },
    ],
  },
  "hair-beauty": { n: 0, jack: [{ d: "SUPERCUTS #4421", acct: "citi" }], jackN: 1, jillN: 1 },
};

interface Tx {
  share: Share;
  who: Who;
  acct: AccountKey;
  date: string;
  amount: Cents;
  description: string;
  categoryId: string;
  source: "statement" | "hand";
}

function daysIn(month: MonthKey): number {
  return Number(lastDayOf(month).slice(8));
}

/** Splits an amount into `n` uneven pieces that add up exactly. */
function split(amount: Cents, n: number, rand: () => number): Cents[] {
  if (n <= 1 || amount < n * 500) return [amount];
  const weights = Array.from({ length: n }, () => 0.6 + rand() * 0.8);
  const sum = weights.reduce((a, b) => a + b, 0);
  const pieces = weights.map((w) => Math.floor((amount * w) / sum));
  pieces[0]! += amount - pieces.reduce((a, b) => a + b, 0);
  return pieces;
}

/** The month's transactions: Ours from both of us and Jack's Mine. Jill's Mine is totals. */
function monthTransactions(
  index: number,
  parts: Part[],
  rand: () => number,
): { txs: Tx[]; jillMine: Array<{ categoryId: string; total: Cents; count: number }> } {
  const month = MONTHS[index]!;
  const days = daysIn(month);
  const date = (day?: number) =>
    `${month}-${String(day ?? 1 + Math.floor(rand() * days)).padStart(2, "0")}`;
  const txs: Tx[] = [];
  const jillMine: Array<{ categoryId: string; total: Cents; count: number }> = [];

  for (const part of parts) {
    const place = PLACES[part.sub];
    if (part.sub === "rent") continue;
    if (part.sub === "subscriptions") {
      for (const s of subscriptions(month)) {
        txs.push({
          share: s.share,
          who: s.who,
          acct: s.acct,
          date: date(s.day),
          amount: s.amount,
          description: s.d,
          categoryId: "subscriptions",
          source: "statement",
        });
      }
      continue;
    }
    if (part.sub === "insurance") {
      txs.push({
        share: "ours",
        who: "jack",
        acct: "wf",
        date: date(3),
        amount: INSURANCE[0]!,
        description: "LEMONADE INSURANCE",
        categoryId: "insurance",
        source: "statement",
      });
      txs.push({
        share: "ours",
        who: "jill",
        acct: "bofa",
        date: date(5),
        amount: INSURANCE[1]!,
        description: "GEICO *AUTO",
        categoryId: "insurance",
        source: "statement",
      });
      continue;
    }
    if (part.ours > 0) {
      const places = place?.ours;
      if (!places) throw new Error(`No sample places for ${part.sub}`);
      let amount = part.ours;
      // July's Amex statement ends with a Trader Joe's trip that August's file repeats.
      if (month === "2026-07" && part.sub === "groceries") {
        txs.push({
          share: "ours",
          who: "jack",
          acct: "amex",
          date: "2026-07-31",
          amount: 6410,
          description: "TRADER JOE'S #552 OAKLAND CA",
          categoryId: "groceries",
          source: "statement",
        });
        amount -= 6410;
      }
      split(amount, place.n, rand).forEach((piece, i) => {
        const t = places[(i + index) % places.length]!;
        const description =
          month === AUGUST && part.sub === "utilities" && t.who === "jill"
            ? "RECOLOGY EAST BAY"
            : t.d;
        txs.push({
          share: "ours",
          who: t.who ?? "jack",
          acct: t.acct,
          date: date(t.day),
          amount: piece,
          description,
          categoryId: part.sub,
          source: "statement",
        });
      });
    }
    if (part.jack > 0) {
      const places = place?.jack;
      if (!places) throw new Error(`No sample places for Jack's ${part.sub}`);
      split(part.jack, place.jackN ?? 1, rand).forEach((piece, i) => {
        const t = places[i % places.length]!;
        txs.push({
          share: "mine",
          who: "jack",
          acct: t.acct,
          date: date(t.day),
          amount: piece,
          description: t.d,
          categoryId: part.sub,
          source: "statement",
        });
      });
    }
    if (part.jill > 0) {
      jillMine.push({
        categoryId: part.sub,
        total: part.jill,
        count: Math.max(1, place?.jillN ?? 1),
      });
    }
  }

  // Jack's statements for August come from Chase and Wells Fargo; Amex is still being sorted.
  if (month === AUGUST) {
    for (const tx of txs) {
      if (tx.who !== "jack") continue;
      if (tx.acct === "amex" && tx.description.startsWith("NETFLIX")) continue;
      if (tx.acct === "amex" || tx.acct === "citi") tx.acct = "chase";
      if (tx.acct === "dcu") tx.acct = "wf";
    }
    // A few things Jack added by hand, carved out of what the month already holds.
    const byHand = (
      categoryId: string,
      share: Share,
      amount: Cents | null,
      description: string,
      date: string,
    ) => {
      const from = txs.find(
        (t) =>
          t.who === "jack" &&
          t.share === share &&
          t.categoryId === categoryId &&
          t.acct !== "amex" &&
          t.source === "statement" &&
          (amount === null || t.amount > amount),
      );
      if (!from) return;
      const cut = amount ?? from.amount;
      from.amount -= cut;
      txs.push({ ...from, acct: "jackCash", description, source: "hand", date, amount: cut });
      if (from.amount === 0) txs.splice(txs.indexOf(from), 1);
    };
    byHand("groceries", "ours", 3600, "Farmers market", "2026-08-16");
    byHand("hair-beauty", "mine", null, "Haircut", "2026-08-18");
    byHand("parking", "ours", 1200, "Parking downtown", "2026-08-14");
  }

  // Rent is paid in two parts; Jack's part makes the month's Ebb & flow what it was.
  const oursTotal = parts.reduce((t, p) => t + p.ours, 0);
  const bp = month >= "2026-01" ? 5800 : 6000;
  const jackOthers = txs
    .filter((t) => t.share === "ours" && t.who === "jack")
    .reduce((t, x) => t + x.amount, 0);
  const jackRent = shareOf(oursTotal, bp) + RAW[month]! - jackOthers;
  if (jackRent <= 0 || jackRent >= RENT)
    throw new Error(`The sample rent for ${month} doesn't split.`);
  txs.push({
    share: "ours",
    who: "jack",
    acct: "wf",
    date: date(1),
    amount: jackRent,
    description: "MAPLE COURT APTS RENT",
    categoryId: "rent",
    source: "statement",
  });
  txs.push({
    share: "ours",
    who: "jill",
    acct: "bofa",
    date: date(1),
    amount: RENT - jackRent,
    description: "MAPLE COURT APTS RENT",
    categoryId: "rent",
    source: "statement",
  });
  return { txs, jillMine };
}

// ————— Statement files —————

const mdy = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
const money = (value: Cents) => (value / 100).toFixed(2);
const csv = (rows: Array<Array<string | number>>) =>
  `${rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")}\n`;

const CHASE_CATEGORY: Record<string, string> = {
  groceries: "Groceries",
  "dining-out": "Food & Drink",
  coffee: "Food & Drink",
  "household-goods": "Shopping",
  clothes: "Shopping",
  electronics: "Shopping",
  gas: "Gas",
  rideshare: "Travel",
  parking: "Travel",
  transit: "Travel",
  car: "Automotive",
  flights: "Travel",
  stays: "Travel",
  "travel-other": "Travel",
  subscriptions: "Bills & Utilities",
  entertainment: "Entertainment",
  hobbies: "Shopping",
  fitness: "Health & Wellness",
  pharmacy: "Health & Wellness",
  doctor: "Health & Wellness",
  "gifts-given": "Gifts & Donations",
  giving: "Gifts & Donations",
  "hair-beauty": "Personal",
  "home-upkeep": "Home",
};

interface Planned {
  categoryId: string;
  decision: Decision;
  note?: string;
}

/** Amex Gold for August, as in the To sort design: 41 sorted, 23 still to go. */
const AMEX_AUGUST: Array<[date: string, description: string, amount: number, plan: Planned]> = [
  [
    "2026-08-28",
    "TRADER JOE S #552 OAKLAND CA",
    86.42,
    { categoryId: "groceries", decision: "ours" },
  ],
  [
    "2026-08-26",
    "ALASKA AIR 0272174 SEATTLE WA",
    612.4,
    { categoryId: "flights", decision: "ours" },
  ],
  [
    "2026-08-25",
    "TARGET 00012345 EMERYVILLE CA",
    143.2,
    { categoryId: "household-goods", decision: "ours" },
  ],
  ["2026-08-23", "SAFEWAY #1711 OAKLAND CA", 72.18, { categoryId: "groceries", decision: "ours" }],
  ["2026-08-22", "TST* HOMESTEAD OAKLAND CA", 96.4, { categoryId: "dining-out", decision: "ours" }],
  ["2026-08-21", "SHELL OIL 57444 OAKLAND CA", 58.12, { categoryId: "gas", decision: "ours" }],
  ["2026-08-20", "PARKMOBILE", 6.25, { categoryId: "parking", decision: "ours" }],
  [
    "2026-08-19",
    "TRADER JOE S #552 OAKLAND CA",
    54.87,
    { categoryId: "groceries", decision: "ours" },
  ],
  ["2026-08-19", "PGANDE WEB ONLINE", 142.1, { categoryId: "utilities", decision: "ours" }],
  [
    "2026-08-18",
    "AMZN Mktp US*7T2QW1LK3",
    19.99,
    { categoryId: "household-goods", decision: "ours" },
  ],
  [
    "2026-08-17",
    "SQ *SUNNY SIDE CAFE OAKLAND CA",
    42.3,
    { categoryId: "dining-out", decision: "ours" },
  ],
  [
    "2026-08-16",
    "COSTCO WHSE #0144 RICHMOND CA",
    187.45,
    { categoryId: "groceries", decision: "ours" },
  ],
  ["2026-08-15", "AMC ONLINE #1180", 38.5, { categoryId: "entertainment", decision: "ours" }],
  ["2026-08-14", "SAFEWAY #1711 OAKLAND CA", 48.66, { categoryId: "groceries", decision: "ours" }],
  ["2026-08-13", "WALGREENS #3319", 21.47, { categoryId: "pharmacy", decision: "ours" }],
  [
    "2026-08-12",
    "TRADER JOE S #552 OAKLAND CA",
    67.33,
    { categoryId: "groceries", decision: "ours" },
  ],
  ["2026-08-11", "DOORDASH*THAI HOUSE", 44.8, { categoryId: "dining-out", decision: "ours" }],
  ["2026-08-10", "PARKMOBILE", 4.75, { categoryId: "parking", decision: "ours" }],
  [
    "2026-08-09",
    "AMZN Mktp US*1H8RZ0KQ2",
    24.99,
    { categoryId: "household-goods", decision: "ours" },
  ],
  ["2026-08-08", "ETSY.COM*MAKERSHOP", 36.0, { categoryId: "gifts-given", decision: "ours" }],
  [
    "2026-08-07",
    "TRADER JOE S #552 OAKLAND CA",
    71.24,
    { categoryId: "groceries", decision: "ours" },
  ],
  ["2026-08-06", "CHEVRON 0204531", 52.3, { categoryId: "gas", decision: "ours" }],
  ["2026-08-05", "SQ *NOODLE THEORY OAKLAND", 58.9, { categoryId: "dining-out", decision: "ours" }],
  ["2026-08-04", "THE HOME DEPOT #0641", 47.82, { categoryId: "home-upkeep", decision: "ours" }],
  ["2026-08-03", "SAFEWAY #1711 OAKLAND CA", 39.14, { categoryId: "groceries", decision: "ours" }],
  ["2026-08-02", "FASTRAK CSC", 25.0, { categoryId: "parking", decision: "ours" }],
  ["2026-08-24", "IKEA EMERYVILLE", 136.7, { categoryId: "household-goods", decision: "ours" }],
  ["2026-08-10", "SPROUTS FARMERS MKT #412", 61.53, { categoryId: "groceries", decision: "ours" }],
  [
    "2026-08-29",
    "TST* HOMESTEAD OAKLAND CA",
    124.99,
    { categoryId: "dining-out", decision: "ours" },
  ],

  ["2026-08-27", "SQ *BLUE BOTTLE COFFE 0423", 11.5, { categoryId: "coffee", decision: "mine" }],
  ["2026-08-24", "SQ *BLUE BOTTLE COFFE 0423", 6.75, { categoryId: "coffee", decision: "mine" }],
  ["2026-08-18", "UNIQLO USA LLC", 89.7, { categoryId: "clothes", decision: "mine" }],
  ["2026-08-15", "PHILZ COFFEE 12", 7.25, { categoryId: "coffee", decision: "mine" }],
  ["2026-08-13", "CHIPOTLE 1841", 14.85, { categoryId: "dining-out", decision: "mine" }],
  ["2026-08-11", "SUPERCUTS #4421", 38.0, { categoryId: "hair-beauty", decision: "mine" }],
  ["2026-08-08", "REI #58 BERKELEY", 96.4, { categoryId: "hobbies", decision: "mine" }],
  ["2026-08-06", "SQ *BLUE BOTTLE COFFE 0423", 5.5, { categoryId: "coffee", decision: "mine" }],
  ["2026-08-04", "CLIPPER SERVICE", 42.5, { categoryId: "transit", decision: "mine" }],

  ["2026-08-24", "AUTOPAY PAYMENT - THANK YOU", -2340.18, { categoryId: "", decision: "aside" }],
  ["2026-08-01", "NETFLIX.COM LOS GATOS CA", 17.99, { categoryId: "", decision: "aside" }],
  [
    "2026-08-12",
    "DELTA AIR LINES 0062198 ATLANTA",
    389.2,
    { categoryId: "flights", decision: "aside", note: "Work trip, expensed" },
  ],

  [
    "2026-08-22",
    "AMZN Mktp US*2K4L81JQ3 Amzn.com/bill WA",
    39.99,
    { categoryId: "", decision: "pending" },
  ],
  ["2026-08-21", "AMZN Mktp US*1H8RZ0KQ2 REFUND", -24.99, { categoryId: "", decision: "pending" }],
  ["2026-08-20", "SWEETGREEN BERKELEY CA", 18.75, { categoryId: "", decision: "pending" }],
  ["2026-08-01", "TRADER JOE S #552 OAKLAND CA", 64.1, { categoryId: "", decision: "pending" }],
  ["2026-08-31", "SAFEWAY #1711 OAKLAND CA", 58.2, { categoryId: "", decision: "pending" }],
  ["2026-08-30", "TST* HOMESTEAD OAKLAND CA", 112.6, { categoryId: "", decision: "pending" }],
  ["2026-08-30", "LYFT *RIDE SUN 3PM", 18.4, { categoryId: "", decision: "pending" }],
  ["2026-08-29", "WALGREENS #3319", 12.99, { categoryId: "", decision: "pending" }],
  ["2026-08-29", "BERKELEY BOWL WEST", 43.18, { categoryId: "", decision: "pending" }],
  ["2026-08-28", "SQ *NOODLE THEORY OAKLAND", 36.75, { categoryId: "", decision: "pending" }],
  ["2026-08-27", "SHELL OIL 57444 OAKLAND CA", 49.8, { categoryId: "", decision: "pending" }],
  ["2026-08-26", "PARKMOBILE", 5.5, { categoryId: "", decision: "pending" }],
  ["2026-08-25", "CVS/PHARMACY #09876", 22.4, { categoryId: "", decision: "pending" }],
  ["2026-08-23", "SQ *FARMGIRL COFFEE", 9.8, { categoryId: "", decision: "pending" }],
  ["2026-08-22", "TICKETMASTER", 124.0, { categoryId: "", decision: "pending" }],
  ["2026-08-21", "BERKELEY BOWL WEST", 67.45, { categoryId: "", decision: "pending" }],
  ["2026-08-20", "ACE HARDWARE 14552", 18.62, { categoryId: "", decision: "pending" }],
  ["2026-08-19", "UBER *TRIP HELP.UBER.COM", 24.1, { categoryId: "", decision: "pending" }],
  ["2026-08-18", "OLD NAVY ON-LINE", 46.0, { categoryId: "", decision: "pending" }],
  ["2026-08-17", "DOORDASH*POKE BAR", 31.2, { categoryId: "", decision: "pending" }],
  ["2026-08-16", "PEETS 1023", 5.95, { categoryId: "", decision: "pending" }],
  ["2026-08-14", "WHOLEFDS OAK 10234", 38.66, { categoryId: "", decision: "pending" }],
  ["2026-08-09", "SQ *BURMA LOVE", 27.35, { categoryId: "", decision: "pending" }],
];

/** DCU's new export layout for August: it waits in Uploads for the one-time setup. */
const DCU_AUGUST: Array<[string, string, string, number | null, number | null]> = [
  ["08/01/2026", "DIVIDEND", "Share dividend", null, 1.84],
  ["08/02/2026", "VENMO PAYMENT", "1022334455", 24.0, null],
  ["08/03/2026", "SQ *ROCKRIDGE MARKET", "Card 0871", 18.2, null],
  ["08/05/2026", "USPS PO 0588", "Card 0871", 9.45, null],
  ["08/06/2026", "ATM WITHDRAWAL 7-ELEVEN", "Oakland CA", 60.0, null],
  ["08/08/2026", "TRANSFER FROM WELLS FARGO", "Online", null, 500.0],
  ["08/09/2026", "OAKLAND PUBLIC LIBRARY", "Card 0871", 3.0, null],
  ["08/10/2026", "SQ *ARIZMENDI BAKERY", "Card 0871", 14.75, null],
  ["08/11/2026", "DMV RENEWAL", "Online", 64.0, null],
  ["08/12/2026", "SQ *TEMESCAL FARMERS MKT", "Card 0871", 22.5, null],
  ["08/13/2026", "LAUNDROMAT 24HR", "Card 0871", 11.25, null],
  ["08/14/2026", "SQ *ROCKRIDGE MARKET", "Card 0871", 26.4, null],
  ["08/15/2026", "RED CROSS DONATION", "Online", 25.0, null],
  ["08/17/2026", "UPS STORE 4412", "Card 0871", 17.9, null],
  ["08/19/2026", "SQ *ARIZMENDI BAKERY", "Card 0871", 9.25, null],
  ["08/20/2026", "PAYPAL *KOBO", "Online", 12.99, null],
  ["08/22/2026", "SQ *ROCKRIDGE MARKET", "Card 0871", 31.1, null],
  ["08/24/2026", "OAKLAND ZOO", "Card 0871", 48.0, null],
  ["08/26/2026", "SQ *TEMESCAL FARMERS MKT", "Card 0871", 19.75, null],
  ["08/28/2026", "CITY OF OAKLAND PARKING", "Card 0871", 45.0, null],
  ["08/30/2026", "SQ *ARIZMENDI BAKERY", "Card 0871", 11.5, null],
  ["08/31/2026", "DIVIDEND", "Share dividend", null, 1.91],
];

async function importFile(store: Store, fileName: string, bytes: Uint8Array): Promise<string> {
  const parsed = readStatement(bytes, fileName);
  const path = `sample:${fileName}`;
  sampleFiles.set(path, bytes);
  const outcome = await beginImport(store, { fileName, bytes, parsed, path });
  if (outcome.status !== "ready") throw new Error(`Sample ${fileName}: ${outcome.status}`);
  return outcome.fileId;
}

/** Sorts a file's rows the way we planned: Ours, Mine, set aside or still waiting. */
async function sortAsPlanned(
  store: Store,
  fileId: string,
  plan: (draft: Draft) => Planned | null,
): Promise<void> {
  const drafts = await getDrafts(store, fileId);
  const byDecision = new Map<string, string[]>();
  const byCategory = new Map<string, string[]>();
  for (const d of drafts) {
    const p = plan(d);
    if (!p) continue;
    if (p.decision !== d.decision)
      byDecision.set(p.decision, [...(byDecision.get(p.decision) ?? []), d.id]);
    if (p.categoryId && p.categoryId !== d.categoryId) {
      byCategory.set(p.categoryId, [...(byCategory.get(p.categoryId) ?? []), d.id]);
    }
    if (p.note) await setDraftNote(store, d.id, p.note);
  }
  for (const [decision, ids] of byDecision) await decide(store, ids, decision as Decision);
  for (const [categoryId, ids] of byCategory) await setDraftCategory(store, ids, categoryId);
}

export async function seedSampleHousehold(store: Store): Promise<void> {
  const { members } = await setupHousehold(store, {
    names: ["Jack", "Jill"],
    me: 0,
    firstBp: 6000,
    fromMonth: "2025-01",
  });
  const jack = members[0]!.id;
  const jill = members[1]!.id;
  const memberOf: Record<Who, string> = { jack, jill };

  // Jill changed Our rhythm to 58 / 42 in January.
  store.memberId = jill;
  await store.write([
    {
      entity: "sharePlan",
      id: uuidv7(),
      fields: {
        fromMonth: "2026-01",
        firstBp: 5800,
        changedBy: jill,
        note: null,
        createdAt: "2026-01-04T18:12:00.000Z",
      },
    },
  ]);
  store.memberId = jack;

  const cash = await getAccounts(store);
  const accounts: Record<AccountKey, string> = {
    jackCash: cash.find((a) => a.ownerId === jack)!.id,
    amex: uuidv7(),
    chase: uuidv7(),
    wf: uuidv7(),
    dcu: uuidv7(),
    citi: uuidv7(),
    apple: uuidv7(),
    capone: uuidv7(),
    discover: uuidv7(),
    bread: uuidv7(),
    bofa: uuidv7(),
  };
  const define = (
    key: AccountKey,
    owner: string,
    institution: string,
    name: string,
    last4: string | null,
    kind: "credit" | "checking",
    profileId: string | null,
  ): Change => ({
    entity: "account",
    id: accounts[key],
    fields: {
      ownerId: owner,
      institution,
      name,
      last4,
      kind,
      defaultShare: "ours",
      profileId,
      createdAt: "2025-01-12T17:00:00.000Z",
      archived: false,
    },
  });
  await store.write([
    define("amex", jack, "American Express", "Amex Gold", "1008", "credit", "amex-csv"),
    define("chase", jack, "Chase", "Chase Sapphire", "4417", "credit", "chase-card-csv"),
    define("wf", jack, "Wells Fargo", "Wells Fargo Checking", "2290", "checking", "wells-fargo-csv"),
    define("dcu", jack, "DCU", "DCU Checking", "0871", "checking", null),
    define("citi", jack, "Citi", "Citi Double Cash", "5532", "credit", "citi-csv"),
    define("apple", jill, "Apple Card", "Apple Card", null, "credit", "apple-card-csv"),
    define(
      "capone",
      jill,
      "Capital One",
      "Capital One Venture",
      "7763",
      "credit",
      "capital-one-csv",
    ),
    define("discover", jill, "Discover", "Discover it", "3309", "credit", "discover-csv"),
    define("bread", jill, "Bread Cashback", "Bread Cashback", "6120", "credit", null),
    define(
      "bofa",
      jill,
      "Bank of America",
      "BofA Checking",
      "8841",
      "checking",
      "bofa-checking-csv",
    ),
  ]);

  await addRule(store, { pattern: "TRADER JOE", categoryId: "groceries", share: "ours" });
  await addRule(store, { pattern: "PGANDE", categoryId: "utilities", share: "ours" });
  await addRule(store, { pattern: "MAPLE COURT", categoryId: "rent", share: "ours" });
  await addRule(store, { pattern: "BLUE BOTTLE", categoryId: "coffee", share: "mine" });

  const rand = random(20260903);
  const augustRows: Tx[] = [];
  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i]!;
    const { txs, jillMine } = monthTransactions(i, monthParts(i), rand);
    const addedAt = (who: Who) =>
      month === AUGUST
        ? `2026-09-0${who === "jack" ? 2 : 4}T16:30:00.000Z`
        : `${addMonths(month, 1)}-03T17:${who === "jack" ? "05" : "40"}:00.000Z`;
    const row = (t: Tx): Change => ({
      entity: t.share === "ours" ? "transaction" : "mineTransaction",
      id: uuidv7(),
      fields: {
        accountId: accounts[t.acct],
        paidBy: memberOf[t.who],
        date: t.date,
        amount: t.amount,
        merchant: t.source === "hand" ? t.description : cleanMerchant(t.description),
        description: t.description,
        categoryId: t.categoryId,
        note: null,
        source: t.source,
        refundOf: null,
        // Netflix on Aug 1 came in with July's Amex statement.
        addedAt:
          t.date === "2026-08-01" && t.acct === "amex"
            ? "2026-08-03T17:05:00.000Z"
            : addedAt(t.who),
        addedBy: memberOf[t.who],
      },
    });

    const pats = txs.filter((t) => t.who === "jack");
    const direct =
      month === AUGUST ? pats.filter((t) => t.acct === "amex" || t.source === "hand") : pats;
    if (month === AUGUST) augustRows.push(...pats.filter((t) => !direct.includes(t)));
    await store.write(direct.map(row));
    const mineKeys = direct
      .filter((t) => t.share === "mine")
      .map((t) => ({ month, categoryId: t.categoryId }));
    const totals = await mineTotalChanges(store, mineKeys);
    if (totals.length) await store.write(totals);

    // Jill's, as they arrive from Jill's Mac.
    store.memberId = jill;
    await store.write([
      ...txs.filter((t) => t.who === "jill").map(row),
      ...jillMine.map((m) => ({
        entity: "mineTotal" as const,
        id: `${jill}:${month}:${m.categoryId}`,
        fields: { memberId: jill, month, categoryId: m.categoryId, total: m.total, count: m.count },
      })),
    ]);
    store.memberId = jack;

    // Jack's statements for the month (August's are uploaded below).
    if (month !== AUGUST) await recordPastFiles(store, month, accounts, pats);
  }

  // Clean slates: everything so far at the end of December, and July at the end of July.
  await store.write([
    {
      entity: "cleanSlate",
      id: uuidv7(),
      fields: {
        fromMember: jack,
        toMember: jill,
        amount: 64000,
        date: "2025-12-31",
        appliesTo: "overall",
        note: null,
        addedAt: "2026-01-05T19:20:00.000Z",
        addedBy: jack,
      },
    },
    {
      entity: "cleanSlate",
      id: uuidv7(),
      fields: {
        fromMember: jack,
        toMember: jill,
        amount: 50000,
        date: "2026-07-31",
        appliesTo: "2026-07",
        note: null,
        addedAt: "2026-08-04T20:10:00.000Z",
        addedBy: jack,
      },
    },
  ]);

  await uploadAugust(store, augustRows);
}

async function recordPastFiles(
  store: Store,
  month: MonthKey,
  accounts: Record<AccountKey, string>,
  pats: Tx[],
): Promise<void> {
  const next = addMonths(month, 1);
  const short = new Date(`${month}-15T00:00:00Z`)
    .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    .toLowerCase();
  const stamp = next.replace("-", "");
  const files: Array<[AccountKey, string, string, string, string]> = [
    ["amex", `amex-${short}.csv`, `${month}-02`, `${next}-01`, "amex-csv"],
    ["chase", `Chase_Activity_${stamp}01.CSV`, `${month}-01`, lastDayOf(month), "chase-card-csv"],
    ["wf", `WF_Checking_${short}.csv`, `${month}-01`, lastDayOf(month), "wells-fargo-csv"],
    ["dcu", `DCU_Export_${stamp.slice(4)}01.csv`, `${month}-01`, lastDayOf(month), ""],
    ["citi", `citi-activity-${short}.csv`, `${month}-03`, `${next}-02`, "citi-csv"],
  ];
  // May's Chase activity came in two exports.
  if (month === "2026-05")
    files.push([
      "chase",
      "Chase_Activity_20260516.CSV",
      "2026-05-16",
      "2026-05-31",
      "chase-card-csv",
    ]);
  for (const [key, fileName, first, last, profileId] of files) {
    const rows = pats.filter((t) => t.acct === key).length + (key === "wf" ? 6 : 1);
    await store.db.run(
      `INSERT INTO statement_files (id, file_name, sha256, path, account_id, profile_id, format, first_date, last_date, brought_in_at, status, row_count, skipped_count)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'added', ?, 0)`,
      [
        uuidv7(),
        fileName,
        await fileSha256(new TextEncoder().encode(`${fileName}:${month}`)),
        accounts[key],
        profileId || null,
        fileName.endsWith(".xlsx") ? "xlsx" : "csv",
        first,
        last,
        `${next}-0${key === "amex" || key === "citi" ? 3 : 2}T16:2${key.length}:00.000Z`,
        rows,
      ],
    );
  }
}

/** Jack's August: Wells Fargo and Chase uploaded and added, Amex part-sorted, DCU waiting. */
async function uploadAugust(store: Store, rows: Tx[]): Promise<void> {
  const planOf = new Map<string, Planned>();
  const key = (date: string, amount: Cents, description: string) =>
    `${date}|${amount}|${description}`;
  for (const t of rows)
    planOf.set(key(t.date, t.amount, t.description), {
      categoryId: t.categoryId,
      decision: t.share,
    });

  // Wells Fargo: bills and rent, plus pay, card payments and a transfer that are set aside.
  const wf = rows.filter((t) => t.acct === "wf").sort((a, b) => (a.date < b.date ? -1 : 1));
  const wfRows: Array<Array<string | number>> = [
    ...wf.map((t) => [mdy(t.date), money(-t.amount), "*", "", t.description]),
    ["08/07/2026", "3812.40", "*", "", "ACME CORP DIR DEP PAYROLL"],
    ["08/21/2026", "3812.40", "*", "", "ACME CORP DIR DEP PAYROLL"],
    ["08/08/2026", "-500.00", "*", "", "ONLINE TRANSFER TO DCU SAVINGS XXXXXX0871"],
    ["08/15/2026", "-1845.20", "*", "", "CHASE CREDIT CRD AUTOPAY"],
    ["08/18/2026", "-612.33", "*", "", "CITI CARD ONLINE PAYMENT"],
    ["08/24/2026", "-2340.18", "*", "", "AMERICAN EXPRESS ACH PMT"],
  ];
  const wfId = await importFile(
    store,
    "WF_Checking_Aug2026.csv",
    new TextEncoder().encode(csv(wfRows)),
  );
  await sortAsPlanned(store, wfId, (d) => planOf.get(key(d.date, d.amount, d.description)) ?? null);
  await addToMonth(store, wfId);

  // Chase Sapphire: purchases, the card payment, and one left out for work.
  const chase = rows.filter((t) => t.acct === "chase").sort((a, b) => (a.date < b.date ? 1 : -1));
  const chaseRows: Array<Array<string | number>> = [
    ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"],
    ["08/15/2026", "08/15/2026", "Payment Thank You-Mobile", "", "Payment", "1845.20", ""],
    ["08/20/2026", "08/21/2026", "HERTZ RENT-A-CAR SEA", "Travel", "Sale", "-214.66", ""],
    ...chase.map((t) => [
      mdy(t.date),
      mdy(t.date),
      t.description,
      CHASE_CATEGORY[t.categoryId] ?? "Shopping",
      "Sale",
      money(-t.amount),
      "",
    ]),
  ];
  const chaseId = await importFile(
    store,
    "Chase_Activity_20260901.CSV",
    new TextEncoder().encode(csv(chaseRows)),
  );
  await sortAsPlanned(store, chaseId, (d) =>
    d.description.startsWith("HERTZ")
      ? { categoryId: "travel-other", decision: "aside", note: "For work" }
      : (planOf.get(key(d.date, d.amount, d.description)) ?? null),
  );
  await addToMonth(store, chaseId);

  // Amex Gold: 41 of 64 sorted, not added yet.
  const amexRows: Array<Array<string | number>> = [
    ["Date", "Description", "Card Member", "Account #", "Amount"],
    ...AMEX_AUGUST.map(([date, description, amount]) => [
      mdy(date),
      description,
      "JACK LEE",
      "-11008",
      amount.toFixed(2),
    ]),
  ];
  const amexId = await importFile(
    store,
    "amex-activity-aug.csv",
    new TextEncoder().encode(csv(amexRows)),
  );
  const amexPlan = new Map(
    AMEX_AUGUST.map(([date, description, amount, plan]) => [
      key(date, cents(amount), description),
      plan,
    ]),
  );
  await sortAsPlanned(
    store,
    amexId,
    (d) => amexPlan.get(key(d.date, d.amount, d.description)) ?? null,
  );

  // DCU's export changed layout: it waits for the one-time setup.
  const dcuBytes = writeXlsx(
    [["Posted", "Payee", "Memo", "Withdrawal", "Deposit"], ...DCU_AUGUST.map((r) => [...r])],
    "Transactions",
  );
  sampleFiles.set("sample:DCU_Export_0901.xlsx", dcuBytes);
  const dcu = readStatement(dcuBytes, "DCU_Export_0901.xlsx");
  await rememberForSetup(store, {
    fileName: "DCU_Export_0901.xlsx",
    sha256: await fileSha256(dcuBytes),
    path: "sample:DCU_Export_0901.xlsx",
    format: "xlsx",
    firstDate: dcu.firstDate,
    lastDate: dcu.lastDate,
    rowCount: dcu.dataRows ?? 0,
  });

  // When each file was uploaded, as in the designs.
  const uploaded: Array<[string, string]> = [
    ["WF_Checking_Aug2026.csv", "2026-09-02T16:20:00.000Z"],
    ["Chase_Activity_20260901.CSV", "2026-09-02T16:24:00.000Z"],
    ["amex-activity-aug.csv", "2026-09-03T19:05:00.000Z"],
    ["DCU_Export_0901.xlsx", "2026-09-03T19:07:00.000Z"],
  ];
  for (const [fileName, at] of uploaded) {
    await store.db.run("UPDATE statement_files SET brought_in_at = ? WHERE file_name = ?", [
      at,
      fileName,
    ]);
  }
  await store.db.run(
    "UPDATE transactions SET added_at = ? WHERE added_by = ? AND month = ? AND source = 'statement' AND added_at > ?",
    ["2026-09-02T16:30:00.000Z", store.memberId, AUGUST, "2026-09-05"],
  );
  await store.db.run("UPDATE mine_transactions SET added_at = ? WHERE month = ? AND added_at > ?", [
    "2026-09-02T16:30:00.000Z",
    AUGUST,
    "2026-09-05",
  ]);
  store.notify(["transaction", "files", "drafts"]);
}
