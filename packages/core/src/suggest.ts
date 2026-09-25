import { mapBankCategory } from "./bankCategories.ts";
import type { Category } from "./categories.ts";
import { findKnownMerchant, merchantKey } from "./merchants.ts";
import { findRule, type Rule } from "./rules.ts";
import type { Share } from "./words.ts";

/**
 * The first tiers of sorting, all on this Mac: our rules, our own history, the starter
 * merchant pack and the bank's category. The Mac mini tiers (embeddings, Laya, the LLM)
 * refine what's left in M4. Every suggestion says why, in words like the mocks:
 * "The last 12 Blue Bottle visits were Coffee, and all of them were just for you."
 */

/** Where a category came from. "you" means we picked it ourselves. */
export type Tier = "rule" | "refund" | "history" | "pack" | "bank" | "model" | "you" | "none";

export interface Alternative {
  categoryId: string;
  confidence: number;
}

export interface Suggestion {
  categoryId: string | null;
  confidence: number;
  tier: Tier;
  alternatives: Alternative[];
  share: Share;
  why: string;
}

/** What we've decided before for one merchant. */
export interface MerchantHistory {
  categories: Map<string, number>;
  ours: number;
  mine: number;
  total: number;
}

export type HistoryIndex = Map<string, MerchantHistory>;

export function buildHistory(
  items: Iterable<{ description: string; categoryId: string | null; share: Share }>,
): HistoryIndex {
  const index: HistoryIndex = new Map();
  for (const item of items) {
    const key = merchantKey(item.description);
    if (!key) continue;
    let h = index.get(key);
    if (!h) {
      h = { categories: new Map(), ours: 0, mine: 0, total: 0 };
      index.set(key, h);
    }
    h.total += 1;
    if (item.share === "ours") h.ours += 1;
    else h.mine += 1;
    if (item.categoryId)
      h.categories.set(item.categoryId, (h.categories.get(item.categoryId) ?? 0) + 1);
  }
  return index;
}

/** Confidence at which a row shows plainly; below `UNSURE` it is highlighted. */
export const SURE = 0.85;
export const UNSURE = 0.6;

export type Level = "sure" | "maybe" | "unsure";

export function levelOf(confidence: number): Level {
  if (confidence >= SURE) return "sure";
  if (confidence >= UNSURE) return "maybe";
  return "unsure";
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function times(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${NUMBER_WORDS[n] ?? String(n)} times`;
}

function shareClause(share: Share | null, style: "rule" | "all" | "usually"): string {
  if (!share) return "";
  if (style === "rule") return share === "ours" ? ", for both of you" : ", just for you";
  if (style === "all")
    return share === "ours"
      ? ", and all of them were for both of you"
      : ", and all of them were just for you";
  return share === "ours" ? ", and usually for both of you" : ", and usually just for you";
}

export interface SuggestInput {
  description: string;
  merchant: string;
  bankCategory?: string | undefined;
  accountDefault: Share;
}

export interface SuggestContext {
  rules: readonly Rule[];
  history: HistoryIndex;
  categories: readonly Category[];
}

export function suggest(input: SuggestInput, ctx: SuggestContext): Suggestion {
  const name = (id: string | null) =>
    ctx.categories.find((c) => c.id === id)?.name ?? "Something else";
  const merchant = input.merchant;

  const rule = findRule(ctx.rules, input.description, merchant);
  if (rule?.categoryId) {
    const share = rule.share ?? input.accountDefault;
    return {
      categoryId: rule.categoryId,
      confidence: 1,
      tier: "rule",
      alternatives: [{ categoryId: rule.categoryId, confidence: 1 }],
      share,
      why: `Your rule says ${merchant} is always ${name(rule.categoryId)}${shareClause(rule.share, "rule")}.`,
    };
  }

  const history = ctx.history.get(merchantKey(input.description));
  const historyShare: Share | null = history
    ? history.ours > history.mine
      ? "ours"
      : history.mine > history.ours
        ? "mine"
        : null
    : null;
  const share: Share = rule?.share ?? historyShare ?? input.accountDefault;
  const allSame = history
    ? history.ours === history.total || history.mine === history.total
    : false;

  if (history && history.categories.size > 0) {
    const ranked = [...history.categories.entries()].sort((a, b) => b[1] - a[1]);
    const categorized = ranked.reduce((s, [, n]) => s + n, 0);
    const alternatives = ranked.slice(0, 3).map(([categoryId, n]) => ({
      categoryId,
      confidence: (n + 1) / (categorized + 2),
    }));
    const [topId, topCount] = ranked[0]!;
    const confidence = alternatives[0]!.confidence;
    let why: string;
    if (confidence < UNSURE && ranked.length > 1) {
      const parts = ranked.slice(0, 2).map(([id, n]) => `${name(id)} ${times(n)}`);
      why = `Not sure about this one. Past ${merchant} purchases were ${parts.join(" and ")}.`;
    } else if (topCount === categorized && categorized > 1) {
      why = `The last ${categorized} ${merchant} visits were ${name(topId)}${shareClause(historyShare, allSame ? "all" : "usually")}.`;
    } else if (categorized === 1) {
      why = `Last time, ${merchant} was ${name(topId)}${historyShare ? (historyShare === "ours" ? ", for both of you" : ", just for you") : ""}.`;
    } else {
      why = `${merchant} is usually ${name(topId)}${shareClause(historyShare, "usually")}.`;
    }
    return { categoryId: topId, confidence, tier: "history", alternatives, share, why };
  }

  const known =
    findKnownMerchant(input.description) ?? (merchant ? findKnownMerchant(merchant) : undefined);
  const bank = mapBankCategory(input.bankCategory);
  if (known) {
    const agrees = bank === known.categoryId;
    const confidence = agrees ? 0.93 : 0.88;
    const alternatives: Alternative[] = [{ categoryId: known.categoryId, confidence }];
    if (bank && !agrees) alternatives.push({ categoryId: bank, confidence: 0.3 });
    return {
      categoryId: known.categoryId,
      confidence,
      tier: "pack",
      alternatives,
      share,
      why: `${known.name} is usually ${name(known.categoryId)}.`,
    };
  }
  if (bank) {
    return {
      categoryId: bank,
      confidence: 0.7,
      tier: "bank",
      alternatives: [{ categoryId: bank, confidence: 0.7 }],
      share,
      why: `Your bank calls this "${input.bankCategory}", so ${name(bank)}.`,
    };
  }
  return {
    categoryId: null,
    confidence: 0,
    tier: "none",
    alternatives: [],
    share,
    why: "Not sure about this one. Pick a category and Duet will remember it next time.",
  };
}
