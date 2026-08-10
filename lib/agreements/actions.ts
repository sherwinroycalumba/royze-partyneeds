"use server";

import { revalidatePath } from "next/cache";

import { getBusinessSettings, requirePermission } from "@/lib/auth/dal";
import { logAudit } from "@/lib/audit";
import { documentTotals } from "@/lib/documents/totals";
import { text, type FormState } from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { DOCUMENT_PREFIXES } from "@/lib/quotations/numbering";
import { uploadFile, UploadError } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { RentalAgreement } from "@/lib/supabase/database.types";
import {
  AGREEMENT_STATUS_LABELS,
  canRegenerate,
  canTransition,
  isAgreementStatus,
} from "./status";

export type AgreementState = FormState;

/**
 * Rental agreement workflow (Spec 4.5).
 *
 * Signing is what opens half the Confirmed gate, so the flag the gate
 * reads (`bookings.agreement_signed`) is written by a database trigger
 * off this table rather than by any of these functions — one writer,
 * no chance of the two disagreeing.
 */

function revalidateBooking(bookingId: string): void {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

/**
 * Generates the agreement for a booking, snapshotting the clauses and
 * the figures as they stand right now (Spec 4.5).
 */
export async function generateAgreementAction(
  _prev: AgreementState,
  formData: FormData,
): Promise<AgreementState> {
  const actor = await requirePermission("bookings.manage");

  const bookingId = text(formData, "booking_id");
  if (!bookingId) return { error: "Missing booking." };

  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, within_free_delivery_area, delivery_fee_centavos, discount_centavos, downpayment_percent, booking_items(quantity, unit_price_centavos, line_discount_centavos, is_component, line_type)",
    )
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "That booking no longer exists." };

  const { data: existing } = await supabase
    .from("rental_agreements")
    .select("id, agreement_number, status")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (existing && !canRegenerate(existing.status)) {
    return {
      error: `${existing.agreement_number} has been signed. Re-generating would discard a document the client put their name to.`,
    };
  }

  const settings = await getBusinessSettings();

  const totals = documentTotals({
    lines: (booking.booking_items ?? []).filter((line) => !line.is_component),
    within_free_delivery_area: booking.within_free_delivery_area,
    delivery_fee_centavos: booking.delivery_fee_centavos,
    discount_centavos: booking.discount_centavos,
    downpayment_percent: booking.downpayment_percent,
  });

  // Snapshotted so editing the template later cannot restate a
  // document somebody is holding (Spec 4.5).
  const snapshot = {
    clauses: settings?.agreement_clauses ?? [],
    total_centavos: totals.total_centavos,
    downpayment_centavos: totals.downpayment_centavos,
  };

  if (existing) {
    const { error } = await supabase
      .from("rental_agreements")
      .update({ ...snapshot, status: "generated", sent_at: null })
      .eq("id", existing.id);

    if (error) return { error: error.message };

    await logAudit({
      action: "agreement.regenerate",
      entityType: "rental_agreement",
      entityId: existing.id,
      summary: `Re-generated ${existing.agreement_number} for ${booking.booking_number}`,
      details: snapshot,
    });

    revalidateBooking(bookingId);
    return { success: `${existing.agreement_number} re-generated.` };
  }

  const { data: agreementNumber, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_prefix: DOCUMENT_PREFIXES.agreement },
  );

  if (numberError || !agreementNumber) {
    return {
      error: `Could not reserve an agreement number: ${numberError?.message ?? "unknown error"}`,
    };
  }

  const { data, error } = await supabase
    .from("rental_agreements")
    .insert({
      ...snapshot,
      agreement_number: agreementNumber,
      booking_id: bookingId,
      status: "generated",
      generated_by: actor.id,
    })
    .select("id, agreement_number")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "agreement.generate",
    entityType: "rental_agreement",
    entityId: data.id,
    summary: `Generated ${data.agreement_number} for ${booking.booking_number} at ${formatPeso(totals.total_centavos)}`,
    details: { booking_id: bookingId, ...snapshot },
  });

  revalidateBooking(bookingId);
  return { success: `${data.agreement_number} generated.` };
}

/**
 * Moves the agreement along, and — for "signed" — takes the optional
 * photo of the signed copy into the private documents bucket.
 */
export async function setAgreementStatusAction(
  _prev: AgreementState,
  formData: FormData,
): Promise<AgreementState> {
  await requirePermission("bookings.manage");

  const agreementId = text(formData, "agreement_id");
  const target = text(formData, "status");

  if (!agreementId) return { error: "Missing agreement." };
  if (!isAgreementStatus(target)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("rental_agreements")
    .select("*")
    .eq("id", agreementId)
    .single();

  if (!before) return { error: "That agreement no longer exists." };

  if (!canTransition(before.status, target)) {
    return {
      error: `A ${AGREEMENT_STATUS_LABELS[before.status].toLowerCase()} agreement cannot be marked ${AGREEMENT_STATUS_LABELS[target].toLowerCase()}.`,
    };
  }

  const patch: Partial<RentalAgreement> = { status: target };

  if (target === "sent") {
    patch.sent_at = new Date().toISOString();
  }

  if (target === "signed") {
    patch.signed_at = new Date().toISOString();
    patch.signed_by_name = text(formData, "signed_by_name");

    const photo = formData.get("signed_copy");
    if (photo instanceof File && photo.size > 0) {
      try {
        // The private bucket: a signed contract is not public.
        patch.signed_copy_path = await uploadFile(
          "documents",
          `agreements/${agreementId}`,
          photo,
        );
      } catch (uploadError) {
        if (uploadError instanceof UploadError) {
          return { error: uploadError.message };
        }
        throw uploadError;
      }
    }
  }

  const { error } = await supabase
    .from("rental_agreements")
    .update(patch)
    .eq("id", agreementId);

  if (error) return { error: error.message };

  await logAudit({
    action: `agreement.${target}`,
    entityType: "rental_agreement",
    entityId: agreementId,
    summary: `${before.agreement_number} marked ${AGREEMENT_STATUS_LABELS[target]}`,
    details: { from: before.status, to: target, ...patch },
  });

  revalidateBooking(before.booking_id);

  return {
    success:
      target === "signed"
        ? `${before.agreement_number} marked signed — the booking can now be confirmed once payments clear.`
        : `${before.agreement_number} marked ${AGREEMENT_STATUS_LABELS[target].toLowerCase()}.`,
  };
}
