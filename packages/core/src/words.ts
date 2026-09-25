import type { MonthKey } from "./dates.ts";
import { monthName } from "./dates.ts";

/**
 * Every word people see for Duet's own ideas lives here, so changing one is a one-line
 * edit. See "Words we use" in the spec: plural and personal, never debt, clear over cute.
 */
export const words = {
  appName: "Duet",
  ours: "Ours",
  mine: "Mine",
  thisMonth: "This month",
  uploads: "Uploads",
  upload: "Upload",
  toSort: "To sort",
  sorting: "Sorting",
  sorted: "sorted",
  trends: "Trends",
  transactions: "Transactions",
  settings: "Settings",
  quickAdd: "Quick add",
  setAside: "Set aside",
  added: "Added",
  ebbFlow: "Ebb & flow",
  peek: "Peek",
  tuckAway: "Tuck away",
  history: "History",
  cleanSlate: "Clean slate",
  inStep: "You're in step",
  ourRhythm: "Our rhythm",
  alwaysShowEbbFlow: "Always show Ebb & flow",
  newCardFound: "New card found",
  addCardAndSort: "Add card and sort",
  notNow: "Not now",
  backToSorting: "Back to sorting",
  stillWaiting: (month: MonthKey) => `Still waiting for ${monthName(month)}`,
  addTo: (month: MonthKey, count?: number) =>
    count === undefined ? `Add to ${monthName(month)}` : `Add ${count} to ${monthName(month)}`,
  addingTo: (month: MonthKey) => `Adding to ${monthName(month)}`,
  sortedOf: (done: number, total: number) => `${done} of ${total} ${words.sorted}`,
  leftToSort: (count: number) => `${words.sorting} · ${count} left`,
  waitingToBeSorted: (count: number) => `${count} waiting to be sorted`,
} as const;

/** The Ours / Mine choice on one transaction. */
export type Share = "ours" | "mine";

export function shareLabel(share: Share): string {
  return share === "ours" ? words.ours : words.mine;
}
