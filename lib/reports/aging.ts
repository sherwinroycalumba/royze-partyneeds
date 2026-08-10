import { sumCentavos } from "@/lib/money";

/**
 * Receivables aging (Spec 4.11): "aged 0–7 / 8–30 / 31+ days".
 *
 * Deliberately different buckets from the payables report, which the
 * spec ages in thirties — money owed *to* the business goes bad
 * faster than money it owes, and a week is when somebody should be
 * picking up the phone.
 */

export const RECEIVABLE_BUCKETS = [
  "0–7 days",
  "8–30 days",
  "31+ days",
] as const;

export type ReceivableBucket = (typeof RECEIVABLE_BUCKETS)[number];

/** Whole days between two `YYYY-MM-DD` dates. Negative when in future. */
export function daysBetweenDates(from: string, to: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * Which bucket a balance falls in, counting from the day it became
 * due. Anything not yet due sits in the first bucket rather than
 * inventing a "future" column nobody asked for.
 */
export function receivableBucket(
  dueSince: string,
  today: string,
): ReceivableBucket {
  const days = daysBetweenDates(dueSince, today);
  if (days <= 7) return "0–7 days";
  if (days <= 30) return "8–30 days";
  return "31+ days";
}

export type AgedBalance = {
  balance_centavos: number;
  bucket: ReceivableBucket;
};

/** Totals per bucket, always in bucket order so columns line up. */
export function totalsByBucket(
  balances: readonly AgedBalance[],
): Record<ReceivableBucket, number> {
  const totals = {
    "0–7 days": 0,
    "8–30 days": 0,
    "31+ days": 0,
  } as Record<ReceivableBucket, number>;

  for (const balance of balances) {
    totals[balance.bucket] += balance.balance_centavos;
  }

  return totals;
}

export function totalOutstanding(
  balances: readonly AgedBalance[],
): number {
  return sumCentavos(balances.map((balance) => balance.balance_centavos));
}
