import type { AccountKind, KindLabels, RowKind } from "./types.ts";

/**
 * Lines that pay a card off. On a card they bring the balance down; on checking they are
 * the matching debit. Either way they are transfers, not spending.
 */
const PAYMENT_PATTERNS = [
  /\bAUTO ?PAY(MENT)?\b/,
  /\bPAYMENT\s*-?\s*THANK YOU\b/,
  /\bTHANK YOU FOR YOUR PAYMENT\b/,
  /\bONLINE PAYMENT\b/,
  /\bMOBILE PAYMENT\b/,
  /\bPAYMENT RECEIVED\b/,
  /\bE-?PAYMENT\b/,
  /\bEPAY\b/,
  /\bONLINE PMT\b/,
  /\bCRCARDPMT\b/,
  /\bCARD PMT\b/,
  /\bCREDIT CA?R?D (PMT|PAYMENT|AUTOPAY|AUTO PAY)\b/,
  /\bCREDIT CRD\b/,
  /\bDIRECTPAY\b/,
  /\bAPPLECARD GSBANK\b/,
  /\bACH PMT\b/,
  /\bBANK TRANSFER PAYMENT\b/,
  /\bPYMT\b/,
];

const FEE_PATTERNS = [
  /\b(LATE|ANNUAL|FOREIGN TRANSACTION|OVERDRAFT|RETURNED PAYMENT|MONTHLY SERVICE) FEE\b/,
];
const INTEREST_PATTERNS = [/\bINTEREST CHARGE/, /\bPURCHASE INTEREST\b/, /\bINTEREST PAID\b/];
const TRANSFER_PATTERNS = [
  /\b(ONLINE |MOBILE |INTERNET )?TRANSFER (TO|FROM)\b/,
  /\bONLINE TRANSFER\b/,
  /\bXFER\b/,
  /\bRECURRING TRANSFER\b/,
];

export function looksLikePayment(description: string): boolean {
  const d = description.toUpperCase();
  return PAYMENT_PATTERNS.some((p) => p.test(d));
}

export function looksLikeTransfer(description: string): boolean {
  const d = description.toUpperCase();
  return TRANSFER_PATTERNS.some((p) => p.test(d));
}

/**
 * Works out what a row is from its sign and words, when the bank doesn't say.
 * `amount` is already spending-positive.
 */
export function guessKind(description: string, amount: number, accountKind: AccountKind): RowKind {
  const d = description.toUpperCase();
  if (INTEREST_PATTERNS.some((p) => p.test(d))) return amount >= 0 ? "interest" : "refund";
  if (FEE_PATTERNS.some((p) => p.test(d)) && amount > 0) return "fee";
  if (looksLikePayment(d)) return "payment";
  if (looksLikeTransfer(d)) return "transfer";
  if (amount >= 0) return "purchase";
  return accountKind === "credit" ? "refund" : "deposit";
}

/** Matches a bank's own type label ("Sale", "Return", "Payment") against a profile's lists. */
export function kindFromLabel(label: string, lists: KindLabels): RowKind | null {
  const l = label.trim().toLowerCase();
  if (!l) return null;
  for (const [kind, values] of Object.entries(lists) as Array<[RowKind, unknown]>) {
    if (Array.isArray(values) && values.some((v) => String(v).toLowerCase() === l)) return kind;
  }
  return null;
}
