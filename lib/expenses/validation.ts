import { isCalendarDate } from "@/lib/documents/totals";

/**
 * What makes an expense savable (Spec 4.8).
 *
 * The rule with teeth is the payable one: an unpaid expense without a
 * due date is a bill nobody will ever chase, so it is refused.
 */

export type ExpenseDraft = {
  expense_date: string;
  payee: string;
  category: string;
  amount_centavos: number;
  is_paid: boolean;
  due_date: string | null;
  paid_on: string | null;
};

export function validateExpense(draft: ExpenseDraft): string | null {
  if (!isCalendarDate(draft.expense_date)) {
    return "Enter the expense date as a calendar date.";
  }

  if (!Number.isInteger(draft.amount_centavos) || draft.amount_centavos <= 0) {
    return "Enter the amount as a plain number above ₱0.00, e.g. 1,500.00.";
  }

  if (!draft.payee.trim()) {
    return "Say who was paid — a payee or supplier.";
  }

  if (draft.is_paid) {
    if (!draft.paid_on || !isCalendarDate(draft.paid_on)) {
      return "Enter the date it was paid.";
    }
    if (draft.paid_on < draft.expense_date) {
      return "It cannot have been paid before it was incurred.";
    }
  } else {
    // A payable with no due date is one nobody will chase.
    if (!draft.due_date || !isCalendarDate(draft.due_date)) {
      return "An unpaid expense needs a due date, or it will never be chased.";
    }
  }

  return null;
}

/**
 * Whether a category is one the Owner has configured. Unknown ones are
 * allowed through — the list is editable and a typo should not lose an
 * expense — but the caller can warn.
 */
export function isKnownCategory(
  category: string,
  configured: readonly string[],
): boolean {
  const value = category.trim().toLowerCase();
  if (!value) return false;
  return configured.some((known) => known.trim().toLowerCase() === value);
}
