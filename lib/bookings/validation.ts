import {
  isCalendarDate,
  validateDocumentMoney,
  type DocumentTotalsInput,
  type LineDraft,
} from "@/lib/documents/totals";
import type { BookingLineType } from "@/lib/supabase/database.types";
import { validateSchedule, type BookingSchedule } from "./windows";

/**
 * What makes a booking savable (Spec 4.4).
 *
 * The money checks are the shared ones every priced document runs;
 * what is booking-specific is the schedule — the dates that decide
 * when the van leaves and how long the stock is held.
 */

export type BookingLineDraft = LineDraft & {
  line_type: BookingLineType;
  /** Component rows are priced at ₱0 under their package line. */
  is_component: boolean;
};

export type BookingDraft = Omit<DocumentTotalsInput, "lines"> &
  BookingSchedule & {
    lines: readonly BookingLineDraft[];
    customer_id: string;
  };

/**
 * The first problem with a booking, or null when it is ready to save.
 *
 * Component rows are excluded from the money checks: they are priced
 * at ₱0 because the package line above them carries the price, and a
 * "₱0.00 line" complaint about them would be nonsense.
 */
export function validateBooking(draft: BookingDraft): string | null {
  if (!draft.customer_id) {
    return "Choose the customer this booking is for.";
  }

  if (!isCalendarDate(draft.event_date)) {
    return "Enter the event date as a calendar date.";
  }

  const priced = draft.lines.filter((line) => !line.is_component);

  const money = validateDocumentMoney({ ...draft, lines: priced });
  if (money) {
    return money.startsWith("Add at least one item")
      ? "Add at least one item — an empty booking reserves nothing."
      : money;
  }

  return validateSchedule(draft);
}

/** The lines that carry a price; components never do. */
export function pricedLines<T extends { is_component: boolean }>(
  lines: readonly T[],
): T[] {
  return lines.filter((line) => !line.is_component);
}
