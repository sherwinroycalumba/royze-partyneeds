import type { AgreementStatus } from "@/lib/supabase/database.types";

/**
 * The rental agreement workflow (Spec 4.5).
 *
 *   Generated → Printed/Sent → Signed
 *
 * "Signed" is the half of the Confirmed gate that is not about money,
 * so it is deliberately a deliberate act: staff tick the box once the
 * paper actually comes back, and may attach a photo of it.
 */

export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "generated",
  "sent",
  "signed",
];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  generated: "Generated",
  sent: "Printed / Sent",
  signed: "Signed",
};

export const AGREEMENT_STATUS_TONES: Record<
  AgreementStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  generated: "neutral",
  sent: "warning",
  signed: "success",
};

export function isAgreementStatus(value: string): value is AgreementStatus {
  return (AGREEMENT_STATUSES as readonly string[]).includes(value);
}

const TRANSITIONS: Record<AgreementStatus, readonly AgreementStatus[]> = {
  // Signing straight from Generated is allowed: a customer at the shop
  // signs the copy the moment it comes off the printer.
  generated: ["sent", "signed"],
  sent: ["signed"],
  // Un-signing would reopen the Confirmed gate underneath a booking
  // that may already be out for delivery. Re-generate instead.
  signed: [],
};

export function allowedTransitions(
  from: AgreementStatus,
): readonly AgreementStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(
  from: AgreementStatus,
  to: AgreementStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Whether re-generating is allowed. Once signed, the document is a
 * record of what the client agreed to, so regenerating it would mean
 * discarding evidence — the Owner has to delete it deliberately.
 */
export function canRegenerate(status: AgreementStatus): boolean {
  return status !== "signed";
}

/** Phrased as the action staff are taking. */
export function transitionLabel(target: AgreementStatus): string {
  switch (target) {
    case "sent":
      return "Mark printed / sent";
    case "signed":
      return "Mark signed";
    default:
      return AGREEMENT_STATUS_LABELS[target];
  }
}
