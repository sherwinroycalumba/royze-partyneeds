import { addCalendarDays } from "@/lib/date";
import type { QuotationStatus } from "@/lib/supabase/database.types";

/**
 * The quotation lifecycle (Spec 4.3).
 *
 *   Draft ─► Sent ─┬─► Accepted
 *                  ├─► Declined
 *                  └─► Expired   (derived from the validity date)
 *
 * Expiry is *computed on read*, never written by a scheduled job. A
 * quotation whose validity ran out last night is already expired the
 * next time anyone looks at it, whether or not anything has run.
 */

export const QUOTATION_STATUSES: readonly QuotationStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
];

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

/** Badge tone for each status, matching the app's semantic colors. */
export const QUOTATION_STATUS_TONES: Record<
  QuotationStatus,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  sent: "brand",
  accepted: "success",
  declined: "danger",
  expired: "warning",
};

export function isQuotationStatus(value: string): value is QuotationStatus {
  return (QUOTATION_STATUSES as readonly string[]).includes(value);
}

/** The default validity date for a new quotation (Spec 4.3: 7 days). */
export function defaultValidUntil(
  issueDate: string,
  validityDays: number,
): string {
  const days = Number.isInteger(validityDays) && validityDays > 0
    ? validityDays
    : 7;
  return addCalendarDays(issueDate, days);
}

/**
 * The status to show and act on.
 *
 * Only a *sent* quotation expires: a draft was never promised to
 * anyone, and an accepted or declined one has already been answered —
 * the validity date passing does not undo the customer's reply.
 */
export function effectiveStatus(
  stored: QuotationStatus,
  validUntil: string,
  today: string,
): QuotationStatus {
  if (stored === "sent" && today > validUntil) return "expired";
  return stored;
}

/** Days left before the quotation lapses; negative once it has. */
export function daysUntilExpiry(validUntil: string, today: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(validUntil) - parse(today)) / 86_400_000);
}

/**
 * Which statuses staff may move a quotation to by hand.
 *
 * `expired` is absent everywhere on purpose — it is derived, not
 * chosen. Re-sending an expired quotation goes back through Sent with
 * a fresh validity date, which is what staff actually do.
 */
const TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined"],
  accepted: [],
  declined: ["sent"],
  expired: ["sent"],
};

export function allowedTransitions(
  from: QuotationStatus,
): readonly QuotationStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(
  from: QuotationStatus,
  to: QuotationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * An accepted quotation is a record of what was agreed, so its lines
 * are frozen. Everything else stays editable — a customer asking for
 * one more table before deciding is the normal case, not an edge one.
 */
export function canEditQuotation(status: QuotationStatus): boolean {
  return status !== "accepted";
}

/**
 * Whether "Convert to Booking" applies (Spec 4.3). Sent counts as
 * well as Accepted: customers routinely confirm over Messenger and
 * staff book it before anyone updates the status here.
 */
export function canConvertToBooking(status: QuotationStatus): boolean {
  return status === "sent" || status === "accepted";
}
