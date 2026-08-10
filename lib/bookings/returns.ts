import { multiplyCentavos } from "@/lib/money";
import type { ReturnCondition } from "@/lib/supabase/database.types";

/**
 * What happens when the items come back (Spec 4.4).
 *
 * "Delivery Staff records item condition per line (OK / Damaged /
 * Lost + notes). Damaged/lost items auto-create a charge line at
 * replacement value, added to the booking balance… Damaged items
 * reduce available inventory until Owner marks them repaired or
 * written off."
 *
 * Pure, because a charge raised against a customer is the last place
 * anyone wants an untested calculation.
 */

export const RETURN_CONDITIONS: readonly ReturnCondition[] = [
  "pending",
  "ok",
  "damaged",
  "lost",
];

export const RETURN_CONDITION_LABELS: Record<ReturnCondition, string> = {
  pending: "Not checked yet",
  ok: "Came back fine",
  damaged: "Damaged",
  lost: "Lost",
};

export function isReturnCondition(value: string): value is ReturnCondition {
  return (RETURN_CONDITIONS as readonly string[]).includes(value);
}

/** One line as Delivery Staff hands it back. */
export type ReturnRecord = {
  booking_item_id: string;
  description: string;
  /** How many went out on this line. */
  quantity: number;
  replacement_value_centavos: number;
  condition: ReturnCondition;
  damaged_quantity: number;
  lost_quantity: number;
  notes: string;
};

/** The problem with a recorded return, or null when it is sound. */
export function validateReturn(record: ReturnRecord): string | null {
  const { description } = record;

  if (
    !Number.isInteger(record.damaged_quantity) ||
    record.damaged_quantity < 0 ||
    !Number.isInteger(record.lost_quantity) ||
    record.lost_quantity < 0
  ) {
    return `${description}: counts must be whole numbers of 0 or more.`;
  }

  const affected = record.damaged_quantity + record.lost_quantity;

  if (affected > record.quantity) {
    return `${description}: more items marked damaged or lost than went out (${record.quantity}).`;
  }

  if (record.condition === "ok" && affected > 0) {
    return `${description}: marked as fine, but ${affected} are listed as damaged or lost.`;
  }

  if (
    (record.condition === "damaged" || record.condition === "lost") &&
    affected === 0
  ) {
    return `${description}: say how many were ${record.condition}.`;
  }

  // A charge is about to be raised against a customer, so the reason
  // has to be on the record.
  if (affected > 0 && !record.notes.trim()) {
    return `${description}: add a note explaining the damage or loss.`;
  }

  return null;
}

export type DamageCharge = {
  source_item_id: string;
  description: string;
  quantity: number;
  unit_price_centavos: number;
  total_centavos: number;
};

/**
 * The charge line a damaged or lost return raises, or null when there
 * is nothing to charge. Priced at the catalog's replacement value —
 * the figure the rental agreement says the customer agreed to.
 */
export function damageChargeFor(record: ReturnRecord): DamageCharge | null {
  const affected = record.damaged_quantity + record.lost_quantity;
  if (affected <= 0) return null;

  // An item with no replacement value on file cannot be charged for;
  // raising a ₱0.00 line would only clutter the booking.
  if (record.replacement_value_centavos <= 0) return null;

  const what =
    record.lost_quantity > 0 && record.damaged_quantity > 0
      ? `${record.damaged_quantity} damaged, ${record.lost_quantity} lost`
      : record.lost_quantity > 0
        ? "lost"
        : "damaged";

  return {
    source_item_id: record.booking_item_id,
    description: `${record.description} — ${what} (replacement value)`,
    quantity: affected,
    unit_price_centavos: record.replacement_value_centavos,
    total_centavos: multiplyCentavos(
      record.replacement_value_centavos,
      affected,
    ),
  };
}

export type InventoryEffect = {
  catalog_item_id: string;
  /** Added to `damaged_quantity` — out of service until repaired. */
  damaged_delta: number;
  /** Subtracted from `quantity_owned` — a lost item is simply gone. */
  owned_delta: number;
};

/**
 * What a return does to the inventory.
 *
 * Damaged stock stays owned but stops being available until the Owner
 * repairs or writes it off (that screen is Milestone 7). Lost stock is
 * gone, so the business owns fewer of them from now on.
 */
export function inventoryEffectFor(
  record: ReturnRecord,
  catalogItemId: string | null,
): InventoryEffect | null {
  if (!catalogItemId) return null;
  if (record.damaged_quantity === 0 && record.lost_quantity === 0) return null;

  return {
    catalog_item_id: catalogItemId,
    damaged_delta: record.damaged_quantity,
    // Written this way round so a clean line yields 0, not -0.
    owned_delta: record.lost_quantity > 0 ? -record.lost_quantity : 0,
  };
}

/** True once every line has been looked at, so the booking can close. */
export function allLinesChecked(
  conditions: readonly ReturnCondition[],
): boolean {
  return (
    conditions.length > 0 &&
    conditions.every((condition) => condition !== "pending")
  );
}
