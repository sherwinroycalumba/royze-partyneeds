import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { StockLevel } from "./availability";
import type { ReservationWindow } from "./windows";

/**
 * The database half of the availability engine (Spec 4.4).
 *
 * The overlap aggregate runs in Postgres — `reserved_quantities` in
 * migration 0006 — because summing every competing booking in the app
 * would mean pulling them all across the wire. Everything that decides
 * whether the answer is a problem stays pure, in `./availability`.
 */
export async function stockLevelsFor({
  itemIds,
  window,
  excludeBookingId,
}: {
  itemIds: readonly string[];
  window: ReservationWindow;
  /** Leaves a booking out of its own check while it is being edited. */
  excludeBookingId?: string | null;
}): Promise<StockLevel[]> {
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const supabase = await createClient();

  const [{ data: items }, { data: reserved }] = await Promise.all([
    supabase
      .from("catalog_items")
      .select("id, name, quantity_owned, damaged_quantity, is_rental")
      .in("id", unique),
    supabase.rpc("reserved_quantities", {
      p_from: window.from,
      p_to: window.to,
      p_exclude: excludeBookingId ?? null,
    }),
  ]);

  const reservedByItem = new Map(
    (reserved ?? []).map((row) => [row.catalog_item_id, row.reserved_quantity]),
  );

  return (items ?? [])
    // Only rental items are held for a window; a sale item comes out
    // of stock instead, which is a different question entirely.
    .filter((item) => item.is_rental)
    .map((item) => ({
      catalog_item_id: item.id,
      name: item.name,
      quantity_owned: item.quantity_owned,
      damaged_quantity: item.damaged_quantity,
      reserved_quantity: reservedByItem.get(item.id) ?? 0,
    }));
}
