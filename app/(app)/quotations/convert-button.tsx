"use client";

import { useActionState } from "react";

import {
  convertQuotationAction,
  type BookingState,
} from "@/lib/bookings/actions";
import { Banner } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * "Convert to Booking" (Spec 4.3) — one click, carrying over the
 * customer, the items, and the prices.
 *
 * The new booking starts as Quoted rather than Reserved: reserving
 * stock is a deliberate act that runs the availability check, and it
 * should not happen as a side effect of pressing this.
 */
export function ConvertToBookingButton({
  quotationId,
}: {
  quotationId: string;
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(
    convertQuotationAction,
    {},
  );

  return (
    <div className="space-y-2">
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <form action={formAction}>
        <input type="hidden" name="quotation_id" value={quotationId} />
        <SubmitButton pendingLabel="Creating booking…">
          Convert to booking
        </SubmitButton>
      </form>
    </div>
  );
}
