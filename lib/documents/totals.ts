import {
  downpaymentRequired,
  multiplyCentavos,
  sumCentavos,
} from "@/lib/money";

/**
 * The money arithmetic every priced document shares (Spec 4.3, 4.4).
 *
 * Quotations, bookings, and — later — orders all add up the same way:
 * lines, then a whole-document discount, then the delivery fee, then
 * the downpayment that confirms it. Keeping that in one pure module is
 * what stops a quotation totalling differently from the booking it
 * converts into, or from the PDF the customer is holding.
 */

/**
 * The only fields the arithmetic needs.
 *
 * Kept separate from `LineDraft` so a list screen can total a document
 * from a query that selected just the money columns.
 */
export type PricedLine = {
  quantity: number;
  unit_price_centavos: number;
  line_discount_centavos: number;
};

/** A line as an editor and a document renderer both see it. */
export type LineDraft = PricedLine & {
  description: string;
};

/**
 * What one line is worth: quantity × unit price, less the line's own
 * discount. Never negative — a discount above the line's value is
 * rejected by `validateLine`, and clamped here as a backstop so a
 * malformed row cannot subtract from the rest of the document.
 */
export function lineTotal(line: PricedLine): number {
  const gross = multiplyCentavos(line.unit_price_centavos, line.quantity);
  return Math.max(0, gross - line.line_discount_centavos);
}

/** Every line before delivery, the general discount, and rounding. */
export function linesSubtotal(lines: readonly PricedLine[]): number {
  return sumCentavos(lines.map(lineTotal));
}

/**
 * The delivery & pickup fee actually charged (Spec 4.4).
 *
 * Inside the free-delivery area the answer is ₱0 whatever was typed:
 * the toggle wins, so the fee and the printed "FREE Delivery & Pickup"
 * line can never disagree. The database carries the same rule as a
 * check constraint.
 */
export function deliveryFeeCharged(input: {
  within_free_delivery_area: boolean;
  delivery_fee_centavos: number;
}): number {
  return input.within_free_delivery_area ? 0 : input.delivery_fee_centavos;
}

export type DocumentTotalsInput = {
  lines: readonly PricedLine[];
  within_free_delivery_area: boolean;
  delivery_fee_centavos: number;
  /** Whole-document discount, applied on top of per-line discounts. */
  discount_centavos: number;
  downpayment_percent: number;
};

export type DocumentTotals = {
  subtotal_centavos: number;
  discount_centavos: number;
  delivery_fee_centavos: number;
  total_centavos: number;
  /** What must be paid and verified to confirm a booking (Spec 4.4). */
  downpayment_centavos: number;
};

/**
 * The figures printed on the document, in the order they are printed.
 *
 * The general discount comes off the goods, not the delivery fee — the
 * fee is a cost the business incurs either way, and staff quote it as
 * a separate line for exactly that reason.
 */
export function documentTotals(input: DocumentTotalsInput): DocumentTotals {
  const subtotal = linesSubtotal(input.lines);
  const discount = Math.min(Math.max(0, input.discount_centavos), subtotal);
  const delivery = deliveryFeeCharged(input);
  const total = subtotal - discount + delivery;

  return {
    subtotal_centavos: subtotal,
    discount_centavos: discount,
    delivery_fee_centavos: delivery,
    total_centavos: total,
    downpayment_centavos: downpaymentRequired(total, input.downpayment_percent),
  };
}

/**
 * What the delivery line says on the document (Spec 4.4). The area
 * name comes from Settings so the owner can rename it without a
 * code change.
 */
export function deliveryFeeLabel(
  withinFreeArea: boolean,
  freeDeliveryArea: string,
): string {
  if (!withinFreeArea) return "Delivery & Pickup";
  const area = freeDeliveryArea.trim();
  return area
    ? `FREE Delivery & Pickup (within ${area})`
    : "FREE Delivery & Pickup";
}

// ── Validation ────────────────────────────────────────────────
/** The problem with a single line, or null when it is fine. */
export function validateLine(line: LineDraft, rowNumber: number): string | null {
  const row = `Line ${rowNumber}`;

  if (!line.description.trim()) {
    return `${row}: choose an item or type a description.`;
  }

  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return `${row}: quantity must be a whole number of 1 or more.`;
  }

  if (
    !Number.isInteger(line.unit_price_centavos) ||
    line.unit_price_centavos < 0
  ) {
    return `${row}: enter the price as a plain amount, e.g. 1,250.00.`;
  }

  if (
    !Number.isInteger(line.line_discount_centavos) ||
    line.line_discount_centavos < 0
  ) {
    return `${row}: the discount must be an amount of ₱0.00 or more.`;
  }

  const gross = multiplyCentavos(line.unit_price_centavos, line.quantity);
  if (line.line_discount_centavos > gross) {
    return `${row}: the discount is more than the line is worth.`;
  }

  return null;
}

/**
 * The money checks every priced document runs: at least one line, every
 * line sound, and the fee, discount, and percentage all sane.
 *
 * Returns the first problem only — staff fix one thing at a time, and a
 * wall of errors on a phone is unreadable.
 */
export function validateDocumentMoney(
  draft: Omit<DocumentTotalsInput, "lines"> & { lines: readonly LineDraft[] },
): string | null {
  if (draft.lines.length === 0) {
    return "Add at least one item — an empty document has nothing to price.";
  }

  for (const [index, line] of draft.lines.entries()) {
    const problem = validateLine(line, index + 1);
    if (problem) return problem;
  }

  if (
    !Number.isInteger(draft.delivery_fee_centavos) ||
    draft.delivery_fee_centavos < 0
  ) {
    return "Enter the delivery fee as a plain amount, e.g. 500.00.";
  }

  if (draft.within_free_delivery_area && draft.delivery_fee_centavos > 0) {
    return "Inside the free-delivery area the fee has to be ₱0.00.";
  }

  if (
    !Number.isInteger(draft.discount_centavos) ||
    draft.discount_centavos < 0
  ) {
    return "Enter the discount as a plain amount, e.g. 500.00.";
  }

  if (draft.discount_centavos > linesSubtotal(draft.lines)) {
    return "The discount is more than the items come to.";
  }

  if (
    !Number.isFinite(draft.downpayment_percent) ||
    draft.downpayment_percent < 0 ||
    draft.downpayment_percent > 100
  ) {
    return "The downpayment percentage must be between 0 and 100.";
  }

  return null;
}

/** `YYYY-MM-DD`, which sorts and compares correctly as a string. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Rejects Feb 30 and friends without pulling in a date library.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
