import type {
  PaymentMethod,
  PaymentStatus,
} from "@/lib/supabase/database.types";

/**
 * How money arrives, and when it counts (Spec 4.7).
 *
 * The rule that matters: cash handed over the counter is verified the
 * moment it is recorded, because the person recording it is holding
 * it. Everything else — GCash, Maya, a bank transfer — is a claim that
 * money moved, and only the Owner can confirm that against the
 * account. Until they do, it does not count toward confirming a
 * booking.
 */

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash",
  "gcash",
  "maya",
  "bank_transfer",
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  bank_transfer: "Bank Transfer",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending verification",
  verified: "Verified",
  rejected: "Rejected",
};

export const PAYMENT_STATUS_TONES: Record<
  PaymentStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  pending: "warning",
  verified: "success",
  rejected: "danger",
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return ["pending", "verified", "rejected"].includes(value);
}

/**
 * Cash is the only method the person recording it can vouch for on
 * the spot. Everything else needs the Owner to look at the account.
 */
export function isAutoVerified(method: PaymentMethod): boolean {
  return method === "cash";
}

/** The status a newly recorded payment starts in (Spec 4.7). */
export function initialStatus(method: PaymentMethod): PaymentStatus {
  return isAutoVerified(method) ? "verified" : "pending";
}

/** Electronic methods carry a reference the Owner can look up. */
export function expectsReference(method: PaymentMethod): boolean {
  return method !== "cash";
}

export type PaymentDraft = {
  amount_centavos: number;
  method: PaymentMethod;
  paid_on: string;
  reference_number: string;
};

/** The problem with a payment, or null when it is sound. */
export function validatePayment(draft: PaymentDraft): string | null {
  if (
    !Number.isInteger(draft.amount_centavos) ||
    draft.amount_centavos <= 0
  ) {
    return "Enter the amount as a plain number above ₱0.00, e.g. 5,000.00.";
  }

  if (!isPaymentMethod(draft.method)) {
    return "Choose how the payment was made.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paid_on)) {
    return "Enter the payment date as a calendar date.";
  }

  // A GCash payment with no reference cannot be checked against the
  // account later, which is the whole point of the verification step.
  if (expectsReference(draft.method) && !draft.reference_number.trim()) {
    return `A ${PAYMENT_METHOD_LABELS[draft.method]} payment needs its reference number.`;
  }

  return null;
}

/** Whether the Owner may still change this payment's status. */
export function canChangeStatus(status: PaymentStatus): boolean {
  // A verified payment can still be rejected — owners do catch
  // mistakes after the fact, and the money trail should show it.
  return status !== "rejected";
}
