import type { BankProfile } from "./types.ts";

/**
 * One profile per export layout. Quirks come from recent exports and are confirmed
 * against real anonymized files in M1; each profile has a fixture in `fixtures/`.
 * Bread Cashback and DCU aren't here yet: their CSV layouts are unknown until we see a
 * file, so they go through the one-time column match (or their OFX/QFX export).
 */
export const PROFILES: BankProfile[] = [
  {
    id: "amex-csv",
    institution: "American Express",
    accountKind: "credit",
    detect: { headers: ["Date", "Description", "Card Member", "Account #", "Amount"] },
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "positive" },
    bankCategory: "Category",
    cardNumber: "Account #",
    person: "Card Member",
  },
  {
    id: "amex-details-csv",
    institution: "American Express",
    accountKind: "credit",
    detect: { headers: ["Date", "Description", "Amount", "Appears On Your Statement As"] },
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "positive" },
    bankCategory: "Category",
  },
  {
    id: "amex-basic-csv",
    institution: "American Express",
    accountKind: "credit",
    detect: { headers: ["Date", "Description", "Amount"] },
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "positive" },
    priority: -10,
  },
  {
    id: "capital-one-csv",
    institution: "Capital One",
    accountKind: "credit",
    detect: {
      headers: [
        "Transaction Date",
        "Posted Date",
        "Card No.",
        "Description",
        "Category",
        "Debit",
        "Credit",
      ],
    },
    date: { column: "Transaction Date", format: "yyyy-MM-dd" },
    description: "Description",
    amount: { debit: "Debit", credit: "Credit" },
    bankCategory: "Category",
    cardNumber: "Card No.",
  },
  {
    id: "discover-csv",
    institution: "Discover",
    accountKind: "credit",
    detect: { headers: ["Trans. Date", "Post Date", "Description", "Amount", "Category"] },
    date: { column: "Trans. Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "positive" },
    bankCategory: "Category",
    kind: {
      column: "Category",
      payment: ["Payments and Credits"],
      deposit: ["Awards and Rebate Credits"],
    },
  },
  {
    id: "chase-card-csv",
    institution: "Chase",
    accountKind: "credit",
    detect: {
      headers: ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"],
    },
    date: { column: "Transaction Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "negative" },
    bankCategory: "Category",
    kind: {
      column: "Type",
      payment: ["Payment"],
      refund: ["Return"],
      fee: ["Fee"],
      purchase: ["Sale"],
    },
  },
  {
    id: "chase-checking-csv",
    institution: "Chase",
    accountKind: "checking",
    detect: { headers: ["Details", "Posting Date", "Description", "Amount", "Type", "Balance"] },
    date: { column: "Posting Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "negative" },
    kind: {
      column: "Type",
      transfer: ["ACCT_XFER"],
      payment: ["LOAN_PMT"],
      fee: ["FEE_TRANSACTION"],
    },
  },
  {
    id: "apple-card-csv",
    institution: "Apple Card",
    accountKind: "credit",
    detect: {
      headers: [
        "Transaction Date",
        "Clearing Date",
        "Description",
        "Merchant",
        "Category",
        "Type",
        "Amount (USD)",
      ],
    },
    date: { column: "Transaction Date", format: "MM/dd/yyyy" },
    description: "Description",
    merchant: "Merchant",
    amount: { column: "Amount (USD)", spendingIs: "positive" },
    bankCategory: "Category",
    kind: {
      column: "Type",
      payment: ["Payment"],
      refund: ["Credit", "Return"],
      interest: ["Interest"],
      purchase: ["Purchase", "Installment"],
      deposit: ["Daily Cash Adjustment", "Adjustment"],
    },
    person: "Purchased By",
  },
  {
    id: "citi-csv",
    institution: "Citi",
    accountKind: "credit",
    detect: { headers: ["Status", "Date", "Description", "Debit", "Credit"] },
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { debit: "Debit", credit: "Credit" },
    status: { column: "Status", skip: ["Pending"] },
    person: "Member Name",
  },
  {
    id: "wells-fargo-csv",
    institution: "Wells Fargo",
    accountKind: "checking",
    detect: { headers: [] },
    columns: ["Date", "Amount", "Star", "Check Number", "Description"],
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "negative" },
  },
  {
    id: "bofa-checking-csv",
    institution: "Bank of America",
    accountKind: "checking",
    detect: { headers: ["Date", "Description", "Amount", "Running Bal."] },
    date: { column: "Date", format: "MM/dd/yyyy" },
    description: "Description",
    amount: { column: "Amount", spendingIs: "negative" },
  },
  {
    id: "bofa-card-csv",
    institution: "Bank of America",
    accountKind: "credit",
    detect: { headers: ["Posted Date", "Reference Number", "Payee", "Address", "Amount"] },
    date: { column: "Posted Date", format: "MM/dd/yyyy" },
    description: "Payee",
    amount: { column: "Amount", spendingIs: "negative" },
  },
];

/** The ten institutions the spec names, for pickers and the "still waiting" list. */
export const INSTITUTIONS = [
  "American Express",
  "Capital One",
  "Discover",
  "Chase",
  "Apple Card",
  "Bread Cashback",
  "Citi",
  "DCU",
  "Wells Fargo",
  "Bank of America",
] as const;

/** Two-letter badges for institution bubbles ("AX", "CH"). */
export function institutionBadge(institution: string): string {
  const known: Record<string, string> = {
    "American Express": "AX",
    "Capital One": "C1",
    Discover: "DI",
    Chase: "CH",
    "Apple Card": "AP",
    "Bread Cashback": "BR",
    Citi: "CI",
    DCU: "DC",
    "Wells Fargo": "WF",
    "Bank of America": "BA",
  };
  if (known[institution]) return known[institution];
  const letters = institution
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase());
  return (letters.join("") || "??").slice(0, 2);
}

export function profileById(id: string): BankProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}
