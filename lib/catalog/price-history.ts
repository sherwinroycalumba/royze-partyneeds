/**
 * Price history (Spec 4.2: "who changed what price, when").
 *
 * Only money fields are tracked. Renames, photo swaps, and stock
 * corrections belong in the audit trail, not in the price log a
 * bookkeeper reads to explain a margin change.
 */

export const TRACKED_PRICE_FIELDS = [
  ["rental_price_centavos", "Rental price"],
  ["replacement_value_centavos", "Replacement value"],
  ["sale_price_centavos", "Sale price"],
  ["cost_price_centavos", "Cost price"],
  ["package_price_centavos", "Package price"],
] as const;

export const PRICE_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  TRACKED_PRICE_FIELDS,
);

export type PriceChange = {
  field: string;
  label: string;
  from: number;
  to: number;
};

/**
 * The price movements between a stored record and an edited draft.
 *
 * Fields absent from either side are skipped, so the same function
 * serves catalog items and backdrop packages even though neither
 * carries the other's price columns.
 */
export function priceChanges(
  before: Partial<Record<string, number>>,
  after: Partial<Record<string, number>>,
): PriceChange[] {
  const changes: PriceChange[] = [];

  for (const [field, label] of TRACKED_PRICE_FIELDS) {
    const from = before[field];
    const to = after[field];
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (from === to) continue;
    changes.push({ field, label, from, to });
  }

  return changes;
}
