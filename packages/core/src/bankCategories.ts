/**
 * Maps a bank's own category label ("Food & Drink", "Merchandise & Supplies-Groceries",
 * "Gas/Automotive") to ours. Keywords are checked in order, so more specific ones come
 * first. Works across banks because their labels share vocabulary.
 */
const RULES: Array<[RegExp, string]> = [
  [/grocer|supermarket/i, "groceries"],
  [/coffee/i, "coffee"],
  [/restaurant|dining|food ?& ?drink|fast food/i, "dining-out"],
  [/airline|airfare|flight/i, "flights"],
  [/lodging|hotel|motel/i, "stays"],
  [/fuel|gasoline|gas station|^gas$|gas\/automotive/i, "gas"],
  [/taxi|rideshare|ride share|limo/i, "rideshare"],
  [/parking|toll/i, "parking"],
  [/transit|rail|commut|transportation/i, "transit"],
  [/pharmac|drug ?store/i, "pharmacy"],
  [/health|medical|doctor|dental|hospital/i, "doctor"],
  [/gym|fitness|sport/i, "fitness"],
  [/cable|internet|phone|communications/i, "internet-phone"],
  [/utilit|electric|water/i, "utilities"],
  [/insurance/i, "insurance"],
  [/home improvement|hardware|home$/i, "home-upkeep"],
  [/cloth|apparel|department store/i, "clothes"],
  [/electronic|computer/i, "electronics"],
  [/entertainment|movie|theat|music|event/i, "entertainment"],
  [/subscription|streaming/i, "subscriptions"],
  [/travel/i, "travel-other"],
  [/automotive|auto service|car wash/i, "car"],
  [/gift|donation|charit/i, "gifts-given"],
  [/education|tuition|book/i, "education"],
  [/pet/i, "pets"],
  [/personal care|salon|beauty|barber/i, "hair-beauty"],
  [/fee|interest|adjustment/i, "fees"],
  [/merchandise|shopping|internet purchase|general retail|online/i, "household-goods"],
];

export function mapBankCategory(label: string | undefined | null): string | null {
  if (!label) return null;
  const text = label.trim();
  if (!text) return null;
  for (const [re, categoryId] of RULES) if (re.test(text)) return categoryId;
  return null;
}
