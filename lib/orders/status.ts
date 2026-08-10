import type { OrderStatus } from "@/lib/supabase/database.types";

/**
 * An order's whole life (Spec 4.6).
 *
 * A quick sale is finished the moment it is rung up — there is no
 * pipeline to walk. The only other state is voided, which puts the
 * stock back and leaves the mistake on the record rather than
 * deleting it.
 */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  completed: "Completed",
  voided: "Voided",
};

export const ORDER_STATUS_TONES: Record<
  OrderStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  completed: "success",
  voided: "danger",
};

export function isOrderStatus(value: string): value is OrderStatus {
  return value === "completed" || value === "voided";
}

/** Only a completed order can be voided; voiding twice is meaningless. */
export function canVoid(status: OrderStatus): boolean {
  return status === "completed";
}
