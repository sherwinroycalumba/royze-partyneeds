"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getBusinessSettings, requirePermission, requireUser } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { diffChanges, logAudit } from "@/lib/audit";
import { componentSummary } from "@/lib/catalog/packages";
import { documentTotals } from "@/lib/documents/totals";
import { manilaLocalToInstant } from "@/lib/date";
import { checkbox, nullableText, pesoCentavos, text, type FormState } from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Booking, BookingLineType } from "@/lib/supabase/database.types";
import { DOCUMENT_PREFIXES } from "@/lib/quotations/numbering";
import {
  availabilityVerdict,
  findShortages,
  type StockRequest,
} from "./availability";
import {
  damageChargeFor,
  inventoryEffectFor,
  isReturnCondition,
  validateReturn,
  type ReturnRecord,
} from "./returns";
import {
  BOOKING_STATUS_LABELS,
  canEditItems,
  canRecordReturn,
  canTransition,
  confirmationVerdict,
  isBookingStatus,
} from "./status";
import { stockLevelsFor } from "./stock";
import { validateBooking, type BookingDraft, type BookingLineDraft } from "./validation";
import { reservationWindow } from "./windows";

export type BookingState = FormState;

/**
 * Booking writes (Spec 4.4).
 *
 * Every export re-checks its permission — a Server Action export is a
 * client-callable endpoint. Delivery Staff reach only
 * `setBookingStatusAction` and `recordReturnAction`, which is the
 * app-level half of the narrowing the RLS policy cannot express.
 */

const LINE_TYPES: readonly BookingLineType[] = [
  "rental",
  "sale",
  "package",
  "custom",
  "damage_charge",
];

function isLineType(value: string): value is BookingLineType {
  return (LINE_TYPES as readonly string[]).includes(value);
}

/** The only status moves Delivery Staff may make (Spec 3). */
const DELIVERY_TRANSITIONS: readonly string[] = [
  "out_for_delivery",
  "delivered",
  "picked_up",
];

/** A parent line as posted, before its package is expanded. */
type ParsedLine = BookingLineDraft & {
  catalog_item_id: string | null;
  package_id: string | null;
  component_summary: string;
  reserves_stock: boolean;
  consumes_stock: boolean;
};

function parseAmount(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (value === "") return 0;

  const formData = new FormData();
  formData.set("amount", value);
  return pesoCentavos(formData, "amount");
}

/** Reads the repeatable line rows the builder posts. */
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
    const lineType: BookingLineType = isLineType(rawType) ? rawType : "custom";
    const isPackage = lineType === "package";

    lines.push({
      line_type: lineType,
      catalog_item_id: isPackage || lineType === "custom" ? null : ref || null,
      package_id: isPackage ? ref || null : null,
      description,
      component_summary: (summaries[index] ?? "").trim(),
      quantity: Number.parseInt(rawQuantity, 10),
      unit_price_centavos: unitPrice,
      line_discount_centavos: discount,
      is_component: false,
      // A rental line holds stock for the window; a package holds
      // nothing itself — its components do, once expanded below.
      reserves_stock: lineType === "rental" && Boolean(ref),
      consumes_stock: lineType === "sale" && Boolean(ref),
    });
  }

  return lines;
}

/** A component row, waiting for its parent line's database id. */
type ExpandedComponent = Omit<ParsedLine, "is_component"> & {
  is_component: true;
  /** Index of the parent within the parsed line list. */
  parent_index: number;
};

/**
 * Expands every backdrop package into its parts (Spec 4.4).
 *
 * The components are stored at ₱0 — the package line above them
 * carries the price — but they are what the availability engine
 * reserves and what consumables come out of. Without them, two
 * backdrop bookings on one day would happily share a single arch.
 *
 * The bill of components comes from the saved package rather than the
 * form, so it is always the definition the catalog vouches for.
 */
async function expandPackages(
  lines: readonly ParsedLine[],
): Promise<{ components: ExpandedComponent[]; summaries: Map<number, string> }> {
  const packageIds = lines
    .map((line) => line.package_id)
    .filter((id): id is string => Boolean(id));

  if (packageIds.length === 0) {
    return { components: [], summaries: new Map() };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("backdrop_package_components")
    .select(
      "package_id, quantity, consumes_stock, sort_order, catalog_items(id, name, is_rental)",
    )
    .in("package_id", [...new Set(packageIds)])
    .order("sort_order", { ascending: true });

  const byPackage = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = byPackage.get(row.package_id) ?? [];
    list.push(row);
    byPackage.set(row.package_id, list);
  }

  const components: ExpandedComponent[] = [];
  const summaries = new Map<number, string>();

  lines.forEach((line, parentIndex) => {
    if (!line.package_id) return;
    const parts = byPackage.get(line.package_id) ?? [];

    summaries.set(
      parentIndex,
      componentSummary(
        parts.map((part) => ({
          name: part.catalog_items?.name ?? "",
          quantity: part.quantity,
        })),
      ),
    );

    for (const part of parts) {
      const item = part.catalog_items;
      if (!item) continue;

      components.push({
        line_type: part.consumes_stock ? "sale" : "rental",
        catalog_item_id: item.id,
        package_id: null,
        description: item.name,
        component_summary: "",
        // Two of a package means two of each of its parts.
        quantity: part.quantity * line.quantity,
        unit_price_centavos: 0,
        line_discount_centavos: 0,
        is_component: true,
        reserves_stock: !part.consumes_stock && item.is_rental,
        consumes_stock: part.consumes_stock,
        parent_index: parentIndex,
      });
    }
  });

  return { components, summaries };
}

/** Everything a booking needs, read off the form. */
type ParsedBooking = {
  draft: BookingDraft;
  lines: ParsedLine[];
  components: ExpandedComponent[];
  record: Omit<
    Booking,
    | "id"
    | "booking_number"
    | "status"
    | "created_by"
    | "created_at"
    | "updated_at"
    | "agreement_signed"
    | "agreement_signed_at"
    | "confirmation_override_reason"
    | "reserved_at"
    | "confirmed_at"
    | "delivered_at"
    | "returned_at"
    | "completed_at"
    | "cancelled_at"
    | "cancellation_reason"
    | "source_quotation_id"
  >;
};

async function readBooking(
  formData: FormData,
): Promise<ParsedBooking | { error: string }> {
  const lines = readLines(formData);
  if ("error" in lines) return lines;

  const { components, summaries } = await expandPackages(lines);
  // Print the package's parts under its single priced line (Spec 4.4).
  lines.forEach((line, index) => {
    const summary = summaries.get(index);
    if (summary) line.component_summary = summary;
  });

  const withinFreeArea = checkbox(formData, "within_free_delivery_area");
  const deliveryFee = pesoCentavos(formData, "delivery_fee");
  const discount = pesoCentavos(formData, "discount");

  if (deliveryFee === null || discount === null) {
    return { error: "Enter the fee and discount as plain amounts, e.g. 500.00." };
  }

  const settings = await getBusinessSettings();
  const percent = text(formData, "downpayment_percent");
  const downpaymentPercent =
    percent === ""
      ? (settings?.downpayment_percent ?? 50)
      : Number.parseFloat(percent);

  if (!Number.isFinite(downpaymentPercent)) {
    return { error: "The downpayment percentage must be a number." };
  }

  const instant = (key: string) => {
    const raw = text(formData, key);
    return raw === "" ? null : manilaLocalToInstant(raw);
  };

  const schedule = {
    delivery_at: instant("delivery_at"),
    pickup_at: instant("pickup_at"),
    setup_at: instant("setup_at"),
    teardown_at: instant("teardown_at"),
  };

  for (const [key, value] of Object.entries(schedule)) {
    if (text(formData, key) !== "" && value === null) {
      return { error: "Enter the dates and times as a date and a time." };
    }
  }

  const eventDate = text(formData, "event_date");
  const window = reservationWindow({ event_date: eventDate, ...schedule });

  const record = {
    customer_id: text(formData, "customer_id"),
    event_date: eventDate,
    event_start_time: nullableText(formData, "event_start_time"),
    event_end_time: nullableText(formData, "event_end_time"),
    ...schedule,
    reserved_from: window.from,
    reserved_to: window.to,
    event_address: text(formData, "event_address"),
    landmark: text(formData, "landmark"),
    contact_person_name: text(formData, "contact_person_name"),
    contact_person_phone: text(formData, "contact_person_phone"),
    occasion: text(formData, "occasion"),
    theme_motif: text(formData, "theme_motif"),
    celebrant_name: text(formData, "celebrant_name"),
    reference_photo_urls: formData
      .getAll("reference_photo_url")
      .map(String)
      .map((url) => url.trim())
      .filter(Boolean),
    within_free_delivery_area: withinFreeArea,
    delivery_fee_centavos: withinFreeArea ? 0 : deliveryFee,
    delivery_fee_override_reason: withinFreeArea
      ? ""
      : text(formData, "delivery_fee_override_reason"),
    discount_centavos: discount,
    downpayment_percent: downpaymentPercent,
    availability_override_reason: text(formData, "availability_override_reason"),
    assigned_delivery_staff: nullableText(formData, "assigned_delivery_staff"),
    notes: text(formData, "notes"),
    internal_notes: text(formData, "internal_notes"),
  };

  const draft: BookingDraft = {
    customer_id: record.customer_id,
    event_date: record.event_date,
    delivery_at: record.delivery_at,
    pickup_at: record.pickup_at,
    setup_at: record.setup_at,
    teardown_at: record.teardown_at,
    lines: [...lines, ...components],
    within_free_delivery_area: record.within_free_delivery_area,
    delivery_fee_centavos: record.delivery_fee_centavos,
    discount_centavos: record.discount_centavos,
    downpayment_percent: record.downpayment_percent,
  };

  const invalid = validateBooking(draft);
  if (invalid) return { error: invalid };

  return { draft, lines, components, record };
}

/**
 * Runs the availability check (Spec 4.4).
 *
 * Every rental line and every rental component counts, so a package
 * competes for the same arch as a directly-added one.
 */
async function checkAvailability({
  lines,
  components,
  window,
  excludeBookingId,
  isOwner,
  overrideReason,
}: {
  lines: readonly ParsedLine[];
  components: readonly ExpandedComponent[];
  window: { from: string; to: string };
  excludeBookingId: string | null;
  isOwner: boolean;
  overrideReason: string;
}): Promise<{ allowed: boolean; error?: string; shortageCount: number }> {
  const requests: StockRequest[] = [...lines, ...components]
    .filter((line) => line.reserves_stock && line.catalog_item_id)
    .map((line) => ({
      catalog_item_id: line.catalog_item_id as string,
      name: line.description,
      quantity: line.quantity,
    }));

  if (requests.length === 0) {
    return { allowed: true, shortageCount: 0 };
  }

  const levels = await stockLevelsFor({
    itemIds: requests.map((request) => request.catalog_item_id),
    window,
    excludeBookingId,
  });

  const shortages = findShortages(requests, levels);
  const verdict = availabilityVerdict({ shortages, isOwner, overrideReason });

  return { ...verdict, shortageCount: shortages.length };
}

/** Writes the parent lines, then their components against the new ids. */
async function replaceLines(
  bookingId: string,
  lines: readonly ParsedLine[],
  components: readonly ExpandedComponent[],
): Promise<string | null> {
  const supabase = await createClient();

  // Components cascade from their parents, so clearing the parents is
  // enough — but damage charges must survive an edit of the items.
  const { error: clearError } = await supabase
    .from("booking_items")
    .delete()
    .eq("booking_id", bookingId)
    .neq("line_type", "damage_charge");

  if (clearError) return clearError.message;

  const { data: parents, error } = await supabase
    .from("booking_items")
    .insert(
      lines.map((line, index) => ({
        booking_id: bookingId,
        line_type: line.line_type,
        catalog_item_id: line.catalog_item_id,
        package_id: line.package_id,
        description: line.description,
        component_summary: line.component_summary,
        quantity: line.quantity,
        unit_price_centavos: line.unit_price_centavos,
        line_discount_centavos: line.line_discount_centavos,
        reserves_stock: line.reserves_stock,
        consumes_stock: line.consumes_stock,
        sort_order: index,
      })),
    )
    .select("id, sort_order");

  if (error) return error.message;

  if (components.length === 0) return null;

  const parentIdByIndex = new Map(
    (parents ?? []).map((parent) => [parent.sort_order, parent.id]),
  );

  const { error: componentError } = await supabase.from("booking_items").insert(
    components.map((component, index) => ({
      booking_id: bookingId,
      line_type: component.line_type,
      catalog_item_id: component.catalog_item_id,
      parent_item_id: parentIdByIndex.get(component.parent_index) ?? null,
      is_component: true,
      description: component.description,
      quantity: component.quantity,
      unit_price_centavos: 0,
      line_discount_centavos: 0,
      reserves_stock: component.reserves_stock,
      consumes_stock: component.consumes_stock,
      sort_order: lines.length + index,
    })),
  );

  return componentError?.message ?? null;
}

function revalidateBookings(id?: string): void {
  revalidatePath("/bookings");
  if (id) revalidatePath(`/bookings/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// ── Create ────────────────────────────────────────────────────
export async function createBookingAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const actor = await requirePermission("bookings.manage");

  const parsed = await readBooking(formData);
  if ("error" in parsed) return parsed;

  const availability = await checkAvailability({
    lines: parsed.lines,
    components: parsed.components,
    window: {
      from: parsed.record.reserved_from,
      to: parsed.record.reserved_to,
    },
    excludeBookingId: null,
    isOwner: actor.role === "owner",
    overrideReason: parsed.record.availability_override_reason,
  });

  if (!availability.allowed) return { error: availability.error };

  const supabase = await createClient();
  const { data: bookingNumber, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_prefix: DOCUMENT_PREFIXES.booking },
  );

  if (numberError || !bookingNumber) {
    return {
      error: `Could not reserve a booking number: ${numberError?.message ?? "unknown error"}`,
    };
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      ...parsed.record,
      booking_number: bookingNumber,
      status: "inquiry",
      created_by: actor.id,
    })
    .select("id, booking_number")
    .single();

  if (error) return { error: error.message };

  const lineError = await replaceLines(data.id, parsed.lines, parsed.components);
  if (lineError) {
    return { error: `Booking saved, but its items did not: ${lineError}` };
  }

  const totals = documentTotals(parsed.draft);

  await logAudit({
    action: "booking.create",
    entityType: "booking",
    entityId: data.id,
    summary: `Created booking ${data.booking_number} for ${formatPeso(totals.total_centavos)}`,
    details: {
      ...parsed.record,
      line_count: parsed.lines.length,
      component_count: parsed.components.length,
      total_centavos: totals.total_centavos,
    },
  });

  await logOverbooking(data.id, data.booking_number, parsed.record, availability);

  revalidateBookings(data.id);
  redirect(`/bookings/${data.id}`);
}

/** An Owner booking past the stock on hand is worth its own entry. */
async function logOverbooking(
  bookingId: string,
  bookingNumber: string,
  record: { availability_override_reason: string },
  availability: { shortageCount: number },
): Promise<void> {
  if (availability.shortageCount === 0) return;
  if (!record.availability_override_reason.trim()) return;

  await logAudit({
    action: "booking.availability_override",
    entityType: "booking",
    entityId: bookingId,
    summary: `${bookingNumber} booked past available stock — ${record.availability_override_reason}`,
    details: {
      shortage_count: availability.shortageCount,
      reason: record.availability_override_reason,
    },
  });
}

// ── Update ────────────────────────────────────────────────────
export async function updateBookingAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const actor = await requirePermission("bookings.manage");

  const bookingId = text(formData, "booking_id");
  if (!bookingId) return { error: "Missing booking." };

  const parsed = await readBooking(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (loadError || !before) return { error: "That booking no longer exists." };

  if (!canEditItems(before.status)) {
    return {
      error: `A ${BOOKING_STATUS_LABELS[before.status].toLowerCase()} booking is fixed — its items have already gone out.`,
    };
  }

  const availability = await checkAvailability({
    lines: parsed.lines,
    components: parsed.components,
    window: {
      from: parsed.record.reserved_from,
      to: parsed.record.reserved_to,
    },
    // A booking must not compete with itself for its own stock.
    excludeBookingId: bookingId,
    isOwner: actor.role === "owner",
    overrideReason: parsed.record.availability_override_reason,
  });

  if (!availability.allowed) return { error: availability.error };

  const { error } = await supabase
    .from("bookings")
    .update(parsed.record)
    .eq("id", bookingId);

  if (error) return { error: error.message };

  const lineError = await replaceLines(bookingId, parsed.lines, parsed.components);
  if (lineError) {
    return { error: `Booking saved, but its items did not: ${lineError}` };
  }

  await logAudit({
    action: "booking.update",
    entityType: "booking",
    entityId: bookingId,
    summary: `Updated booking ${before.booking_number}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      parsed.record as Record<string, unknown>,
    ),
  });

  if (
    parsed.record.delivery_fee_override_reason &&
    parsed.record.delivery_fee_centavos !== before.delivery_fee_centavos
  ) {
    await logAudit({
      action: "booking.delivery_fee_override",
      entityType: "booking",
      entityId: bookingId,
      summary: `Delivery fee on ${before.booking_number} set to ${formatPeso(parsed.record.delivery_fee_centavos)} — ${parsed.record.delivery_fee_override_reason}`,
      details: {
        from: before.delivery_fee_centavos,
        to: parsed.record.delivery_fee_centavos,
        reason: parsed.record.delivery_fee_override_reason,
      },
    });
  }

  await logOverbooking(
    bookingId,
    before.booking_number,
    parsed.record,
    availability,
  );

  revalidateBookings(bookingId);
  return { success: `${before.booking_number} saved.` };
}

// ── Status ────────────────────────────────────────────────────
/**
 * Moves a booking along its lifecycle (Spec 4.4), including the gate
 * on Confirmed: a signed agreement and verified payments covering the
 * downpayment, unless the Owner overrides with a logged reason.
 */
export async function setBookingStatusAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  // Delivery Staff move a booking through delivery, so this is the one
  // write they share with Booking Staff (Spec 3).
  const actor = await requireUser();
  if (!can(actor, "bookings.manage") && !can(actor, "delivery.update")) {
    return { error: "You cannot change a booking's status." };
  }

  const bookingId = text(formData, "booking_id");
  const target = text(formData, "status");

  if (!bookingId) return { error: "Missing booking." };
  if (!isBookingStatus(target)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("bookings")
    .select("*, booking_items(quantity, unit_price_centavos, line_discount_centavos, is_component)")
    .eq("id", bookingId)
    .single();

  if (loadError || !before) return { error: "That booking no longer exists." };

  if (!canTransition(before.status, target)) {
    return {
      error: `A ${BOOKING_STATUS_LABELS[before.status].toLowerCase()} booking cannot be marked ${BOOKING_STATUS_LABELS[target].toLowerCase()}.`,
    };
  }

  // Delivery Staff drive the van, not the commercial state of the
  // booking: they may report where the items are and nothing else.
  if (!can(actor, "bookings.manage") && !DELIVERY_TRANSITIONS.includes(target)) {
    return {
      error: `Only booking staff and the owner can mark a booking ${BOOKING_STATUS_LABELS[target].toLowerCase()}.`,
    };
  }

  const isOwner = actor.role === "owner";
  const patch: Partial<Booking> = { status: target };
  let overridden = false;

  if (target === "confirmed") {
    const totals = documentTotals({
      lines: (before.booking_items ?? []).filter((line) => !line.is_component),
      within_free_delivery_area: before.within_free_delivery_area,
      delivery_fee_centavos: before.delivery_fee_centavos,
      discount_centavos: before.discount_centavos,
      downpayment_percent: before.downpayment_percent,
    });

    // Verified payments only (Spec 4.7). Read through the database
    // function so a report and this gate can never disagree about
    // what "paid" means.
    const { data: verifiedPaid } = await supabase.rpc(
      "verified_paid_centavos",
      { p_booking: bookingId },
    );

    const verdict = confirmationVerdict({
      facts: {
        agreement_signed: before.agreement_signed,
        verified_paid_centavos: verifiedPaid ?? 0,
        total_centavos: totals.total_centavos,
        downpayment_percent: before.downpayment_percent,
      },
      isOwner,
      overrideReason: text(formData, "override_reason"),
    });

    if (!verdict.allowed) return { error: verdict.error };

    overridden = verdict.overridden;
    if (overridden) {
      patch.confirmation_override_reason = text(formData, "override_reason");
    }
    patch.confirmed_at = new Date().toISOString();
  }

  if (target === "cancelled") {
    const reason = text(formData, "cancellation_reason");
    if (!reason) {
      return { error: "Give a reason for cancelling — it goes on the record." };
    }
    if (!can(actor, "bookings.manage")) {
      return { error: "Only booking staff and the owner can cancel a booking." };
    }
    patch.cancellation_reason = reason;
    patch.cancelled_at = new Date().toISOString();
  }

  if (target === "reserved") patch.reserved_at = new Date().toISOString();
  if (target === "delivered") patch.delivered_at = new Date().toISOString();
  if (target === "picked_up") patch.returned_at = new Date().toISOString();
  if (target === "completed") patch.completed_at = new Date().toISOString();

  const { error } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", bookingId);

  if (error) return { error: error.message };

  // Consumables come out of sale stock the moment the booking is
  // confirmed (Spec 4.2) — they are used up, not lent.
  if (target === "confirmed") {
    await consumeStock(bookingId);
  }

  await logAudit({
    action: `booking.${target}`,
    entityType: "booking",
    entityId: bookingId,
    summary: `${before.booking_number} marked ${BOOKING_STATUS_LABELS[target]}${overridden ? " (owner override)" : ""}`,
    details: { from: before.status, to: target, ...patch },
  });

  revalidateBookings(bookingId);
  return { success: `${before.booking_number} is now ${BOOKING_STATUS_LABELS[target]}.` };
}

/** Decrements sale stock for every consumable on a confirmed booking. */
async function consumeStock(bookingId: string): Promise<void> {
  const supabase = await createClient();

  const { data: lines } = await supabase
    .from("booking_items")
    .select("id, catalog_item_id, quantity")
    .eq("booking_id", bookingId)
    .eq("consumes_stock", true)
    .eq("stock_consumed", false);

  for (const line of lines ?? []) {
    if (!line.catalog_item_id) continue;

    const { data: item } = await supabase
      .from("catalog_items")
      .select("stock_quantity")
      .eq("id", line.catalog_item_id)
      .single();

    if (!item) continue;

    await supabase
      .from("catalog_items")
      // Never below zero: a stock count that has drifted must not
      // become negative and poison every later calculation.
      .update({
        stock_quantity: Math.max(0, item.stock_quantity - line.quantity),
      })
      .eq("id", line.catalog_item_id);

    // Marked so a re-confirmation cannot decrement the same stock twice.
    await supabase
      .from("booking_items")
      .update({ stock_consumed: true })
      .eq("id", line.id);
  }
}

// ── Returns (Spec 4.4) ────────────────────────────────────────
/**
 * Records what came back and in what state.
 *
 * Damaged or lost items raise a charge line at the catalog's
 * replacement value, come off the available inventory, and land on the
 * audit trail so the incident shows on the customer's history.
 */
export async function recordReturnAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const actor = await requireUser();
  if (!can(actor, "delivery.update")) {
    return { error: "You cannot record returns." };
  }

  const bookingId = text(formData, "booking_id");
  if (!bookingId) return { error: "Missing booking." };

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number, status, customer_id")
    .eq("id", bookingId)
    .single();

  if (!booking) return { error: "That booking no longer exists." };

  if (!canRecordReturn(booking.status)) {
    return {
      error: `Returns are recorded once the items are out — this booking is ${BOOKING_STATUS_LABELS[booking.status].toLowerCase()}.`,
    };
  }

  const { data: lines } = await supabase
    .from("booking_items")
    .select("*, catalog_items(id, name, replacement_value_centavos, quantity_owned, damaged_quantity)")
    .eq("booking_id", bookingId)
    .neq("line_type", "damage_charge");

  const ids = formData.getAll("return_item_id").map(String);
  const conditions = formData.getAll("return_condition").map(String);
  const damaged = formData.getAll("return_damaged").map(String);
  const lost = formData.getAll("return_lost").map(String);
  const notes = formData.getAll("return_notes").map(String);

  const byId = new Map((lines ?? []).map((line) => [line.id, line]));
  const records: { record: ReturnRecord; line: NonNullable<typeof lines>[number] }[] = [];

  for (let index = 0; index < ids.length; index += 1) {
    const line = byId.get(ids[index]);
    if (!line) continue;

    const condition = conditions[index] ?? "pending";
    if (!isReturnCondition(condition)) {
      return { error: "Unknown condition on one of the lines." };
    }

    const count = (raw: string | undefined) => {
      const value = (raw ?? "").trim();
      if (value === "") return 0;
      return /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
    };

    const damagedCount = count(damaged[index]);
    const lostCount = count(lost[index]);

    if (Number.isNaN(damagedCount) || Number.isNaN(lostCount)) {
      return { error: `${line.description}: counts must be whole numbers.` };
    }

    const record: ReturnRecord = {
      booking_item_id: line.id,
      description: line.description,
      quantity: line.quantity,
      replacement_value_centavos:
        line.catalog_items?.replacement_value_centavos ?? 0,
      condition,
      damaged_quantity: damagedCount,
      lost_quantity: lostCount,
      notes: (notes[index] ?? "").trim(),
    };

    const invalid = validateReturn(record);
    if (invalid) return { error: invalid };

    records.push({ record, line });
  }

  if (records.length === 0) {
    return { error: "Nothing to record." };
  }

  // Everything validated before anything is written, so a bad row on
  // line eight cannot leave lines one to seven half-applied.
  let charged = 0;

  for (const { record, line } of records) {
    await supabase
      .from("booking_items")
      .update({
        return_condition: record.condition,
        return_notes: record.notes,
        damaged_quantity: record.damaged_quantity,
        lost_quantity: record.lost_quantity,
      })
      .eq("id", record.booking_item_id);

    const charge = damageChargeFor(record);
    if (charge) {
      // Replace any earlier charge for this line, so correcting a
      // return does not stack a second charge on the customer.
      await supabase
        .from("booking_items")
        .delete()
        .eq("booking_id", bookingId)
        .eq("line_type", "damage_charge")
        .eq("source_item_id", record.booking_item_id);

      await supabase.from("booking_items").insert({
        booking_id: bookingId,
        line_type: "damage_charge",
        description: charge.description,
        quantity: charge.quantity,
        unit_price_centavos: charge.unit_price_centavos,
        source_item_id: charge.source_item_id,
        sort_order: 900,
      });

      charged += charge.total_centavos;
    }

    const effect = inventoryEffectFor(record, line.catalog_item_id);
    const item = line.catalog_items;
    if (effect && item) {
      await supabase
        .from("catalog_items")
        .update({
          damaged_quantity: Math.max(
            0,
            item.damaged_quantity + effect.damaged_delta,
          ),
          quantity_owned: Math.max(0, item.quantity_owned + effect.owned_delta),
        })
        .eq("id", effect.catalog_item_id);
    }
  }

  const incidents = records.filter(
    ({ record }) => record.damaged_quantity + record.lost_quantity > 0,
  );

  await logAudit({
    action: "booking.return_recorded",
    entityType: "booking",
    entityId: bookingId,
    summary:
      incidents.length === 0
        ? `${booking.booking_number}: everything came back fine`
        : `${booking.booking_number}: ${incidents.length} line(s) damaged or lost, charged ${formatPeso(charged)}`,
    details: {
      customer_id: booking.customer_id,
      charged_centavos: charged,
      incidents: incidents.map(({ record }) => ({
        item: record.description,
        damaged: record.damaged_quantity,
        lost: record.lost_quantity,
        notes: record.notes,
      })),
    },
  });

  await supabase
    .from("bookings")
    .update({ returned_at: new Date().toISOString() })
    .eq("id", bookingId);

  revalidateBookings(bookingId);
  revalidatePath("/catalog");

  return {
    success:
      charged > 0
        ? `Return recorded. ${formatPeso(charged)} charged for damage or loss.`
        : "Return recorded — everything came back fine.",
  };
}

// ── Convert a quotation (Spec 4.3) ────────────────────────────
/**
 * Turns an accepted quotation into a booking in one click, carrying
 * over the customer, the items, and the prices exactly as quoted.
 */
export async function convertQuotationAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const actor = await requirePermission("bookings.manage");

  const quotationId = text(formData, "quotation_id");
  if (!quotationId) return { error: "Missing quotation." };

  const supabase = await createClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("*, quotation_items(*)")
    .eq("id", quotationId)
    .single();

  if (!quotation) return { error: "That quotation no longer exists." };

  if (quotation.converted_booking_id) {
    return {
      error: "This quotation has already been converted to a booking.",
    };
  }

  if (!quotation.event_date) {
    return {
      error:
        "Add the event date to the quotation first — a booking has to sit on a date.",
    };
  }

  const window = reservationWindow({
    event_date: quotation.event_date,
    delivery_at: null,
    pickup_at: null,
    setup_at: null,
    teardown_at: null,
  });

  const { data: bookingNumber, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_prefix: DOCUMENT_PREFIXES.booking },
  );

  if (numberError || !bookingNumber) {
    return {
      error: `Could not reserve a booking number: ${numberError?.message ?? "unknown error"}`,
    };
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      booking_number: bookingNumber,
      customer_id: quotation.customer_id,
      // It has been quoted and accepted; reserving the stock is the
      // next decision, and it is a deliberate one.
      status: "quoted",
      source_quotation_id: quotation.id,
      event_date: quotation.event_date,
      reserved_from: window.from,
      reserved_to: window.to,
      event_address: quotation.event_address,
      occasion: quotation.occasion,
      within_free_delivery_area: quotation.within_free_delivery_area,
      delivery_fee_centavos: quotation.delivery_fee_centavos,
      delivery_fee_override_reason: quotation.delivery_fee_override_reason,
      discount_centavos: quotation.discount_centavos,
      downpayment_percent: quotation.downpayment_percent,
      notes: quotation.notes,
      internal_notes: quotation.internal_notes,
      created_by: actor.id,
    })
    .select("id, booking_number")
    .single();

  if (error) return { error: error.message };

  // Rebuilt through the same parser the builder uses, so packages
  // expand into their components and the booking reserves what it
  // actually needs — a quotation only ever stored the priced lines.
  const lines: ParsedLine[] = (quotation.quotation_items ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      line_type: item.line_type as BookingLineType,
      catalog_item_id: item.catalog_item_id,
      package_id: item.package_id,
      description: item.description,
      component_summary: item.component_summary,
      quantity: item.quantity,
      unit_price_centavos: item.unit_price_centavos,
      line_discount_centavos: item.line_discount_centavos,
      is_component: false,
      reserves_stock: item.line_type === "rental" && Boolean(item.catalog_item_id),
      consumes_stock: item.line_type === "sale" && Boolean(item.catalog_item_id),
    }));

  const { components } = await expandPackages(lines);

  const lineError = await replaceLines(booking.id, lines, components);
  if (lineError) {
    return { error: `Booking created, but its items did not: ${lineError}` };
  }

  await supabase
    .from("quotations")
    .update({ converted_booking_id: booking.id })
    .eq("id", quotationId);

  await logAudit({
    action: "quotation.converted",
    entityType: "booking",
    entityId: booking.id,
    summary: `${quotation.quotation_number} converted to booking ${booking.booking_number}`,
    details: {
      quotation_id: quotationId,
      quotation_number: quotation.quotation_number,
      line_count: lines.length,
    },
  });

  revalidateBookings(booking.id);
  revalidatePath(`/quotations/${quotationId}`);

  redirect(`/bookings/${booking.id}`);
}

/** Assigns the driver for the day (Spec 4.4). */
export async function assignDeliveryStaffAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  await requirePermission("bookings.manage");

  const bookingId = text(formData, "booking_id");
  if (!bookingId) return { error: "Missing booking." };

  const staffId = nullableText(formData, "assigned_delivery_staff");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ assigned_delivery_staff: staffId })
    .eq("id", bookingId)
    .select("booking_number")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "booking.assign_delivery",
    entityType: "booking",
    entityId: bookingId,
    summary: `${data.booking_number} assigned to ${staffId ?? "nobody"}`,
    details: { assigned_delivery_staff: staffId },
  });

  revalidateBookings(bookingId);
  return { success: "Delivery assignment saved." };
}
