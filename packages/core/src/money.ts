/**
 * Money is always integer cents. Spending is positive and refunds are negative,
 * so sums never need to know which is which.
 */
export type Cents = number;

import { roundHalfAwayFromZero } from "@duet/importers/values";

export { parseCents, roundHalfAwayFromZero } from "@duet/importers/values";

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface MoneyFormat {
  /** Show cents ($2,425.80). Off by default for summaries ($6,318). */
  cents?: boolean;
  /** Always show a sign: "+$862" or "−$190". */
  signed?: boolean;
}

/** Formats cents for people: "$6,318", "$2,425.80", "−$24.99", "+$862". Uses a true minus sign. */
export function formatMoney(value: Cents, format: MoneyFormat = {}): string {
  const abs = Math.abs(value);
  const text = format.cents
    ? withCents.format(abs / 100)
    : wholeDollars.format(roundHalfAwayFromZero(abs / 100));
  const isZero = format.cents ? abs === 0 : roundHalfAwayFromZero(abs / 100) === 0;
  if (value < 0 && !isZero) return `−${text}`;
  if (format.signed && value > 0 && !isZero) return `+${text}`;
  return text;
}

/** Short form for chart labels: "6.9k", "7.8k", "$420". */
export function formatCompact(value: Cents): string {
  const dollars = value / 100;
  if (Math.abs(dollars) >= 1000) return `${(dollars / 1000).toFixed(1)}k`;
  return wholeDollars.format(roundHalfAwayFromZero(dollars));
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Share of an amount at a ratio in basis points (5800 = 58%), rounded once. */
export function shareOf(amount: Cents, basisPoints: number): Cents {
  return roundHalfAwayFromZero((amount * basisPoints) / 10000);
}
