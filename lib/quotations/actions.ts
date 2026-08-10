"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getBusinessSettings, requirePermission } from "@/lib/auth/dal";
import { diffChanges, logAudit } from "@/lib/audit";
import { todayInManila } from "@/lib/date";
import { checkbox, pesoCentavos, text, type FormState } from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type {
  Quotation,
  QuotationLineType,
  QuotationStatus,
} from "@/lib/supabase/database.types";
import { DOCUMENT_PREFIXES } from "./numbering";
import {
  canEditQuotation,
  canTransition,
  defaultValidUntil,
  effectiveStatus,
  isQuotationStatus,
  QUOTATION_STATUS_LABELS,
} from "./status";
import { documentTotals } from "@/lib/documents/totals";
import {
  validateQuotation,
  type QuotationDraft,
  type QuotationLineDraft,
} from "./validation";

export type QuotationState = FormState;

/**
 * Quotation writes (Spec 4.3).
 *
 * Every export re-checks `quotations.manage`: a Server Action export is
 * a client-callable endpoint, so the nav hiding a button proves nothing.
 * The arithmetic all comes from `./totals`, so what is stored, shown,
 * and printed cannot drift apart.
 */

const LINE_TYPES: readonly QuotationLineType[] = [
  "rental",
  "sale",
  "package",
  "custom",
];

function isLineType(value: string): value is QuotationLineType {
  return (LINE_TYPES as readonly string[]).includes(value);
}

/** A line as it arrives from the builder, before it is validated. */
type ParsedLine = QuotationLineDraft & {
  catalog_item_id: string | null;
  package_id: string | null;
  component_summary: string;
};

/**
 * Reads the repeatable line rows.
 *
 * They post as parallel arrays, one entry per row, exactly like the
 * package component editor — so a row left blank by a staff member
 * tabbing through the form is skipped rather than failing the save.
 */
function readLines(formData: FormData): ParsedLine[] | { error: string } {
  const types = formData.getAll("line_type").map(String);
  const refs = formData.getAll("line_ref").map(String);
  const descriptions = formData.getAll("line_description").map(String);
  const summaries = formData.getAll("line_summary").map(String);
  const quantities = formData.getAll("line_quantity").map(String);
  const prices = formData.getAll("line_unit_price").map(String);
  const discounts = formData.getAll("line_discount").map(String);

  const lines: ParsedLine[] = [];

  for (let index = 0; index < descriptions.length; index += 1) {
    const description = (descriptions[index] ?? "").trim();
    const ref = (refs[index] ?? "").trim();

    // An untouched blank row must never block the save.
    if (!description && !ref) continue;

    const rawQuantity = (quantities[index] ?? "1").trim() || "1";
    if (!/^\d+$/.test(rawQuantity)) {
      return { error: `Line ${index + 1}: quantity must be a whole number.` };
    }

    const unitPrice = parseAmount(prices[index]);
    const discount = parseAmount(discounts[index]);
    if (unitPrice === null || discount === null) {
      return {
        error: `Line ${index + 1}: enter amounts as plain numbers, e.g. 1,250.00.`,
      };
    }

    const rawType = types[index] ?? "custom";
    const lineType: QuotationLineType = isLineType(rawType) ? rawType : "custom";

    lines.push({
      line_type: lineType,
      // The reference is kept so reports can group by item, but the
      // description and price below are snapshots — a later catalog
      // edit must not restate a quotation the customer is holding.
      catalog_item_id:
        lineType === "package" || lineType === "custom" ? null : ref || null,
      package_id: lineType === "package" ? ref || null : null,
      description,
      component_summary: (summaries[index] ?? "").trim(),
      quantity: Number.parseInt(rawQuantity, 10),
      unit_price_centavos: unitPrice,
      line_discount_centavos: discount,
    });
  }

  return lines;
}

/** Blank reads as ₱0.00; malformed reads as null so it can be rejected. */
function parseAmount(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (value === "") return 0;

  const formData = new FormData();
  formData.set("amount", value);
  return pesoCentavos(formData, "amount");
}

type ParsedQuotation = {
  draft: QuotationDraft;
  lines: ParsedLine[];
  record: {
    customer_id: string;
    issue_date: string;
    valid_until: string;
    event_date: string | null;
    event_address: string;
    occasion: string;
    within_free_delivery_area: boolean;
    delivery_fee_centavos: number;
    delivery_fee_override_reason: string;
    discount_centavos: number;
    downpayment_percent: number;
    notes: string;
    internal_notes: string;
  };
};

async function readQuotation(
  formData: FormData,
): Promise<ParsedQuotation | { error: string }> {
  const lines = readLines(formData);
  if ("error" in lines) return lines;

  const withinFreeArea = checkbox(formData, "within_free_delivery_area");
  const deliveryFee = pesoCentavos(formData, "delivery_fee");
  const discount = pesoCentavos(formData, "discount");

  if (deliveryFee === null || discount === null) {
    return { error: "Enter the fee and discount as plain amounts, e.g. 500.00." };
  }

  const downpaymentPercent = readPercent(formData, "downpayment_percent");
  if (downpaymentPercent === null) {
    return { error: "The downpayment percentage must be between 0 and 100." };
  }

  const settings = await getBusinessSettings();
  const issueDate = text(formData, "issue_date") || todayInManila();
  const validUntil =
    text(formData, "valid_until") ||
    defaultValidUntil(issueDate, settings?.quotation_validity_days ?? 7);

  const record = {
    customer_id: text(formData, "customer_id"),
    issue_date: issueDate,
    valid_until: validUntil,
    event_date: text(formData, "event_date") || null,
    event_address: text(formData, "event_address"),
    occasion: text(formData, "occasion"),
    within_free_delivery_area: withinFreeArea,
    // The toggle wins over whatever is left in the fee box, so the
    // stored fee can never contradict the "FREE Delivery" line the
    // customer reads on the PDF (Spec 4.4).
    delivery_fee_centavos: withinFreeArea ? 0 : deliveryFee,
    delivery_fee_override_reason: withinFreeArea
      ? ""
      : text(formData, "delivery_fee_override_reason"),
    discount_centavos: discount,
    // Blank falls back to the configured default rather than failing:
    // the field is prefilled, and staff clearing it mean "the usual".
    downpayment_percent:
      downpaymentPercent ?? settings?.downpayment_percent ?? 50,
    notes: text(formData, "notes"),
    internal_notes: text(formData, "internal_notes"),
  };

  const draft: QuotationDraft = {
    ...record,
    lines,
    delivery_fee_override_reason: record.delivery_fee_override_reason,
  };

  const invalid = validateQuotation(draft);
  if (invalid) return { error: invalid };

  return { draft, lines, record };
}

/**
 * A percentage like "50" or "12.5".
 *
 * Three outcomes, deliberately distinct: `undefined` for a blank field
 * (the caller falls back to the configured default), `null` for junk
 * (the caller rejects it), and the number otherwise.
 */
function readPercent(
  formData: FormData,
  key: string,
): number | null | undefined {
  const raw = text(formData, key);
  if (raw === "") return undefined;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Replaces a quotation's line rows with the submitted set. */
async function replaceLines(
  quotationId: string,
  lines: readonly ParsedLine[],
): Promise<string | null> {
  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", quotationId);

  if (clearError) return clearError.message;

  const { error } = await supabase.from("quotation_items").insert(
    lines.map((line, index) => ({
      quotation_id: quotationId,
      line_type: line.line_type,
      catalog_item_id: line.catalog_item_id,
      package_id: line.package_id,
      description: line.description,
      component_summary: line.component_summary,
      quantity: line.quantity,
      unit_price_centavos: line.unit_price_centavos,
      line_discount_centavos: line.line_discount_centavos,
      sort_order: index,
    })),
  );

  return error?.message ?? null;
}

function revalidateQuotations(id?: string): void {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
  revalidatePath("/dashboard");
}

// ── Create ────────────────────────────────────────────────────
export async function createQuotationAction(
  _prev: QuotationState,
  formData: FormData,
): Promise<QuotationState> {
  await requirePermission("quotations.manage");

  const parsed = await readQuotation(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();

  // Reserved under a row lock in the database, so two staff saving at
  // the same moment cannot both be handed QT-2026-0007.
  const { data: quotationNumber, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_prefix: DOCUMENT_PREFIXES.quotation },
  );

  if (numberError || !quotationNumber) {
    return {
      error: `Could not reserve a quotation number: ${numberError?.message ?? "unknown error"}`,
    };
  }

  const { data, error } = await supabase
    .from("quotations")
    .insert({
      ...parsed.record,
      quotation_number: quotationNumber,
      status: "draft",
    })
    .select("id, quotation_number")
    .single();

  if (error) return { error: error.message };

  const lineError = await replaceLines(data.id, parsed.lines);
  if (lineError) {
    return { error: `Quotation saved, but its items did not: ${lineError}` };
  }

  const totals = documentTotals(parsed.draft);

  await logAudit({
    action: "quotation.create",
    entityType: "quotation",
    entityId: data.id,
    summary: `Created quotation ${data.quotation_number} for ${formatPeso(totals.total_centavos)}`,
    details: {
      ...parsed.record,
      line_count: parsed.lines.length,
      total_centavos: totals.total_centavos,
    },
  });

  revalidateQuotations(data.id);

  // Straight to the new quotation: the next thing staff do is download
  // the PDF and send it (Spec 7 — under two minutes, start to finish).
  redirect(`/quotations/${data.id}`);
}

// ── Update ────────────────────────────────────────────────────
export async function updateQuotationAction(
  _prev: QuotationState,
  formData: FormData,
): Promise<QuotationState> {
  await requirePermission("quotations.manage");

  const quotationId = text(formData, "quotation_id");
  if (!quotationId) return { error: "Missing quotation." };

  const parsed = await readQuotation(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", quotationId)
    .single();

  if (loadError || !before) return { error: "That quotation no longer exists." };

  if (!canEditQuotation(before.status)) {
    return {
      error:
        "This quotation has been accepted, so its items are fixed. Create a new one for any changes.",
    };
  }

  const { error } = await supabase
    .from("quotations")
    .update(parsed.record)
    .eq("id", quotationId);

  if (error) return { error: error.message };

  const lineError = await replaceLines(quotationId, parsed.lines);
  if (lineError) {
    return { error: `Quotation saved, but its items did not: ${lineError}` };
  }

  await logAudit({
    action: "quotation.update",
    entityType: "quotation",
    entityId: quotationId,
    summary: `Updated quotation ${before.quotation_number}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      parsed.record as Record<string, unknown>,
    ),
  });

  // A fee that differs from the area's suggestion is a judgement call
  // someone may have to answer for later, so it is logged on its own
  // rather than buried in the diff (Spec 4.4).
  if (
    parsed.record.delivery_fee_override_reason &&
    parsed.record.delivery_fee_centavos !== before.delivery_fee_centavos
  ) {
    await logAudit({
      action: "quotation.delivery_fee_override",
      entityType: "quotation",
      entityId: quotationId,
      summary: `Delivery fee on ${before.quotation_number} set to ${formatPeso(parsed.record.delivery_fee_centavos)} — ${parsed.record.delivery_fee_override_reason}`,
      details: {
        from: before.delivery_fee_centavos,
        to: parsed.record.delivery_fee_centavos,
        reason: parsed.record.delivery_fee_override_reason,
      },
    });
  }

  revalidateQuotations(quotationId);
  return { success: `${before.quotation_number} saved.` };
}

// ── Status ────────────────────────────────────────────────────
/**
 * Moves a quotation along its lifecycle (Spec 4.3).
 *
 * The transition is checked against the *effective* status, so a
 * quotation that lapsed overnight is treated as expired even though
 * nothing has rewritten the stored value.
 */
export async function setQuotationStatusAction(
  _prev: QuotationState,
  formData: FormData,
): Promise<QuotationState> {
  await requirePermission("quotations.manage");

  const quotationId = text(formData, "quotation_id");
  const target = text(formData, "status");

  if (!quotationId) return { error: "Missing quotation." };
  if (!isQuotationStatus(target)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", quotationId)
    .single();

  if (loadError || !before) return { error: "That quotation no longer exists." };

  const today = todayInManila();
  const current = effectiveStatus(before.status, before.valid_until, today);

  if (!canTransition(current, target)) {
    return {
      error: `A ${QUOTATION_STATUS_LABELS[current].toLowerCase()} quotation cannot be marked ${QUOTATION_STATUS_LABELS[target].toLowerCase()}.`,
    };
  }

  const patch: Partial<Quotation> = { status: target };

  if (target === "sent") {
    patch.sent_at = new Date().toISOString();
    // Re-sending a lapsed quotation gives it a fresh validity window;
    // sending one that is still live leaves the customer's deadline
    // exactly where they were told it was.
    if (current === "expired" || current === "declined") {
      const settings = await getBusinessSettings();
      patch.valid_until = defaultValidUntil(
        today,
        settings?.quotation_validity_days ?? 7,
      );
      patch.decided_at = null;
    }
  } else {
    patch.decided_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("quotations")
    .update(patch)
    .eq("id", quotationId);

  if (error) return { error: error.message };

  await logAudit({
    action: `quotation.${target}`,
    entityType: "quotation",
    entityId: quotationId,
    summary: `${before.quotation_number} marked ${QUOTATION_STATUS_LABELS[target]}`,
    details: { from: current, to: target, ...patch },
  });

  revalidateQuotations(quotationId);

  return {
    success: statusMessage(target, patch.valid_until ?? before.valid_until),
  };
}

function statusMessage(status: QuotationStatus, validUntil: string): string {
  switch (status) {
    case "sent":
      return `Marked as sent — valid until ${validUntil}.`;
    case "accepted":
      return "Marked as accepted. Convert it to a booking to reserve the items.";
    case "declined":
      return "Marked as declined.";
    default:
      return `Marked ${QUOTATION_STATUS_LABELS[status]}.`;
  }
}
