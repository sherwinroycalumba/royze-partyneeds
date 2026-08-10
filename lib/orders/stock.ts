/**
 * What a quick sale does to stock (Spec 4.6).
 *
 * A booking *reserves* stock for a window; a sale takes it away for
 * good, at the moment it is rung up. Voiding puts it back.
 *
 * The awkward case this module takes a position on: a sale for more
 * than the system thinks is in stock. The goods have physically left
 * the shop — refusing to record that would leave the business with an
 * unrecorded sale, which is the exact problem the POS screen exists to
 * fix. So the sale is recorded, stock floors at zero, and the
 * discrepancy is reported so somebody can recount the shelf.
 */

export type StockLine = {
  catalog_item_id: string | null;
  description: string;
  quantity: number;
};

export type StockOnHand = {
  catalog_item_id: string;
  name: string;
  stock_quantity: number;
  low_stock_threshold: number;
};

export type StockDiscrepancy = {
  catalog_item_id: string;
  name: string;
  sold: number;
  on_hand: number;
};

/** Adds up demand per item — the same thing can be on two lines. */
export function soldQuantities(
  lines: readonly StockLine[],
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const line of lines) {
    if (!line.catalog_item_id || line.quantity <= 0) continue;
    totals.set(
      line.catalog_item_id,
      (totals.get(line.catalog_item_id) ?? 0) + line.quantity,
    );
  }

  return totals;
}

/**
 * Items sold in greater quantity than the system believed was on the
 * shelf. Not an error — a signal that the count is wrong.
 */
export function findDiscrepancies(
  lines: readonly StockLine[],
  onHand: readonly StockOnHand[],
): StockDiscrepancy[] {
  const byItem = new Map(onHand.map((item) => [item.catalog_item_id, item]));
  const discrepancies: StockDiscrepancy[] = [];

  for (const [itemId, sold] of soldQuantities(lines)) {
    const item = byItem.get(itemId);
    if (!item) continue;

    if (sold > item.stock_quantity) {
      discrepancies.push({
        catalog_item_id: itemId,
        name: item.name,
        sold,
        on_hand: item.stock_quantity,
      });
    }
  }

  return discrepancies;
}

export function describeDiscrepancies(
  discrepancies: readonly StockDiscrepancy[],
): string {
  if (discrepancies.length === 0) return "";

  const parts = discrepancies.map(
    (item) => `${item.name} (sold ${item.sold}, ${item.on_hand} on record)`,
  );

  return `Recorded, but the stock count was already lower than what was sold: ${parts.join("; ")}. Worth recounting the shelf.`;
}

/** Stock after a sale. Never negative — a count cannot go below empty. */
export function stockAfterSale(current: number, sold: number): number {
  return Math.max(0, current - sold);
}

/** Stock after voiding a sale: what went out comes back. */
export function stockAfterVoid(current: number, sold: number): number {
  return current + sold;
}

/**
 * Items at or below their reorder threshold, worst first (Spec 4.6).
 * A threshold of zero means the owner does not track that item.
 */
export function lowStockItems(
  items: readonly StockOnHand[],
): StockOnHand[] {
  return items
    .filter(
      (item) =>
        item.low_stock_threshold > 0 &&
        item.stock_quantity <= item.low_stock_threshold,
    )
    .sort((a, b) => a.stock_quantity - b.stock_quantity);
}
