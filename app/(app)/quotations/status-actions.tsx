"use client";

import { useActionState } from "react";

import {
  setQuotationStatusAction,
  type QuotationState,
} from "@/lib/quotations/actions";
import {
  allowedTransitions,
  QUOTATION_STATUS_LABELS,
} from "@/lib/quotations/status";
import type { QuotationStatus } from "@/lib/supabase/database.types";
import { Banner } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The status moves available from where this quotation actually stands
 * (Spec 4.3). The list comes from the same transition table the server
 * action checks against, so a button can never offer a move the server
 * will refuse.
 */
export function StatusActions({
  quotationId,
  status,
}: {
  quotationId: string;
  /** The *effective* status — a lapsed quotation reads as expired. */
  status: QuotationStatus;
}) {
  const [state, formAction] = useActionState<QuotationState, FormData>(
    setQuotationStatusAction,
    {},
  );

  const transitions = allowedTransitions(status);

  return (
    <div className="space-y-2">
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      {transitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {transitions.map((target) => (
            <form key={target} action={formAction}>
              <input type="hidden" name="quotation_id" value={quotationId} />
              <input type="hidden" name="status" value={target} />
              <SubmitButton
                variant={variantFor(target)}
                size="sm"
                pendingLabel="Saving…"
              >
                {labelFor(status, target)}
              </SubmitButton>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

function variantFor(
  target: QuotationStatus,
): "primary" | "secondary" | "danger" {
  if (target === "declined") return "danger";
  if (target === "accepted") return "primary";
  return "secondary";
}

/** Phrased as the action staff are taking, not the state name. */
function labelFor(from: QuotationStatus, target: QuotationStatus): string {
  if (target === "sent") {
    return from === "draft" ? "Mark as sent" : "Re-send";
  }
  if (target === "accepted") return "Customer accepted";
  if (target === "declined") return "Customer declined";
  return `Mark ${QUOTATION_STATUS_LABELS[target]}`;
}
