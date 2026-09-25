/**
 * Reading amounts and dates the way US banks write them. Amounts become integer cents;
 * dates become plain "yyyy-MM-dd" strings with no time zone.
 */

export type Cents = number;
export type ISODate = string;

export type DateFormat =
  | "auto"
  | "MM/dd/yyyy"
  | "M/d/yyyy"
  | "MM/dd/yy"
  | "yyyy-MM-dd"
  | "yyyyMMdd"
  | "dd/MM/yyyy";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Rounds halves away from zero (2.5 → 3, −2.5 → −3). */
export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * "$1,234.56", "(12.34)", "-5", "12.34-", "−$2,340.18", "45.00 CR" → cents.
 * Numbers (from spreadsheets) are dollars. Anything else → null.
 */
export function parseCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return roundHalfAwayFromZero(Math.round(input * 1000) / 10);
  }
  let s = input.trim().replace(/−/g, "-");
  if (s === "") return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const trailing = s.match(/\s*(-|CR|DR)$/i);
  if (trailing?.[1]) {
    const mark = trailing[1].toUpperCase();
    if (mark === "-" || mark === "CR") negative = !negative;
    s = s.slice(0, s.length - trailing[0].length).trim();
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith("$")) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;

  const [whole = "0", fraction = ""] = s.split(".");
  const padded = (fraction + "000").slice(0, 3);
  let cents = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "yyyy-MM-dd", or null when the day doesn't exist (Feb 30). */
export function makeDate(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return makeDate(y, m, d) === value;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function monthFromName(name: string): number | null {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i === -1 ? null : i + 1;
}

/** Days since 1899-12-30, the way spreadsheets count. */
export function excelSerialToDate(serial: number): ISODate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 200000) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * With "auto": slashes are month first (US), eight leading digits are OFX (yyyyMMdd, the
 * time after them is ignored), and month names work ("Aug 28, 2026", "28 Aug 2026").
 */
export function parseDate(
  input: string | number | Date,
  format: DateFormat = "auto",
): ISODate | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return makeDate(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  if (typeof input === "number") return excelSerialToDate(input);
  const s = input.trim();
  if (s === "") return null;

  if (format === "dd/MM/yyyy") {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    return m ? makeDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1])) : null;
  }

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) return makeDate(fullYear(Number(m[3])), Number(m[1]), Number(m[2]));

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = monthFromName(m[1]!);
    return month ? makeDate(Number(m[3]), month, Number(m[2])) : null;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{2}|\d{4})$/);
  if (m) {
    const month = monthFromName(m[2]!);
    return month ? makeDate(fullYear(Number(m[3])), month, Number(m[1])) : null;
  }
  return null;
}
