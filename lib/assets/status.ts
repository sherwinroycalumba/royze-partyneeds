/**
 * Equipment as an asset register (Spec 4.9).
 *
 * "current status breakdown (Available / Reserved / Out on Rental /
 * Damaged / Under Repair / Written Off)".
 *
 * Three of those are counts the Owner moves by hand — damaged, under
 * repair, written off — and the rest fall out of the bookings. Keeping
 * the arithmetic here means the equipment screen, the availability
 * engine, and any later report all describe the same fleet.
 */

export type AssetCounts = {
  /** The fleet size. Written-off items have already left it. */
  quantity_owned: number;
  /** Broken, waiting on a decision. */
  damaged_quantity: number;
  /** Away being fixed. Still owned, still unavailable. */
  under_repair_quantity: number;
  /** Retired for good — kept only so the register can report it. */
  written_off_quantity: number;
};

export type AssetBreakdown = AssetCounts & {
  /** Held by bookings that have not gone out yet. */
  reserved: number;
  /** Physically with a customer right now. */
  out_on_rental: number;
  /** On the shelf and free to book. Never negative. */
  available: number;
};

/**
 * The full picture for one item.
 *
 * Available is what is left after everything else has a claim on it.
 * It floors at zero: an over-committed fleet is a problem to see, not
 * a negative number to propagate.
 */
export function assetBreakdown(
  counts: AssetCounts,
  activity: { reserved: number; out_on_rental: number },
): AssetBreakdown {
  const unavailable =
    counts.damaged_quantity +
    counts.under_repair_quantity +
    activity.reserved +
    activity.out_on_rental;

  return {
    ...counts,
    reserved: activity.reserved,
    out_on_rental: activity.out_on_rental,
    available: Math.max(0, counts.quantity_owned - unavailable),
  };
}

/** True when more is spoken for than the business actually owns. */
export function isOvercommitted(
  counts: AssetCounts,
  activity: { reserved: number; out_on_rental: number },
): boolean {
  return (
    counts.damaged_quantity +
      counts.under_repair_quantity +
      activity.reserved +
      activity.out_on_rental >
    counts.quantity_owned
  );
}

/**
 * The moves an Owner can make on broken stock — the half of Spec 4.4
 * that Milestone 4 left open, where damaged items came out of
 * availability with no way back.
 */
export type AssetMove =
  | "repaired_from_damaged"
  | "sent_for_repair"
  | "repaired_from_repair"
  | "written_off_from_damaged"
  | "written_off_from_repair";

export const ASSET_MOVES: readonly AssetMove[] = [
  "repaired_from_damaged",
  "sent_for_repair",
  "repaired_from_repair",
  "written_off_from_damaged",
  "written_off_from_repair",
];

export const ASSET_MOVE_LABELS: Record<AssetMove, string> = {
  repaired_from_damaged: "Back in service",
  sent_for_repair: "Sent for repair",
  repaired_from_repair: "Repaired — back in service",
  written_off_from_damaged: "Written off",
  written_off_from_repair: "Written off after repair failed",
};

export function isAssetMove(value: string): value is AssetMove {
  return (ASSET_MOVES as readonly string[]).includes(value);
}

/** Which pile a move takes items from. */
function sourceOf(move: AssetMove): "damaged" | "under_repair" {
  return move === "sent_for_repair" ||
    move === "repaired_from_damaged" ||
    move === "written_off_from_damaged"
    ? "damaged"
    : "under_repair";
}

/**
 * The problem with a move, or null when it can be applied. The guard
 * that matters: you cannot repair more than are broken.
 */
export function validateAssetMove(
  counts: AssetCounts,
  move: AssetMove,
  quantity: number,
): string | null {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return "Enter a whole number of 1 or more.";
  }

  const source = sourceOf(move);
  const available =
    source === "damaged"
      ? counts.damaged_quantity
      : counts.under_repair_quantity;

  if (quantity > available) {
    return source === "damaged"
      ? `Only ${available} are marked damaged.`
      : `Only ${available} are away for repair.`;
  }

  return null;
}

/**
 * The counts after a move. Pure, so the same arithmetic can be shown
 * to the Owner before they commit to it.
 *
 * Writing something off removes it from the fleet as well as from the
 * broken pile — the business owns one fewer from then on, exactly as a
 * lost item does on return (Spec 4.4).
 */
export function applyAssetMove(
  counts: AssetCounts,
  move: AssetMove,
  quantity: number,
): AssetCounts {
  const next = { ...counts };
  const source = sourceOf(move);

  if (source === "damaged") {
    next.damaged_quantity = Math.max(0, next.damaged_quantity - quantity);
  } else {
    next.under_repair_quantity = Math.max(
      0,
      next.under_repair_quantity - quantity,
    );
  }

  if (move === "sent_for_repair") {
    next.under_repair_quantity += quantity;
  }

  if (
    move === "written_off_from_damaged" ||
    move === "written_off_from_repair"
  ) {
    next.written_off_quantity += quantity;
    next.quantity_owned = Math.max(0, next.quantity_owned - quantity);
  }

  // "repaired_*" needs nothing further: taking it out of the broken
  // pile is what puts it back on the shelf.
  return next;
}

// ── Overdue returns (Spec 4.9) ────────────────────────────────
export type OutItem = {
  booking_id: string;
  booking_number: string;
  customer_name: string;
  /** Manila calendar day the items are due back. */
  due_back: string | null;
  status: string;
};

/**
 * Bookings whose items should already be back.
 *
 * A booking with no pickup date is not overdue — nobody agreed a
 * return day, so there is nothing to be late for. Flagging those would
 * train staff to ignore the list.
 */
export function overdueReturns(
  out: readonly OutItem[],
  today: string,
): OutItem[] {
  return out
    .filter((item) => item.due_back !== null && item.due_back < today)
    .sort((a, b) => (a.due_back ?? "").localeCompare(b.due_back ?? ""));
}

/** How many days late, for the nudge on the dashboard. */
export function daysOverdue(dueBack: string, today: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.round((parse(today) - parse(dueBack)) / 86_400_000));
}
