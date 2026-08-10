import {
  isCalendarDate,
  validateDocumentMoney,
  type DocumentTotalsInput,
  type LineDraft,
} from "@/lib/documents/totals";
import type { QuotationLineType } from "@/lib/supabase/database.types";

/**
 * What makes a quotation savable (Spec 4.3).
 *
 * The money checks are the shared ones every priced document runs; what
 * is quotation-specific is the pair of dates that decide how long the
 * offer stands.
 */

export type QuotationLineDraft = LineDraft & {
  line_type: QuotationLineType;
};

export type QuotationDraft = Omit<DocumentTotalsInput, "lines"> & {
  lines: readonly QuotationLineDraft[];
  customer_id: string;
  issue_date: string;
  valid_until: string;
  delivery_fee_override_reason: string;
};

/** The first problem with a quotation, or null when it is ready to save. */
export function validateQuotation(draft: QuotationDraft): string | null {
  if (!draft.customer_id) {
    return "Choose the customer this quotation is for.";
  }

  const money = validateDocumentMoney(draft);
  if (money) {
    // The shared wording is deliberately document-neutral; only the
    // empty case needs saying in the customer's language.
    return money.startsWith("Add at least one item")
      ? "Add at least one item — an empty quotation has nothing to quote."
      : money;
  }

  if (!isCalendarDate(draft.issue_date) || !isCalendarDate(draft.valid_until)) {
    return "Enter the dates as calendar dates.";
  }

  if (draft.valid_until < draft.issue_date) {
    return "The validity date cannot be before the quotation date.";
  }

  return null;
}
