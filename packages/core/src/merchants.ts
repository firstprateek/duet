/**
 * Merchant names and the starter pack of common US merchants. The pack gives a clean
 * display name and a likely category; our own rules and history always win over it.
 */

export interface KnownMerchant {
  /** Matched against the normalized description (upper case, single spaces). */
  pattern: string;
  name: string;
  categoryId: string;
  /** Short patterns only match whole words. */
  wholeWord?: boolean;
  tags?: Array<"music" | "video" | "news" | "cloud">;
}

const pack: Array<
  [pattern: string, name: string, categoryId: string, tags?: KnownMerchant["tags"]]
> = [
  // Groceries
  ["TRADER JOE", "Trader Joe's", "groceries"],
  ["WHOLEFDS", "Whole Foods", "groceries"],
  ["WHOLE FOODS", "Whole Foods", "groceries"],
  ["SAFEWAY", "Safeway", "groceries"],
  ["KROGER", "Kroger", "groceries"],
  ["COSTCO WHSE", "Costco", "groceries"],
  ["COSTCO GAS", "Costco Gas", "gas"],
  ["ALDI", "Aldi", "groceries"],
  ["PUBLIX", "Publix", "groceries"],
  ["WEGMANS", "Wegmans", "groceries"],
  ["H-E-B", "H-E-B", "groceries"],
  ["SPROUTS", "Sprouts", "groceries"],
  ["INSTACART", "Instacart", "groceries"],
  ["MARKET BASKET", "Market Basket", "groceries"],
  ["STOP & SHOP", "Stop & Shop", "groceries"],
  ["STOP&SHOP", "Stop & Shop", "groceries"],
  ["RALPHS", "Ralphs", "groceries"],
  ["VONS", "Vons", "groceries"],
  ["ALBERTSONS", "Albertsons", "groceries"],
  ["HARRIS TEETER", "Harris Teeter", "groceries"],
  ["MEIJER", "Meijer", "groceries"],
  ["FRED-MEYER", "Fred Meyer", "groceries"],
  ["FRED MEYER", "Fred Meyer", "groceries"],
  ["SHOPRITE", "ShopRite", "groceries"],
  ["HANNAFORD", "Hannaford", "groceries"],
  ["BERKELEY BOWL", "Berkeley Bowl", "groceries"],
  // Coffee
  ["STARBUCKS", "Starbucks", "coffee"],
  ["BLUE BOTTLE", "Blue Bottle Coffee", "coffee"],
  ["PEETS", "Peet's Coffee", "coffee"],
  ["PEET'S", "Peet's Coffee", "coffee"],
  ["DUNKIN", "Dunkin'", "coffee"],
  ["PHILZ", "Philz Coffee", "coffee"],
  ["DUTCH BROS", "Dutch Bros", "coffee"],
  // Dining out
  ["UBER EATS", "Uber Eats", "dining-out"],
  ["UBER *EATS", "Uber Eats", "dining-out"],
  ["UBEREATS", "Uber Eats", "dining-out"],
  ["DOORDASH", "DoorDash", "dining-out"],
  ["GRUBHUB", "Grubhub", "dining-out"],
  ["CHIPOTLE", "Chipotle", "dining-out"],
  ["SWEETGREEN", "Sweetgreen", "dining-out"],
  ["MCDONALD", "McDonald's", "dining-out"],
  ["CHICK-FIL-A", "Chick-fil-A", "dining-out"],
  ["PANERA", "Panera", "dining-out"],
  ["DOMINO", "Domino's", "dining-out"],
  ["PIZZA HUT", "Pizza Hut", "dining-out"],
  ["SHAKE SHACK", "Shake Shack", "dining-out"],
  ["TACO BELL", "Taco Bell", "dining-out"],
  ["IN-N-OUT", "In-N-Out", "dining-out"],
  ["CAVA", "Cava", "dining-out"],
  ["OLIVE GARDEN", "Olive Garden", "dining-out"],
  // Getting around
  ["UBER", "Uber", "rideshare"],
  ["LYFT", "Lyft", "rideshare"],
  ["SHELL OIL", "Shell", "gas"],
  ["SHELL SERVICE", "Shell", "gas"],
  ["CHEVRON", "Chevron", "gas"],
  ["EXXON", "Exxon", "gas"],
  ["MOBIL", "Mobil", "gas"],
  ["ARCO", "Arco", "gas"],
  ["SUNOCO", "Sunoco", "gas"],
  ["VALERO", "Valero", "gas"],
  ["CITGO", "Citgo", "gas"],
  ["SPEEDWAY", "Speedway", "gas"],
  ["WAWA", "Wawa", "gas"],
  ["TESLA SUPERCHARGER", "Tesla Supercharger", "gas"],
  ["CHARGEPOINT", "ChargePoint", "gas"],
  ["ELECTRIFY AMERICA", "Electrify America", "gas"],
  ["PARKMOBILE", "ParkMobile", "parking"],
  ["SPOTHERO", "SpotHero", "parking"],
  ["LAZ PARKING", "LAZ Parking", "parking"],
  ["FASTRAK", "FasTrak", "parking"],
  ["E-ZPASS", "E-ZPass", "parking"],
  ["EZPASS", "E-ZPass", "parking"],
  ["SUNPASS", "SunPass", "parking"],
  ["CLIPPER", "Clipper", "transit"],
  ["BART", "BART", "transit"],
  ["MBTA", "MBTA", "transit"],
  ["WMATA", "WMATA", "transit"],
  ["MTA", "MTA", "transit"],
  ["AMTRAK", "Amtrak", "transit"],
  // Travel
  ["ALASKA AIR", "Alaska Airlines", "flights"],
  ["DELTA AIR", "Delta", "flights"],
  ["UNITED AIRLINES", "United Airlines", "flights"],
  ["AMERICAN AIRLINES", "American Airlines", "flights"],
  ["AMERICAN AIR", "American Airlines", "flights"],
  ["SOUTHWEST", "Southwest", "flights"],
  ["JETBLUE", "JetBlue", "flights"],
  ["HAWAIIAN AIR", "Hawaiian Airlines", "flights"],
  ["FRONTIER AIR", "Frontier", "flights"],
  ["AIRBNB", "Airbnb", "stays"],
  ["VRBO", "Vrbo", "stays"],
  ["MARRIOTT", "Marriott", "stays"],
  ["HILTON", "Hilton", "stays"],
  ["HYATT", "Hyatt", "stays"],
  ["BOOKING.COM", "Booking.com", "stays"],
  ["HOTELS.COM", "Hotels.com", "stays"],
  ["EXPEDIA", "Expedia", "travel-other"],
  // Fun
  ["NETFLIX", "Netflix", "subscriptions", ["video"]],
  ["HULU", "Hulu", "subscriptions", ["video"]],
  ["DISNEY PLUS", "Disney+", "subscriptions", ["video"]],
  ["DISNEYPLUS", "Disney+", "subscriptions", ["video"]],
  ["HBO MAX", "Max", "subscriptions", ["video"]],
  ["MAX.COM", "Max", "subscriptions", ["video"]],
  ["PARAMOUNT+", "Paramount+", "subscriptions", ["video"]],
  ["PEACOCK", "Peacock", "subscriptions", ["video"]],
  ["YOUTUBE PREMIUM", "YouTube Premium", "subscriptions", ["video"]],
  ["GOOGLE *YOUTUBE", "YouTube Premium", "subscriptions", ["video"]],
  ["SPOTIFY", "Spotify", "subscriptions", ["music"]],
  ["APPLE MUSIC", "Apple Music", "subscriptions", ["music"]],
  ["TIDAL", "Tidal", "subscriptions", ["music"]],
  ["AUDIBLE", "Audible", "subscriptions"],
  ["NYTIMES", "New York Times", "subscriptions", ["news"]],
  ["NY TIMES", "New York Times", "subscriptions", ["news"]],
  ["PATREON", "Patreon", "subscriptions"],
  ["APPLE.COM/BILL", "Apple Services", "subscriptions", ["cloud"]],
  ["GOOGLE *STORAGE", "Google One", "subscriptions", ["cloud"]],
  ["DROPBOX", "Dropbox", "subscriptions", ["cloud"]],
  ["AMC ", "AMC Theatres", "entertainment"],
  ["REGAL", "Regal", "entertainment"],
  ["TICKETMASTER", "Ticketmaster", "entertainment"],
  ["STUBHUB", "StubHub", "entertainment"],
  ["EVENTBRITE", "Eventbrite", "entertainment"],
  ["FANDANGO", "Fandango", "entertainment"],
  // Home
  ["PGANDE", "PG&E", "utilities"],
  ["PG&E", "PG&E", "utilities"],
  ["CON ED", "Con Edison", "utilities"],
  ["CONED", "Con Edison", "utilities"],
  ["COMED", "ComEd", "utilities"],
  ["DUKE ENERGY", "Duke Energy", "utilities"],
  ["XCEL ENERGY", "Xcel Energy", "utilities"],
  ["SOCALGAS", "SoCalGas", "utilities"],
  ["NATIONAL GRID", "National Grid", "utilities"],
  ["EVERSOURCE", "Eversource", "utilities"],
  ["EBMUD", "EBMUD", "utilities"],
  ["COMCAST", "Xfinity", "internet-phone"],
  ["XFINITY", "Xfinity", "internet-phone"],
  ["VERIZON", "Verizon", "internet-phone"],
  ["AT&T", "AT&T", "internet-phone"],
  ["T-MOBILE", "T-Mobile", "internet-phone"],
  ["SPECTRUM", "Spectrum", "internet-phone"],
  ["GOOGLE *FI", "Google Fi", "internet-phone"],
  ["MINT MOBILE", "Mint Mobile", "internet-phone"],
  ["SONIC.NET", "Sonic", "internet-phone"],
  ["GEICO", "GEICO", "insurance"],
  ["STATE FARM", "State Farm", "insurance"],
  ["PROGRESSIVE", "Progressive", "insurance"],
  ["ALLSTATE", "Allstate", "insurance"],
  ["LEMONADE", "Lemonade", "insurance"],
  ["HOME DEPOT", "The Home Depot", "home-upkeep"],
  ["LOWE'S", "Lowe's", "home-upkeep"],
  ["LOWES", "Lowe's", "home-upkeep"],
  ["ACE HARDWARE", "Ace Hardware", "home-upkeep"],
  // Shopping
  ["AMZN", "Amazon", "household-goods"],
  ["AMAZON", "Amazon", "household-goods"],
  ["TARGET", "Target", "household-goods"],
  ["WALMART", "Walmart", "household-goods"],
  ["WAL-MART", "Walmart", "household-goods"],
  ["IKEA", "IKEA", "household-goods"],
  ["CRATE & BARREL", "Crate & Barrel", "household-goods"],
  ["WAYFAIR", "Wayfair", "household-goods"],
  ["ETSY", "Etsy", "household-goods"],
  ["EBAY", "eBay", "household-goods"],
  ["BEST BUY", "Best Buy", "electronics"],
  ["APPLE STORE", "Apple Store", "electronics"],
  ["UNIQLO", "Uniqlo", "clothes"],
  ["OLD NAVY", "Old Navy", "clothes"],
  ["GAP ", "Gap", "clothes"],
  ["NORDSTROM", "Nordstrom", "clothes"],
  ["MACY'S", "Macy's", "clothes"],
  ["MACYS", "Macy's", "clothes"],
  ["ZARA", "Zara", "clothes"],
  ["H&M", "H&M", "clothes"],
  ["J.CREW", "J.Crew", "clothes"],
  ["LULULEMON", "Lululemon", "clothes"],
  ["NIKE", "Nike", "clothes"],
  ["REI ", "REI", "hobbies"],
  // Health and care
  ["CVS", "CVS", "pharmacy"],
  ["WALGREENS", "Walgreens", "pharmacy"],
  ["RITE AID", "Rite Aid", "pharmacy"],
  ["PELOTON", "Peloton", "fitness"],
  ["EQUINOX", "Equinox", "fitness"],
  ["PLANET FITNESS", "Planet Fitness", "fitness"],
  ["CLASSPASS", "ClassPass", "fitness"],
  ["ORANGETHEORY", "Orangetheory", "fitness"],
  ["GREAT CLIPS", "Great Clips", "hair-beauty"],
  ["SUPERCUTS", "Supercuts", "hair-beauty"],
  ["ULTA", "Ulta", "hair-beauty"],
  ["SEPHORA", "Sephora", "hair-beauty"],
  // Other
  ["PETCO", "Petco", "pets"],
  ["PETSMART", "PetSmart", "pets"],
  ["CHEWY", "Chewy", "pets"],
  ["GOFUNDME", "GoFundMe", "giving"],
  ["INTEREST CHARGE", "Interest", "fees"],
  ["LATE FEE", "Late fee", "fees"],
  ["ANNUAL FEE", "Annual fee", "fees"],
  ["FOREIGN TRANSACTION FEE", "Foreign transaction fee", "fees"],
];

/** Patterns that also appear inside ordinary words ("MOBILE", "COMEDY"). */
const WHOLE_WORD = new Set(["MOBIL", "COMED", "PEETS", "REGAL", "TIDAL", "CHEWY", "ARCO", "SHELL"]);

/** Longest pattern first, so "UBER EATS" wins over "UBER". */
export const KNOWN_MERCHANTS: KnownMerchant[] = pack
  .map(([pattern, name, categoryId, tags]) => {
    const merchant: KnownMerchant = { pattern, name, categoryId };
    if (pattern.replace(/[^A-Z0-9]/g, "").length <= 4 || WHOLE_WORD.has(pattern)) {
      merchant.wholeWord = true;
    }
    if (tags) merchant.tags = tags;
    return merchant;
  })
  .sort((a, b) => b.pattern.length - a.pattern.length);

/** Upper case, one space between words; keeps & and ' because merchants use them. */
export function normalizeText(text: string): string {
  return text.toUpperCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesPattern(normalized: string, pattern: string, wholeWord = false): boolean {
  if (!wholeWord) return normalized.includes(pattern);
  const trimmed = pattern.trim();
  return new RegExp(`(^|[^A-Z0-9])${escapeRegex(trimmed)}($|[^A-Z0-9])`).test(normalized);
}

export function findKnownMerchant(description: string): KnownMerchant | undefined {
  const d = ` ${normalizeText(description)} `;
  return KNOWN_MERCHANTS.find((m) => matchesPattern(d, m.pattern, m.wholeWord));
}

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  ),
);

const PREFIXES = [
  /^SQ \*/,
  /^TST\* ?/,
  /^SP \* ?/,
  /^PY \*/,
  /^PAYPAL \*/,
  /^PP\*/,
  /^GOOGLE \*/,
  /^CKE\*/,
  /^IN \*/,
  /^POS (DEBIT |PURCHASE )?/,
  /^DEBIT CARD PURCHASE /,
  /^PURCHASE AUTHORIZED ON \d\d\/\d\d /,
  /^CHECKCARD \d{4} /,
  /^RECURRING PAYMENT AUTHORIZED ON \d\d\/\d\d /,
];

const SMALL_WORDS = new Set(["AND", "OF", "THE", "AT", "IN", "ON", "FOR"]);

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w.toUpperCase())) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/'S\b/g, "'s");
}

/**
 * A readable merchant name from a raw bank description:
 * "TRADER JOE S #552 OAKLAND CA" → "Trader Joe's", "SQ *BLUE BOTTLE COFFE 0423" → "Blue
 * Bottle Coffee". Known merchants get their proper name; the rest are tidied by rule.
 */
export function cleanMerchant(description: string): string {
  const known = findKnownMerchant(description);
  if (known) return known.name;
  let s = normalizeText(description);
  for (const p of PREFIXES) s = s.replace(p, "");
  s = s.replace(/\s+\d{3}-\d{3}-\d{4}\b.*$/, ""); // phone numbers and what follows
  s = s.replace(/\s+[A-Z0-9.-]+\.(COM|NET|ORG)(\/\S*)?.*$/, ""); // "AMZN.COM/BILL WA"
  s = s.replace(/\s+#?\d{3,}.*$/, ""); // store numbers and what follows
  s = s.replace(/\s+#\d+.*$/, "");
  const words = s.split(" ");
  if (words.length > 1 && US_STATES.has(words[words.length - 1]!)) words.pop();
  s = words.join(" ").replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
  if (s === "") return titleCase(normalizeText(description)).slice(0, 40);
  return titleCase(s).slice(0, 40);
}

/** Merchant identity for matching history and refunds: known name, else the cleaned name. */
export function merchantKey(description: string): string {
  return normalizeText(cleanMerchant(description)).replace(/[^A-Z0-9&]/g, "");
}
