import Papa from "papaparse";
import * as XLSX from "xlsx";
import { isOfx, readOfx } from "./ofx.ts";
import { type Grid, readGrid } from "./table.ts";
import type { BankProfile, ColumnMapping, FileFormat, ParsedStatement } from "./types.ts";

export * from "./kinds.ts";
export { readOfx } from "./ofx.ts";
export { INSTITUTIONS, institutionBadge, PROFILES, profileById } from "./profiles.ts";
export { cellText, detectProfile, type Grid, normalizeHeader, readGrid } from "./table.ts";
export * from "./types.ts";
export * from "./values.ts";

export interface ReadOptions {
  /** Use this profile instead of recognizing the file. */
  profileId?: string;
  /** A column mapping from the one-time setup, for files no profile knows. */
  mapping?: ColumnMapping;
  profiles?: readonly BankProfile[];
}

/** Decodes text as UTF-8, falling back to Windows-1252 for older exports. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function detectFormat(bytes: Uint8Array, fileName = ""): FileFormat {
  const name = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isZip || isOle || name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".ofx") || name.endsWith(".qfx") || name.endsWith(".qbo")) return "ofx";
  const head = decodeText(bytes.slice(0, 2000));
  return isOfx(head) ? "ofx" : "csv";
}

export function parseCsv(text: string): Grid {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return result.data;
}

/** The first sheet with any content, as a grid. Dates come back as Date objects. */
export function readXlsxGrid(bytes: Uint8Array): Grid {
  const book = XLSX.read(bytes, { type: "array", cellDates: true });
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<Grid[number]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    if (grid.some((row) => row.some((c) => c !== null && c !== ""))) return grid;
  }
  return [];
}

/** Reads a statement file of any supported format into rows. */
export function readStatement(
  bytes: Uint8Array,
  fileName = "",
  options: ReadOptions = {},
): ParsedStatement {
  const format = detectFormat(bytes, fileName);
  if (format === "ofx") return readOfx(decodeText(bytes));
  const grid = format === "xlsx" ? readXlsxGrid(bytes) : parseCsv(decodeText(bytes));
  return readGrid(grid, format, options);
}
