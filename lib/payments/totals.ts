import { balanceDue, sumCentavos } from "@/lib/money";
import type { PaymentStatus } from "@/lib/supabase/database.types";

/**
 * What a booking has actually been paid (Spec 4.7).
 *
 * The distinction this module exists to protect: *verified* payments
 * are money the business has; *pending* payments are claims that money
 * moved. Only the first kind counts toward confirming a booking, and
 * only the first kind is revenue. Mixing them is how a business ends
 * up delivering to someone who never paid.
 */

export type PaymentLike = {
  amount_centavos: number;
  status: PaymentStatus;
};

export type PaymentSummary = {
  /** Money the Owner has confirmed. Counts toward the 50% gate. */
  verified_centavos: number;
  /** Claimed but unconfirmed. Counts toward nothing. */
  pending_centavos: number;
  rejected_centavos: number;
  /** Total less verified — what the customer still owes. */
  balance_centavos: number;
  /** True once anything is waiting on the Owner. */
  has_pending: boolean;
};

export function summarisePayments(
  payments: readonly PaymentLike[],
  totalCentavos: number,
): PaymentSummary {
  const byStatus = (status: PaymentStatus) =>
    sumCentavos(
      payments
        .filter((payment) => payment.status === status)
        .map((payment) => payment.amount_centavos),
    );

  const verified = byStatus("verified");
  const pending = byStatus("pending");

  return {
    verified_centavos: verified,
    pending_centavos: pending,
    rejected_centavos: byStatus("rejected"),
    balance_centavos: balanceDue(totalCentavos, verified),
    has_pending: pending > 0,
  };
}

/**
 * How much of the booking is paid for, as a whole percentage, for the
 * progress line staff read out on the phone. Verified money only.
 */
export function paidPercent(
  verifiedCentavos: number,
  totalCentavos: number,
): number {
  if (totalCentavos <= 0) return 0;
  return Math.min(100, Math.floor((verifiedCentavos / totalCentavos) * 100));
}

/**
 * Overpayment happens — a customer rounds up, or pays twice. It is
 * not an error, but it should be visible rather than silently
 * producing a negative balance nobody notices.
 */
export function isOverpaid(
  verifiedCentavos: number,
  totalCentavos: number,
): boolean {
  return verifiedCentavos > totalCentavos;
}
