import { matchesPattern, normalizeText } from "./merchants.ts";
import type { Share } from "./words.ts";

/**
 * Rules we confirmed: "Trader Joe's is always Groceries, for both of you". Household
 * rules sync; personal rules (learned from Mine) stay on their owner's Mac because they
 * would reveal merchants.
 */
export interface Rule {
  id: string;
  match: "contains" | "exact" | "pattern";
  pattern: string;
  categoryId: string | null;
  share: Share | null;
  scope: "household" | "personal";
}

function ruleMatches(rule: Rule, description: string, merchant: string): boolean {
  const d = normalizeText(description);
  const m = normalizeText(merchant);
  const p = normalizeText(rule.pattern);
  if (!p) return false;
  switch (rule.match) {
    case "exact":
      return d === p || m === p;
    case "contains":
      return matchesPattern(` ${d} `, p) || matchesPattern(` ${m} `, p);
    case "pattern": {
      try {
        const re = new RegExp(rule.pattern, "i");
        return re.test(description) || re.test(merchant);
      } catch {
        return false;
      }
    }
  }
}

/**
 * The rule that applies to a transaction, if any. Personal rules come first (they are the
 * owner's own), then exact matches, then the longest pattern.
 */
export function findRule(
  rules: readonly Rule[],
  description: string,
  merchant: string,
): Rule | null {
  const matching = rules.filter((r) => ruleMatches(r, description, merchant));
  if (matching.length === 0) return null;
  const rank = (r: Rule) =>
    (r.scope === "personal" ? 1000 : 0) + (r.match === "exact" ? 500 : 0) + r.pattern.length;
  return matching.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** A contains-rule built from a merchant name, for "Always do this". */
export function ruleFromMerchant(
  merchant: string,
  categoryId: string | null,
  share: Share | null,
  scope: Rule["scope"],
  id: string,
): Rule {
  return { id, match: "contains", pattern: normalizeText(merchant), categoryId, share, scope };
}
