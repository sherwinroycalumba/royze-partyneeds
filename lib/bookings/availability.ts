/**
 * The availability engine (Spec 4.4).
 *
 * "warn (blocking warning with override allowed by Owner only) if the
 * requested quantity exceeds available stock for the overlapping date
 * range". The overlap query lives in the database; everything that
 * decides whether a booking is actually over-committed lives here, so
 * it can be tested without a database.
 *
 * A backdrop package contributes its rental components individually,
 * which is what stops two backdrop bookings on the same day from
 * quietly double-allocating the same arch or light set.
 */

/** What the business owns of one item, and what is already spoken for. */
export type StockLevel = {
  catalog_item_id: string;
  name: string;
  quantity_owned: number;
  /** Out of service until repaired or written off (Spec 4.4). */
  damaged_quantity: number;
  /** Held by *other* bookings overlapping the same window. */
  reserved_quantity: number;
};

/** One item's worth of demand from the booking being edited. */
export type StockRequest = {
  catalog_item_id: string;
  name: string;
  quantity: number;
};

export type Shortage = {
  catalog_item_id: string;
  name: string;
  requested: number;
  available: number;
  /** How many more are needed than exist. Always 1 or more. */
  short_by: number;
};

/**
 * How many are free to book across the window: what is owned, less
 * what is broken, less what other bookings already hold. Never
 * negative — an over-committed past cannot lend stock to the future.
 */
export function availableQuantity(level: StockLevel): number {
  return Math.max(
    0,
    level.quantity_owned - level.damaged_quantity - level.reserved_quantity,
  );
}

/**
 * Adds up demand per item.
 *
 * A booking can ask for the same item more than once — ten chairs on
 * their own line and six more inside a backdrop package — and it is
 * the total that has to fit.
 */
export function totalRequested(
  requests: readonly StockRequest[],
): Map<string, StockRequest> {
  const totals = new Map<string, StockRequest>();

  for (const request of requests) {
    if (!request.catalog_item_id || request.quantity <= 0) continue;

    const existing = totals.get(request.catalog_item_id);
    totals.set(request.catalog_item_id, {
      catalog_item_id: request.catalog_item_id,
      // Prefer a name we already have over a blank one.
      name: existing?.name || request.name,
      quantity: (existing?.quantity ?? 0) + request.quantity,
    });
  }

  return totals;
}

/**
 * Every item the booking asks for more of than exists, worst shortage
 * first. An empty array means the booking fits.
 *
 * An item with no stock level on file is treated as unknown rather
 * than unavailable: the catalog is the authority on what is owned, and
 * a custom line that points at nothing has nothing to check.
 */
export function findShortages(
  requests: readonly StockRequest[],
  levels: readonly StockLevel[],
): Shortage[] {
  const byItem = new Map(levels.map((level) => [level.catalog_item_id, level]));
  const shortages: Shortage[] = [];

  for (const request of totalRequested(requests).values()) {
    const level = byItem.get(request.catalog_item_id);
    if (!level) continue;

    const available = availableQuantity(level);
    if (request.quantity > available) {
      shortages.push({
        catalog_item_id: request.catalog_item_id,
        name: level.name || request.name,
        requested: request.quantity,
        available,
        short_by: request.quantity - available,
      });
    }
  }

  return shortages.sort((a, b) => b.short_by - a.short_by);
}

/**
 * The warning staff read (Spec 4.4). Blocking for everyone; only the
 * Owner may override it, and only with a reason.
 */
export function describeShortages(shortages: readonly Shortage[]): string {
  if (shortages.length === 0) return "";

  const parts = shortages.map(
    (shortage) =>
      `${shortage.name} — ${shortage.requested} needed, ${shortage.available} free`,
  );

  return `Not enough stock for these dates: ${parts.join("; ")}.`;
}

/**
 * May this booking be saved as it stands?
 *
 * Anyone may save a booking that fits. Going past the stock on hand is
 * an Owner decision and needs a reason, which is then logged.
 */
export function availabilityVerdict({
  shortages,
  isOwner,
  overrideReason,
}: {
  shortages: readonly Shortage[];
  isOwner: boolean;
  overrideReason: string;
}): { allowed: boolean; error?: string } {
  if (shortages.length === 0) return { allowed: true };

  const problem = describeShortages(shortages);

  if (!isOwner) {
    return {
      allowed: false,
      error: `${problem} Ask the owner to approve the overbooking.`,
    };
  }

  if (!overrideReason.trim()) {
    return {
      allowed: false,
      error: `${problem} Give a reason to book it anyway — it will be logged.`,
    };
  }

  return { allowed: true };
}
