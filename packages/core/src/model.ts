import type { Alternative, Tier } from "./suggest.ts";
import type { Share } from "./words.ts";

/** The shapes the app works with, read from the local database. */

export interface Member {
  id: string;
  name: string;
  color: string;
  /** 0 is the first partner (blue), 1 the second (yellow). */
  position: number;
}

export type AccountKind = "credit" | "checking" | "savings" | "cash" | "wallet";

export interface Account {
  id: string;
  ownerId: string;
  institution: string;
  name: string;
  last4: string | null;
  kind: AccountKind;
  defaultShare: Share;
  profileId: string | null;
  archived: boolean;
}

export interface Transaction {
  id: string;
  share: Share;
  accountId: string | null;
  paidBy: string;
  date: string;
  month: string;
  amount: number;
  merchant: string;
  description: string | null;
  categoryId: string | null;
  note: string | null;
  source: "statement" | "hand";
  refundOf: string | null;
  addedAt: string;
  addedBy: string;
  editedAt: string | null;
}

export interface CleanSlate {
  id: string;
  fromMember: string;
  toMember: string;
  amount: number;
  date: string;
  appliesTo: string;
  note: string | null;
  addedAt: string;
  addedBy: string;
}

export interface SharePlan {
  id: string;
  fromMonth: string;
  firstBp: number;
  changedBy: string | null;
  note: string | null;
  createdAt: string;
}

export type FileStatus = "sorting" | "added" | "needs-setup" | "removed";

export interface StatementFile {
  id: string;
  fileName: string;
  sha256: string;
  /** Where the file was on disk, so it can be read again (the one-time setup, rereads). */
  path: string | null;
  accountId: string | null;
  profileId: string | null;
  format: string | null;
  firstDate: string | null;
  lastDate: string | null;
  broughtInAt: string;
  status: FileStatus;
  rowCount: number;
  skippedCount: number;
  pending: number;
  decided: number;
  added: number;
  aside: number;
}

export type Decision = "pending" | "ours" | "mine" | "aside";

export interface DraftFlags {
  duplicate?: { type: "exact" | "near"; of: string };
  cardPayment?: boolean;
  transfer?: { matchedWith: string | null };
  deposit?: boolean;
  refund?: { of: string | null; ofDate?: string };
  cleanSlateCandidate?: boolean;
  cleanSlateId?: string;
  /** Why a row was set aside, in words ("Card payment, set aside for you"). */
  asideReason?: string;
}

export interface Draft {
  id: string;
  fileId: string | null;
  accountId: string;
  rowIndex: number | null;
  date: string;
  amount: number;
  description: string;
  merchant: string;
  bankCategory: string | null;
  bankId: string | null;
  kind: string;
  person: string | null;
  categoryId: string | null;
  confidence: number;
  tier: Tier;
  alternatives: Alternative[];
  why: string | null;
  suggestedShare: Share | null;
  flags: DraftFlags;
  decision: Decision;
  note: string | null;
  refundOf: string | null;
  decidedAt: string | null;
  addedAt: string | null;
  addedTxId: string | null;
}

export interface LocalSettings {
  appearance: "auto" | "light" | "dark";
  alwaysShowEbbFlow: boolean;
  cleanSlateDefault: "month" | "overall";
  relayUrl: string | null;
  sorterUrl: string | null;
  lastPaidWith: string | null;
}
