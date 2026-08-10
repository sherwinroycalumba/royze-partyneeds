import { linesSubtotal, validateLine, type LineDraft } from "@/lib/documents/totals";

/**
 * Quick-sale arithmetic (Spec 4.6).
 *
 * Deliberately *not* `documentTotals`: an order has no delivery fee
 * and no downpayment — the customer is standing at the counter. Faking
 * those with zeroes would leave two shapes of "total" that look
 * interchangeable and are not.
 */

export type OrderTotals = {
  subtotal_centavos: number;
  discount_centavos: number;
  total_centavos: number;
};

export function orderTotals(input: {
  lines: readonly { quantity: number; unit_price_centavos: number; line_discount_centavos: number }[];
  discount_centavos: number;
}): OrderTotals {
  const subtotal = linesSubtotal(input.lines);
  // Capped at the subtotal, so a fat-fingered discount cannot produce
  // a negative sale.
  const discount = Math.min(Math.max(0, input.discount_centavos), subtotal);

  return {
    subtotal_centavos: subtotal,
    discount_centavos: discount,
    total_centavos: subtotal - discount,
  };
}

export type OrderDraft = {
  lines: readonly LineDraft[];
  discount_centavos: number;
  customer_label: string;
  sold_on: string;
};

/** The first problem with an order, or null when it can be rung up. */
export function validateOrder(draft: OrderDraft): string | null {
  if (draft.lines.length === 0) {
    return "Add at least one item — an empty sale is nothing.";
  }

  for (const [index, line] of draft.lines.entries()) {
    const problem = validateLine(line, index + 1);
    if (problem) return problem;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.sold_on)) {
    return "Enter the sale date as a calendar date.";
  }

  if (draft.discount_centavos < 0 || !Number.isInteger(draft.discount_centavos)) {
    return "Enter the discount as a plain amount, e.g. 50.00.";
  }

  if (draft.discount_centavos > linesSubtotal(draft.lines)) {
    return "The discount is more than the items come to.";
  }

  // A blank label would print an anonymous receipt; "Walk-in" is the
  // honest default and the form supplies it.
  if (!draft.customer_label.trim()) {
    return "Say who this sale is for, or leave it as Walk-in.";
  }

  return null;
}
