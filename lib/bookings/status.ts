import { formatPeso, meetsDownpayment, downpaymentRequired } from "@/lib/money";
import type { BookingStatus } from "@/lib/supabase/database.types";

/**
 * The booking lifecycle (Spec 4.4).
 *
 *   Inquiry → Quoted → Reserved → Confirmed → Out for Delivery
 *           → Delivered/Ongoing → Picked Up → Completed
 *
 * with Cancelled reachable until the items have actually gone out.
 *
 * The one rule with teeth is the gate on Confirmed: a signed agreement
 * *and* verified payments covering the downpayment. It lives here as a
 * pure function so it is testable, and so the server action, the
 * status buttons, and the dashboard all judge it identically.
 */

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  "inquiry",
  "quoted",
  "reserved",
  "confirmed",
  "out_for_delivery",
  "delivered",
  "picked_up",
  "completed",
  "cancelled",
];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  inquiry: "Inquiry",
  quoted: "Quoted",
  reserved: "Reserved",
  confirmed: "Confirmed",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered / Ongoing",
  picked_up: "Picked Up",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Badge tone, and the colour each booking carries on the calendar. */
export const BOOKING_STATUS_TONES: Record<
  BookingStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  inquiry: "neutral",
  quoted: "neutral",
  reserved: "warning",
  confirmed: "brand",
  out_for_delivery: "brand",
  delivered: "success",
  picked_up: "success",
  completed: "success",
  cancelled: "danger",
};

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  inquiry: ["quoted", "reserved", "cancelled"],
  quoted: ["reserved", "cancelled"],
  reserved: ["confirmed", "cancelled"],
  confirmed: ["out_for_delivery", "cancelled"],
  // Once the van has left, the booking is happening. Getting out of it
  // is a return, not a cancellation.
  out_for_delivery: ["delivered"],
  delivered: ["picked_up"],
  picked_up: ["completed"],
  completed: [],
  cancelled: [],
};

export function allowedTransitions(
  from: BookingStatus,
): readonly BookingStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Statuses that hold rental stock for their window.
 *
 * Mirrors `booking_holds_stock` in migration 0006 — an inquiry is not
 * a commitment, and once the items are back the stock is free again.
 * Change one and you must change the other.
 */
const HOLDS_STOCK: readonly BookingStatus[] = [
  "reserved",
  "confirmed",
  "out_for_delivery",
  "delivered",
];

export function holdsStock(status: BookingStatus): boolean {
  return HOLDS_STOCK.includes(status);
}

/** A booking nobody needs to act on any more. */
export function isClosed(status: BookingStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/** Line prices are frozen once the items have gone out. */
export function canEditItems(status: BookingStatus): boolean {
  return (
    status === "inquiry" ||
    status === "quoted" ||
    status === "reserved" ||
    status === "confirmed"
  );
}

/** Delivery Staff record returns only while the booking is out. */
export function canRecordReturn(status: BookingStatus): boolean {
  return status === "delivered" || status === "picked_up";
}

// ── The Confirmed gate (Spec 4.4) ─────────────────────────────
export type ConfirmationFacts = {
  /** Set by the rental-agreement workflow (Spec 4.5, Milestone 5). */
  agreement_signed: boolean;
  /** Pending payments never count (Spec 4.7). */
  verified_paid_centavos: number;
  total_centavos: number;
  downpayment_percent: number;
};

/**
 * Why this booking cannot be confirmed yet — empty when it can.
 *
 * Both conditions are reported at once rather than one at a time:
 * staff chasing a customer need to know they want a signature *and*
 * the deposit, not discover the second requirement after the first.
 */
export function confirmationBlockers(facts: ConfirmationFacts): string[] {
  const blockers: string[] = [];

  if (!facts.agreement_signed) {
    blockers.push("the rental agreement has not been signed");
  }

  if (
    !meetsDownpayment(
      facts.total_centavos,
      facts.verified_paid_centavos,
      facts.downpayment_percent,
    )
  ) {
    const required = downpaymentRequired(
      facts.total_centavos,
      facts.downpayment_percent,
    );
    blockers.push(
      `verified payments are ${formatPeso(facts.verified_paid_centavos)} of the ${formatPeso(required)} needed`,
    );
  }

  return blockers;
}

export function canConfirm(facts: ConfirmationFacts): boolean {
  return confirmationBlockers(facts).length === 0;
}

/**
 * The decision the server action makes. The Owner may override, but
 * only with a reason, and the reason is logged (Spec 4.4).
 */
export function confirmationVerdict({
  facts,
  isOwner,
  overrideReason,
}: {
  facts: ConfirmationFacts;
  isOwner: boolean;
  overrideReason: string;
}): { allowed: boolean; overridden: boolean; error?: string } {
  const blockers = confirmationBlockers(facts);
  if (blockers.length === 0) {
    return { allowed: true, overridden: false };
  }

  const problem = `Cannot confirm yet: ${blockers.join(", and ")}.`;

  if (!isOwner) {
    return {
      allowed: false,
      overridden: false,
      error: `${problem} Only the owner can confirm without these.`,
    };
  }

  if (!overrideReason.trim()) {
    return {
      allowed: false,
      overridden: false,
      error: `${problem} Give a reason to confirm anyway — it will be logged.`,
    };
  }

  return { allowed: true, overridden: true };
}

/** Phrased as the action staff are taking, not the state name. */
export function transitionLabel(target: BookingStatus): string {
  switch (target) {
    case "quoted":
      return "Mark as quoted";
    case "reserved":
      return "Reserve the items";
    case "confirmed":
      return "Confirm booking";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Mark delivered";
    case "picked_up":
      return "Items picked up";
    case "completed":
      return "Complete booking";
    case "cancelled":
      return "Cancel booking";
    default:
      return `Mark ${BOOKING_STATUS_LABELS[target]}`;
  }
}
