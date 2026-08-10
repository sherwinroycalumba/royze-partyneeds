import { sumCentavos } from "@/lib/money";

/**
 * Expenses and what is still owed (Spec 4.8).
 *
 * An expense the business has not paid yet is a payable, and a payable
 * with a due date in the past is the one that costs a relationship.
 * The aging buckets match the receivables report in Spec 4.11, so the
 * two halves of the money picture read the same way.
 */

export type ExpenseLike = {
  amount_centavos: number;
  category: string;
  is_paid: boolean;
  due_date: string | null;
  expense_date: string;
};

export type PayableSummary = {
  paid_centavos: number;
  /** Unpaid, whatever the due date. */
  outstanding_centavos: number;
  /** Unpaid and past its due date. */
  overdue_centavos: number;
  overdue_count: number;
};

export function summarisePayables(
  expenses: readonly ExpenseLike[],
  today: string,
): PayableSummary {
  const unpaid = expenses.filter((expense) => !expense.is_paid);
  const overdue = unpaid.filter(
    (expense) => expense.due_date !== null && expense.due_date < today,
  );

  return {
    paid_centavos: sumCentavos(
      expenses
        .filter((expense) => expense.is_paid)
        .map((expense) => expense.amount_centavos),
    ),
    outstanding_centavos: sumCentavos(
      unpaid.map((expense) => expense.amount_centavos),
    ),
    overdue_centavos: sumCentavos(
      overdue.map((expense) => expense.amount_centavos),
    ),
    overdue_count: overdue.length,
  };
}

/** Aging buckets, matching the receivables report (Spec 4.11). */
export const AGING_BUCKETS = [
  "Not yet due",
  "1–30 days",
  "31–60 days",
  "61–90 days",
  "Over 90 days",
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucketFor(
  dueDate: string | null,
  today: string,
): AgingBucket {
  if (!dueDate || dueDate >= today) return "Not yet due";

  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const days = Math.round((parse(today) - parse(dueDate)) / 86_400_000);

  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "Over 90 days";
}

/** Totals per category, biggest first — what the money went on. */
export function totalsByCategory(
  expenses: readonly ExpenseLike[],
): { category: string; total_centavos: number; count: number }[] {
  const totals = new Map<string, { total: number; count: number }>();

  for (const expense of expenses) {
    // An uncategorised expense is exactly what the Bookkeeper is
    // looking for, so it gets a visible bucket rather than vanishing.
    const key = expense.category.trim() || "Uncategorised";
    const current = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, {
      total: current.total + expense.amount_centavos,
      count: current.count + 1,
    });
  }

  return [...totals.entries()]
    .map(([category, value]) => ({
      category,
      total_centavos: value.total,
      count: value.count,
    }))
    .sort((a, b) => b.total_centavos - a.total_centavos);
}

/** Expenses with no category, which the Bookkeeper has to resolve. */
export function uncategorisedCount(
  expenses: readonly ExpenseLike[],
): number {
  return expenses.filter((expense) => !expense.category.trim()).length;
}
