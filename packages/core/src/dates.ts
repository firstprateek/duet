/**
 * Dates are plain calendar dates ("2026-08-28") with no time zone, and months are
 * "2026-08" keys. Arithmetic runs in UTC so a date never shifts by a day.
 */
import { makeDate } from "@duet/importers/values";

export {
  type DateFormat,
  excelSerialToDate,
  isISODate,
  makeDate,
  parseDate,
} from "@duet/importers/values";

export type ISODate = string;
export type MonthKey = string;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toUTC(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(t: Date): ISODate {
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const t = toUTC(date);
  t.setUTCDate(t.getUTCDate() + days);
  return fromUTC(t);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}

export function monthOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(month: MonthKey, count: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Months from `from` to `to`, both included. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The `count` months ending with `month` (oldest first). */
export function lastMonths(month: MonthKey, count: number): MonthKey[] {
  return monthRange(addMonths(month, -(count - 1)), month);
}

export function firstDayOf(month: MonthKey): ISODate {
  return `${month}-01`;
}

export function lastDayOf(month: MonthKey): ISODate {
  return addDays(firstDayOf(addMonths(month, 1)), -1);
}

/** "August" or "August 2026". */
export function monthName(month: MonthKey, withYear = false): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = MONTH_NAMES[m - 1] ?? "";
  return withYear ? `${name} ${y}` : name;
}

/** "Aug" */
export function monthShort(month: MonthKey): string {
  const m = Number(month.slice(5, 7));
  return MONTH_SHORT[m - 1] ?? "";
}

/** "Aug 28" */
export function dayLabel(date: ISODate): string {
  return `${monthShort(monthOf(date))} ${Number(date.slice(8, 10))}`;
}

/** "Aug 28, 2026" */
export function dayLabelWithYear(date: ISODate): string {
  return `${dayLabel(date)}, ${date.slice(0, 4)}`;
}

/** "Tue, Sep 22" */
export function weekdayLabel(date: ISODate): string {
  const day = WEEKDAYS[toUTC(date).getUTCDay()] ?? "";
  return `${day.charAt(0).toUpperCase()}${day.slice(1, 3)}, ${dayLabel(date)}`;
}

export function weekdayIndex(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

/** Today's calendar date on this computer. */
export function today(now: Date = new Date()): ISODate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
}

export function currentMonth(now: Date = new Date()): MonthKey {
  return monthOf(today(now));
}

/** Resolves "today", "yesterday", "friday", "last friday" against a reference date. */
export function relativeDay(word: string, reference: ISODate): ISODate | null {
  const w = word.trim().toLowerCase();
  if (w === "today") return reference;
  if (w === "yesterday") return addDays(reference, -1);
  const named = w.replace(/^last\s+/, "");
  const index = WEEKDAYS.findIndex((d) => d === named || d.slice(0, 3) === named);
  if (index === -1) return null;
  let back = (weekdayIndex(reference) - index + 7) % 7;
  if (back === 0) back = 7;
  return addDays(reference, -back);
}

export { WEEKDAYS };
