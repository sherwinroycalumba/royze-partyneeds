"use server";

import { revalidatePath } from "next/cache";

import { requireOwner, requirePermission } from "@/lib/auth/dal";
import { logAudit } from "@/lib/audit";
import { pesoCentavos, text, type FormState } from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { uploadFile, UploadError } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { todayInManila } from "@/lib/date";
import type { Payment } from "@/lib/supabase/database.types";
import {
  canChangeStatus,
  initialStatus,
  isPaymentMethod,
  PAYMENT_METHOD_LABELS,
  validatePayment,
} from "./methods";

export type PaymentState = FormState;

/**
 * Payments and the verification workflow (Spec 4.7).
 *
 * The rule this module enforces: Booking Staff may *record* a payment,
 * but only the Owner may say it is real. Cash is the exception — the
 * person recording it is holding it — and that exception lives in one
 * pure function so it cannot drift.
 *
 * The database agrees: only the Owner holds an UPDATE policy on
 * `payments`, so verification is not merely a hidden button.
 */

function revalidatePayments(bookingId: string | null): void {
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  if (bookingId) {
    revalidatePath(`/bookings/${bookingId}`);
    revalidatePath("/bookings");
  }
}

/** Records a payment against a booking. */
export async function recordPaymentAction(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const actor = await requirePermission("payments.record");

  const bookingId = text(formData, "booking_id");
  if (!bookingId) return { error: "Missing booking." };

  const amount = pesoCentavos(formData, "amount");
  const method = text(formData, "method");

  if (amount === null) {
    return { error: "Enter the amount as a plain number, e.g. 5,000.00." };
  }
  if (!isPaymentMethod(method)) {
    return { error: "Choose how the payment was made." };
  }

  const draft = {
    amount_centavos: amount,
    method,
    paid_on: text(formData, "paid_on") || todayInManila(),
    reference_number: text(formData, "reference_number"),
  };

  const invalid = validatePayment(draft);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "That booking no longer exists." };

  let screenshotPath: string | null = null;
  const screenshot = formData.get("screenshot");
  if (screenshot instanceof File && screenshot.size > 0) {
    try {
      // Private bucket — a payment screenshot shows account details.
      screenshotPath = await uploadFile(
        "documents",
        `payments/${bookingId}`,
        screenshot,
      );
    } catch (error) {
      if (error instanceof UploadError) return { error: error.message };
      throw error;
    }
  }

  // Cash is verified on sight; everything else waits for the Owner.
  const status = initialStatus(method);

  const { data, error } = await supabase
    .from("payments")
    .insert({
      booking_id: bookingId,
      paid_on: draft.paid_on,
      amount_centavos: draft.amount_centavos,
      method,
      reference_number: draft.reference_number,
      screenshot_path: screenshotPath,
      notes: text(formData, "notes"),
      status,
      verified_by: status === "verified" ? actor.id : null,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      recorded_by: actor.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "payment.record",
    entityType: "payment",
    entityId: data.id,
    summary: `${formatPeso(draft.amount_centavos)} ${PAYMENT_METHOD_LABELS[method]} recorded against ${booking.booking_number}${status === "verified" ? " (auto-verified)" : " — pending verification"}`,
    details: { ...draft, booking_id: bookingId, status },
  });

  revalidatePayments(bookingId);

  return {
    success:
      status === "verified"
        ? `${formatPeso(draft.amount_centavos)} recorded and verified.`
        : `${formatPeso(draft.amount_centavos)} recorded — waiting on the owner to verify it.`,
  };
}

/**
 * Verifies or rejects a payment (Spec 4.7).
 *
 * Owner only, in the app *and* in the database. Until this runs, the
 * money does not count toward the 50% confirmation gate.
 */
export async function setPaymentStatusAction(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const actor = await requireOwner();

  const paymentId = text(formData, "payment_id");
  const target = text(formData, "status");

  if (!paymentId) return { error: "Missing payment." };
  if (target !== "verified" && target !== "rejected") {
    return { error: "A payment can only be verified or rejected." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("payments")
    .select("*, bookings(booking_number)")
    .eq("id", paymentId)
    .single();

  if (!before) return { error: "That payment no longer exists." };

  if (!canChangeStatus(before.status)) {
    return { error: "A rejected payment cannot be changed again." };
  }

  const patch: Partial<Payment> = { status: target };

  if (target === "verified") {
    patch.verified_by = actor.id;
    patch.verified_at = new Date().toISOString();
    patch.rejected_reason = "";
  } else {
    const reason = text(formData, "rejected_reason");
    if (!reason) {
      return {
        error: "Give a reason for rejecting it — it stays on the money trail.",
      };
    }
    patch.rejected_reason = reason;
    // A rejected payment was never money, so it holds no verification.
    patch.verified_by = null;
    patch.verified_at = null;
  }

  const { error } = await supabase
    .from("payments")
    .update(patch)
    .eq("id", paymentId);

  if (error) return { error: error.message };

  await logAudit({
    action: `payment.${target}`,
    entityType: "payment",
    entityId: paymentId,
    summary: `${formatPeso(before.amount_centavos)} ${PAYMENT_METHOD_LABELS[before.method]} on ${before.bookings?.booking_number ?? "a booking"} marked ${target}${target === "rejected" ? ` — ${patch.rejected_reason}` : ""}`,
    details: { from: before.status, to: target, ...patch },
  });

  revalidatePayments(before.booking_id);

  return {
    success:
      target === "verified"
        ? `${formatPeso(before.amount_centavos)} verified — it now counts toward confirming the booking.`
        : `${formatPeso(before.amount_centavos)} rejected.`,
  };
}
