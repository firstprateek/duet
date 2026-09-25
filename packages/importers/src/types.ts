import type { Cents, DateFormat, ISODate } from "./values.ts";

/** What a row is, before anyone sorts it. Only purchases and refunds are spending. */
export type RowKind =
  | "purchase"
  | "refund"
  | "payment"
  | "deposit"
  | "transfer"
  | "fee"
  | "interest";

export type AccountKind = "credit" | "checking" | "savings";

/** Bank labels that mean each kind, e.g. { payment: ["Payment"], refund: ["Return"] }. */
export type KindLabels = Partial<Record<RowKind, string[]>>;

/**
 * A bank profile is plain data: how to recognize one bank's export and which column
 * means what. Column names are matched without regard to case or surrounding spaces.
 */
export interface BankProfile {
  id: string;
  institution: string;
  /** What kind of account this export comes from. */
  accountKind: AccountKind;
  /** Header names that must all be present to recognize the file. */
  detect: { headers: string[] };
  /** For exports without a header row (Wells Fargo): the column names, in order. */
  columns?: string[];
  date: { column: string; format?: DateFormat };
  /** One column, or several joined with a space. */
  description: string | string[];
  /** A column that already holds a clean merchant name (Apple Card). */
  merchant?: string;
  amount:
    | { column: string; spendingIs: "positive" | "negative" }
    | { debit: string; credit: string };
  bankCategory?: string;
  /** A column with the bank's own label for each row ("Sale", "Return", "Payment"). */
  kind?: { column: string } & KindLabels;
  /** Rows whose status matches are skipped (pending authorizations). */
  status?: { column: string; skip: string[] };
  /** A column with the card or account number; its last four digits identify the account. */
  cardNumber?: string;
  /** Who made the purchase on a shared card (Apple Card "Purchased By"). */
  person?: string;
  /** Lower-priority profiles lose ties against more specific ones. */
  priority?: number;
}

export interface ParsedRow {
  /** Position in the file, so re-reading can match rows. */
  index: number;
  date: ISODate;
  /** Spending positive, money coming back negative. */
  amount: Cents;
  description: string;
  merchant?: string;
  bankCategory?: string;
  kind: RowKind;
  cardLast4?: string;
  person?: string;
  /** The bank's own id for the row (OFX FITID), when there is one. */
  bankId?: string;
}

export type FileFormat = "csv" | "xlsx" | "ofx";

export interface ParsedStatement {
  format: FileFormat;
  /** null when no profile matched; the file then needs a one-time column match. */
  profileId: string | null;
  institution: string | null;
  accountKind: AccountKind | null;
  accountLast4?: string;
  rows: ParsedRow[];
  /** Rows that couldn't be read (blank, pending, summary lines). */
  skipped: number;
  /** The header row, for the column-matching step. */
  headers: string[];
  /** A few raw rows, for the column-matching step. */
  sample: string[][];
  firstDate: ISODate | null;
  lastDate: ISODate | null;
  warnings: string[];
}

/** A column mapping made by hand (or proposed by the local model) for an unknown file. */
export interface ColumnMapping {
  headerRow: number;
  date: number;
  dateFormat?: DateFormat;
  description: number;
  amount:
    | { column: number; spendingIs: "positive" | "negative" }
    | { debit: number; credit: number };
  bankCategory?: number;
  accountKind: AccountKind;
}
