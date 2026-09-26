import { guessKind, kindFromLabel } from "./kinds.ts";
import { PROFILES } from "./profiles.ts";
import type {
  AccountKind,
  BankProfile,
  ColumnMapping,
  FileFormat,
  ParsedRow,
  ParsedStatement,
} from "./types.ts";
import { type DateFormat, parseCents, parseDate } from "./values.ts";

/** A spreadsheet or CSV cell: text, a number, or a date (from XLSX). */
export type Cell = string | number | Date | boolean | null | undefined;
export type Grid = Cell[][];

const HEADER_SEARCH_ROWS = 25;
const SAMPLE_ROWS = 5;

export function normalizeHeader(value: Cell): string {
  return cellText(value).replace(/^﻿/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return parseDate(value) ?? "";
  return String(value).trim();
}

function isBlankRow(row: Cell[] | undefined): boolean {
  return !row || row.every((c) => cellText(c) === "");
}

interface Detection {
  profile: BankProfile;
  headerRow: number | null;
}

/** Finds the profile whose header signature appears in the first rows of the grid. */
export function detectProfile(
  grid: Grid,
  profiles: readonly BankProfile[] = PROFILES,
): Detection | null {
  let best: { detection: Detection; score: number } | null = null;
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const headers = new Set((grid[r] ?? []).map(normalizeHeader));
    if (headers.size === 0) continue;
    for (const profile of profiles) {
      const signature = profile.detect.headers.map((h) => h.toLowerCase());
      if (signature.length === 0) continue;
      if (!signature.every((h) => headers.has(h))) continue;
      const score = signature.length * 10 + (profile.priority ?? 0);
      if (!best || score > best.score) best = { detection: { profile, headerRow: r }, score };
    }
    if (best) return best.detection;
  }
  for (const profile of profiles) {
    if (profile.columns && looksHeaderless(grid, profile)) return { profile, headerRow: null };
  }
  return null;
}

/** Headerless exports (Wells Fargo) are recognized by the shape of their first rows. */
function looksHeaderless(grid: Grid, profile: BankProfile): boolean {
  const columns = profile.columns ?? [];
  const rows = grid.filter((r) => !isBlankRow(r)).slice(0, 3);
  if (rows.length === 0) return false;
  const dateIndex = columns.indexOf(profile.date.column);
  const amountColumn = "column" in profile.amount ? profile.amount.column : null;
  const amountIndex = amountColumn ? columns.indexOf(amountColumn) : -1;
  return rows.every((row) => {
    if (row.length !== columns.length) return false;
    const dateOk = dateIndex >= 0 && parseDate(toDateInput(row[dateIndex])) !== null;
    const amountOk = amountIndex >= 0 && parseCents(toAmountInput(row[amountIndex])) !== null;
    const starIndex = columns.indexOf("Star");
    const starOk = starIndex === -1 || cellText(row[starIndex]) === "*";
    return dateOk && amountOk && starOk;
  });
}

function toAmountInput(value: Cell): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date || typeof value === "boolean") return null;
  return value;
}

function toDateInput(value: Cell): string | number | Date {
  if (value instanceof Date || typeof value === "number") return value;
  return cellText(value);
}

function last4(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

interface ColumnPlan {
  date: number;
  dateFormat: DateFormat;
  description: number[];
  merchant: number;
  amount:
    | { single: number; spendingIs: "positive" | "negative" }
    | { debit: number; credit: number };
  bankCategory: number;
  kind: number;
  status: number;
  cardNumber: number;
  person: number;
}

function planFromProfile(profile: BankProfile, headerNames: string[]): ColumnPlan | string {
  const find = (name: string | undefined): number =>
    name === undefined ? -1 : headerNames.indexOf(name.toLowerCase());
  const require = (name: string): number | string => {
    const i = find(name);
    return i === -1 ? `Missing the "${name}" column` : i;
  };
  const date = require(profile.date.column);
  if (typeof date === "string") return date;
  const descriptionNames = Array.isArray(profile.description)
    ? profile.description
    : [profile.description];
  const description: number[] = [];
  for (const name of descriptionNames) {
    const i = require(name);
    if (typeof i === "string") return i;
    description.push(i);
  }
  let amount: ColumnPlan["amount"];
  if ("column" in profile.amount) {
    const i = require(profile.amount.column);
    if (typeof i === "string") return i;
    amount = { single: i, spendingIs: profile.amount.spendingIs };
  } else {
    const debit = require(profile.amount.debit);
    const credit = require(profile.amount.credit);
    if (typeof debit === "string") return debit;
    if (typeof credit === "string") return credit;
    amount = { debit, credit };
  }
  return {
    date,
    dateFormat: profile.date.format ?? "auto",
    description,
    merchant: find(profile.merchant),
    amount,
    bankCategory: find(profile.bankCategory),
    kind: find(profile.kind?.column),
    status: find(profile.status?.column),
    cardNumber: find(profile.cardNumber),
    person: find(profile.person),
  };
}

function planFromMapping(mapping: ColumnMapping): ColumnPlan {
  return {
    date: mapping.date,
    dateFormat: mapping.dateFormat ?? "auto",
    description: [mapping.description],
    merchant: -1,
    amount:
      "column" in mapping.amount
        ? { single: mapping.amount.column, spendingIs: mapping.amount.spendingIs }
        : { debit: mapping.amount.debit, credit: mapping.amount.credit },
    bankCategory: mapping.bankCategory ?? -1,
    kind: -1,
    status: -1,
    cardNumber: -1,
    person: -1,
  };
}

function readRows(
  grid: Grid,
  startRow: number,
  plan: ColumnPlan,
  accountKind: AccountKind,
  profile: BankProfile | null,
): { rows: ParsedRow[]; skipped: number; last4Seen: Map<string, number> } {
  const rows: ParsedRow[] = [];
  const last4Seen = new Map<string, number>();
  let skipped = 0;
  for (let r = startRow; r < grid.length; r++) {
    const row = grid[r];
    if (isBlankRow(row)) continue;
    const cell = (i: number): Cell => (i >= 0 ? row![i] : undefined);

    if (plan.status >= 0 && profile?.status) {
      const status = cellText(cell(plan.status)).toLowerCase();
      if (profile.status.skip.some((s) => s.toLowerCase() === status)) {
        skipped++;
        continue;
      }
    }
    const date =
      parseDate(toDateInput(cell(plan.date)), plan.dateFormat) ??
      parseDate(toDateInput(cell(plan.date)));
    let amount: number | null;
    if ("single" in plan.amount) {
      const raw = parseCents(toAmountInput(cell(plan.amount.single)));
      amount = raw === null ? null : plan.amount.spendingIs === "positive" ? raw : -raw;
    } else {
      const debit = parseCents(toAmountInput(cell(plan.amount.debit)));
      const credit = parseCents(toAmountInput(cell(plan.amount.credit)));
      if (debit !== null && debit !== 0) amount = Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = -Math.abs(credit);
      else amount = debit ?? credit;
    }
    const description = plan.description
      .map((i) => cellText(cell(i)))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!date || amount === null || description === "") {
      skipped++;
      continue;
    }
    if (/^beginning balance|^ending balance/i.test(description)) {
      skipped++;
      continue;
    }
    const label = plan.kind >= 0 ? cellText(cell(plan.kind)) : "";
    const kind =
      (profile?.kind && label ? kindFromLabel(label, profile.kind) : null) ??
      guessKind(description, amount, accountKind);
    const parsed: ParsedRow = { index: r, date, amount, description, kind };
    const merchant = plan.merchant >= 0 ? cellText(cell(plan.merchant)) : "";
    if (merchant) parsed.merchant = merchant;
    const bankCategory = plan.bankCategory >= 0 ? cellText(cell(plan.bankCategory)) : "";
    if (bankCategory) parsed.bankCategory = bankCategory;
    const person = plan.person >= 0 ? cellText(cell(plan.person)) : "";
    if (person) parsed.person = person;
    if (plan.cardNumber >= 0) {
      const l4 = last4(cellText(cell(plan.cardNumber)));
      if (l4) {
        parsed.cardLast4 = l4;
        last4Seen.set(l4, (last4Seen.get(l4) ?? 0) + 1);
      }
    }
    rows.push(parsed);
  }
  return { rows, skipped, last4Seen };
}

function dateSpan(rows: ParsedRow[]): { firstDate: string | null; lastDate: string | null } {
  if (rows.length === 0) return { firstDate: null, lastDate: null };
  let first = rows[0]!.date;
  let last = first;
  for (const r of rows) {
    if (r.date < first) first = r.date;
    if (r.date > last) last = r.date;
  }
  return { firstDate: first, lastDate: last };
}

/**
 * For a layout we don't know yet: how many rows sit under the header, and the dates they
 * span, from whichever column reads best as dates. Lets Uploads place the file in a month
 * before its one-time setup.
 */
function looseSpan(
  grid: Grid,
  from: number,
): { dataRows: number; firstDate: string | null; lastDate: string | null } {
  const rows = grid.slice(from).filter((r) => !isBlankRow(r));
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best: string[] = [];
  for (let col = 0; col < width; col++) {
    const dates: string[] = [];
    for (const row of rows) {
      const cell = row[col];
      let date: string | null = null;
      if (cell instanceof Date) date = parseDate(cell);
      else if (typeof cell === "number") {
        date = Number.isInteger(cell) && cell > 30000 && cell < 70000 ? parseDate(cell) : null;
      } else if (typeof cell === "string" && /[/\-.]|[A-Za-z]{3}/.test(cell))
        date = parseDate(cell);
      if (date) dates.push(date);
    }
    if (dates.length > best.length) best = dates;
  }
  if (rows.length === 0 || best.length < rows.length * 0.6) {
    return { dataRows: rows.length, firstDate: null, lastDate: null };
  }
  best.sort();
  return { dataRows: rows.length, firstDate: best[0]!, lastDate: best[best.length - 1]! };
}

function sampleOf(grid: Grid, from: number): string[][] {
  return grid
    .slice(from, from + SAMPLE_ROWS + 1)
    .filter((r) => !isBlankRow(r))
    .map((r) => r.map(cellText));
}

/**
 * Reads a grid of cells (from CSV or XLSX). With no profile or mapping it recognizes the
 * bank by its headers; when nothing matches, the result has no rows and a sample for the
 * one-time column-matching step.
 */
export function readGrid(
  grid: Grid,
  format: FileFormat,
  options: { profileId?: string; mapping?: ColumnMapping; profiles?: readonly BankProfile[] } = {},
): ParsedStatement {
  const profiles = options.profiles ?? PROFILES;
  const base = {
    format,
    warnings: [] as string[],
  };

  if (options.mapping) {
    const m = options.mapping;
    const headers = (grid[m.headerRow] ?? []).map(cellText);
    const { rows, skipped } = readRows(
      grid,
      m.headerRow + 1,
      planFromMapping(m),
      m.accountKind,
      null,
    );
    return {
      ...base,
      profileId: null,
      institution: null,
      accountKind: m.accountKind,
      rows,
      skipped,
      headers,
      sample: sampleOf(grid, m.headerRow + 1),
      ...dateSpan(rows),
    };
  }

  const forced = options.profileId ? profiles.find((p) => p.id === options.profileId) : undefined;
  const detection: Detection | null = forced
    ? { profile: forced, headerRow: forced.columns ? null : findHeaderRow(grid, forced) }
    : detectProfile(grid, profiles);

  if (!detection) {
    const headerRow = grid.findIndex((r) => !isBlankRow(r));
    return {
      ...base,
      profileId: null,
      institution: null,
      accountKind: null,
      rows: [],
      skipped: 0,
      headers: headerRow >= 0 ? (grid[headerRow] ?? []).map(cellText) : [],
      headerRow: Math.max(0, headerRow),
      sample: sampleOf(grid, headerRow + 1),
      ...looseSpan(grid, headerRow + 1),
    };
  }

  const { profile, headerRow } = detection;
  const headerNames =
    headerRow === null
      ? (profile.columns ?? []).map((c) => c.toLowerCase())
      : (grid[headerRow] ?? []).map(normalizeHeader);
  const plan = planFromProfile(profile, headerNames);
  if (typeof plan === "string") {
    return {
      ...base,
      warnings: [plan],
      profileId: null,
      institution: profile.institution,
      accountKind: profile.accountKind,
      rows: [],
      skipped: 0,
      headers: headerNames,
      sample: sampleOf(grid, (headerRow ?? -1) + 1),
      firstDate: null,
      lastDate: null,
    };
  }
  const start = headerRow === null ? 0 : headerRow + 1;
  const { rows, skipped, last4Seen } = readRows(grid, start, plan, profile.accountKind, profile);
  const result: ParsedStatement = {
    ...base,
    profileId: profile.id,
    institution: profile.institution,
    accountKind: profile.accountKind,
    rows,
    skipped,
    headers: headerRow === null ? (profile.columns ?? []) : (grid[headerRow] ?? []).map(cellText),
    sample: sampleOf(grid, start),
    ...dateSpan(rows),
  };
  if (last4Seen.size === 1) result.accountLast4 = [...last4Seen.keys()][0];
  else if (last4Seen.size > 1) {
    result.accountLast4 = [...last4Seen.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    result.warnings.push("This file has rows from more than one card number.");
  }
  return result;
}

function findHeaderRow(grid: Grid, profile: BankProfile): number {
  const signature = profile.detect.headers.map((h) => h.toLowerCase());
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const headers = new Set((grid[r] ?? []).map(normalizeHeader));
    if (signature.every((h) => headers.has(h))) return r;
  }
  return 0;
}
