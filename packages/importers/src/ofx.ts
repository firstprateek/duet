import { guessKind } from "./kinds.ts";
import type { AccountKind, ParsedRow, ParsedStatement, RowKind } from "./types.ts";
import { parseCents, parseDate } from "./values.ts";

/**
 * Reads OFX and QFX, both the old SGML form (unclosed tags) and OFX 2 (XML). Only the
 * pieces Duet needs: the institution, the account, and each <STMTTRN>.
 */

interface OfxTransaction {
  type: string;
  posted: string;
  amount: string;
  fitId: string;
  name: string;
  memo: string;
}

/** Institution names from the <ORG> tag, which banks fill in their own way. */
const ORG_NAMES: Array<[RegExp, string]> = [
  [/amex|american express/i, "American Express"],
  [/^c1$|capital\s*one/i, "Capital One"],
  [/discover/i, "Discover"],
  [/^b1$|chase/i, "Chase"],
  [/citi/i, "Citi"],
  [/dcu|digital federal/i, "DCU"],
  [/^wf$|wells/i, "Wells Fargo"],
  [/^han$|bank of america|bofa/i, "Bank of America"],
  [/apple|goldman/i, "Apple Card"],
  [/bread|comenity/i, "Bread Cashback"],
];

/** Some banks leave <ORG> vague; their FID is stable. */
const FID_NAMES: Record<string, string> = {
  "3101": "American Express",
  "7101": "Discover",
  "10898": "Chase",
  "24909": "Citi",
  "3000": "Wells Fargo",
  "5959": "Bank of America",
};

function tagValue(block: string, tag: string): string {
  // Works for both <TAG>value</TAG> (XML) and <TAG>value (SGML, ends at the next tag or line).
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m?.[1] ? decodeEntities(m[1].trim()) : "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function blocks(text: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}>`, "gi");
  let m: RegExpExecArray | null = open.exec(text);
  while (m) {
    const start = m.index + m[0].length;
    const closeRe = new RegExp(`</${tag}>|<${tag}>`, "gi");
    closeRe.lastIndex = start;
    const close = closeRe.exec(text);
    const end = close ? close.index : text.length;
    out.push(text.slice(start, end));
    open.lastIndex = end;
    m = open.exec(text);
  }
  return out;
}

export function isOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>") || head.includes("<?OFX");
}

function institutionFrom(text: string): string | null {
  const fi = blocks(text, "FI")[0] ?? "";
  const org = tagValue(fi, "ORG") || tagValue(text, "ORG");
  const fid = tagValue(fi, "FID") || tagValue(text, "FID") || tagValue(text, "INTU.BID");
  for (const [re, name] of ORG_NAMES) if (org && re.test(org)) return name;
  if (fid && FID_NAMES[fid]) return FID_NAMES[fid];
  return org || null;
}

function kindFromType(
  type: string,
  amount: number,
  description: string,
  accountKind: AccountKind,
): RowKind {
  const t = type.toUpperCase();
  if (t === "INT") return amount >= 0 ? "interest" : "refund";
  if (t === "FEE" || t === "SRVCHG") return "fee";
  if (t === "PAYMENT" && accountKind === "credit" && amount < 0) return "payment";
  if (t === "XFER") return "transfer";
  return guessKind(description, amount, accountKind);
}

export function readOfx(text: string): ParsedStatement {
  const warnings: string[] = [];
  const isCard = /<CCSTMTRS>|<CCACCTFROM>/i.test(text);
  const bankAcct = blocks(text, "BANKACCTFROM")[0] ?? "";
  const cardAcct = blocks(text, "CCACCTFROM")[0] ?? "";
  const acctType = tagValue(bankAcct, "ACCTTYPE").toUpperCase();
  const accountKind: AccountKind = isCard
    ? "credit"
    : acctType === "SAVINGS"
      ? "savings"
      : "checking";
  const acctId = tagValue(isCard ? cardAcct : bankAcct, "ACCTID");
  const digits = acctId.replace(/\D/g, "");

  const txns: OfxTransaction[] = blocks(text, "STMTTRN").map((b) => ({
    type: tagValue(b, "TRNTYPE"),
    posted: tagValue(b, "DTPOSTED"),
    amount: tagValue(b, "TRNAMT"),
    fitId: tagValue(b, "FITID"),
    name: tagValue(b, "NAME"),
    memo: tagValue(b, "MEMO"),
  }));

  const rows: ParsedRow[] = [];
  let skipped = 0;
  txns.forEach((t, index) => {
    const date = parseDate(t.posted);
    const raw = parseCents(t.amount);
    const description = [t.name, t.memo && t.memo !== t.name ? t.memo : ""]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!date || raw === null || !description) {
      skipped++;
      return;
    }
    // In OFX, money leaving the account is negative for banks and cards alike.
    const amount = -raw;
    const row: ParsedRow = {
      index,
      date,
      amount,
      description,
      kind: kindFromType(t.type, amount, description, accountKind),
    };
    if (t.fitId) row.bankId = t.fitId;
    rows.push(row);
  });
  if (txns.length === 0) warnings.push("No transactions were found in this file.");

  const dates = rows.map((r) => r.date).sort();
  const result: ParsedStatement = {
    format: "ofx",
    profileId: "ofx",
    institution: institutionFrom(text),
    accountKind,
    rows,
    skipped,
    headers: [],
    sample: [],
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    warnings,
  };
  if (digits.length >= 4) result.accountLast4 = digits.slice(-4);
  return result;
}
