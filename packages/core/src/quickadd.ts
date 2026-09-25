import type { Category } from "./categories.ts";
import { type ISODate, makeDate, relativeDay, WEEKDAYS } from "./dates.ts";
import { findKnownMerchant } from "./merchants.ts";
import { type Cents, parseCents } from "./money.ts";
import type { Share } from "./words.ts";

/**
 * Reads a quick-add sentence: "42.18 trader joes groceries yesterday",
 * "mine 18 sweetgreen lunch", "ours 64 dinner friday". Every field says whether it came
 * from the words or has to be filled in for you, so the screen can show which is which.
 * The local model reads harder sentences in M4; this parser always runs first.
 */

export interface QuickAddResult {
  amount: Cents | null;
  merchant: string | null;
  categoryId: string | null;
  date: ISODate;
  share: Share | null;
  fromWords: {
    amount: boolean;
    merchant: boolean;
    category: boolean;
    date: boolean;
    share: boolean;
  };
}

/** Everyday words for categories. Category names themselves also work. */
const CATEGORY_WORDS: Record<string, string> = {
  groceries: "groceries",
  grocery: "groceries",
  lunch: "dining-out",
  dinner: "dining-out",
  breakfast: "dining-out",
  brunch: "dining-out",
  takeout: "dining-out",
  restaurant: "dining-out",
  drinks: "dining-out",
  coffee: "coffee",
  latte: "coffee",
  gas: "gas",
  fuel: "gas",
  taxi: "rideshare",
  cab: "rideshare",
  parking: "parking",
  toll: "parking",
  train: "transit",
  bus: "transit",
  flight: "flights",
  flights: "flights",
  hotel: "stays",
  movie: "entertainment",
  movies: "entertainment",
  concert: "entertainment",
  tickets: "entertainment",
  pharmacy: "pharmacy",
  meds: "pharmacy",
  doctor: "doctor",
  dentist: "doctor",
  gym: "fitness",
  haircut: "hair-beauty",
  gift: "gifts-given",
  gifts: "gifts-given",
  donation: "giving",
  rent: "rent",
  electricity: "utilities",
  internet: "internet-phone",
  clothes: "clothes",
  books: "education",
  pet: "pets",
  vet: "pets",
};

const SHARE_WORDS: Record<string, Share> = { ours: "ours", us: "ours", mine: "mine", me: "mine" };

function titleCase(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthIndexOf(word: string): number {
  return MONTHS.findIndex(
    (m) => word === m || word === m.slice(0, 3) || (m === "september" && word === "sept"),
  );
}

export function parseQuickAdd(
  text: string,
  options: { today: ISODate; categories: readonly Category[] },
): QuickAddResult {
  const result: QuickAddResult = {
    amount: null,
    merchant: null,
    categoryId: null,
    date: options.today,
    share: null,
    fromWords: { amount: false, merchant: false, category: false, date: false, share: false },
  };
  const tokens = text.toLowerCase().replace(/[,;]+/g, " ").split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  let categoryWord: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];

    if (t === "just" && next === "me") {
      result.share = "mine";
      result.fromWords.share = true;
      i++;
      continue;
    }
    if (t === "for" && next && SHARE_WORDS[next]) {
      result.share = SHARE_WORDS[next]!;
      result.fromWords.share = true;
      i++;
      continue;
    }
    if ((t === "ours" || t === "mine") && !result.fromWords.share) {
      result.share = SHARE_WORDS[t]!;
      result.fromWords.share = true;
      continue;
    }
    if (result.amount === null && /^\$?\d+(\.\d{1,2})?$/.test(t)) {
      result.amount = parseCents(t);
      result.fromWords.amount = true;
      continue;
    }
    if (!result.fromWords.date) {
      if (t === "last" && next && WEEKDAYS.some((d) => d === next || d.slice(0, 3) === next)) {
        result.date = relativeDay(next, options.today) ?? result.date;
        result.fromWords.date = true;
        i++;
        continue;
      }
      const rel = relativeDay(t, options.today);
      if (rel) {
        result.date = rel;
        result.fromWords.date = true;
        continue;
      }
      const slash = t.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (slash) {
        const year = Number(options.today.slice(0, 4));
        let date = makeDate(year, Number(slash[1]), Number(slash[2]));
        if (date && date > options.today)
          date = makeDate(year - 1, Number(slash[1]), Number(slash[2]));
        if (date) {
          result.date = date;
          result.fromWords.date = true;
          continue;
        }
      }
      const monthIndex = monthIndexOf(t);
      if (monthIndex >= 0 && next && /^\d{1,2}$/.test(next)) {
        const year = Number(options.today.slice(0, 4));
        let date = makeDate(year, monthIndex + 1, Number(next));
        if (date && date > options.today) date = makeDate(year - 1, monthIndex + 1, Number(next));
        if (date) {
          result.date = date;
          result.fromWords.date = true;
          i++;
          continue;
        }
      }
    }
    if (!result.fromWords.category) {
      const byWord = CATEGORY_WORDS[t];
      const byName = options.categories.find((c) => c.name.toLowerCase() === t);
      if (byWord || byName) {
        result.categoryId = byWord ?? byName!.id;
        result.fromWords.category = true;
        categoryWord = t;
        continue;
      }
    }
    rest.push(t);
  }

  if (rest.length > 0) {
    const phrase = rest.join(" ");
    const known = findKnownMerchant(phrase);
    result.merchant = known ? known.name : titleCase(rest);
    result.fromWords.merchant = true;
    if (!result.categoryId && known) result.categoryId = known.categoryId;
  } else if (categoryWord) {
    result.merchant = titleCase([categoryWord]);
    result.fromWords.merchant = true;
  }
  return result;
}
