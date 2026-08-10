"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOwner, requirePermission } from "@/lib/auth/dal";
import { logAudit } from "@/lib/audit";
import { todayInManila } from "@/lib/date";
import { nullableText, pesoCentavos, text, type FormState } from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { initialStatus, isPaymentMethod } from "@/lib/payments/methods";
import { DOCUMENT_PREFIXES } from "@/lib/quotations/numbering";
import { createClient } from "@/lib/supabase/server";
import { canVoid } from "./status";
import {
  describeDiscrepancies,
  findDiscrepancies,
  soldQuantities,
  stockAfterSale,
  stockAfterVoid,
  type StockLine,
  type StockOnHand,
} from "./stock";
import { orderTotals, validateOrder } from "./totals";

export type OrderState = FormState;

/**
 * Quick sales (Spec 4.6).
 *
 * The whole point is speed — "must take under ~30 seconds so quick
 * sales actually get recorded" — so the sale, its stock movement, and
 * its payment are one submission rather than three screens.
 */

type ParsedLine = StockLine & {
  unit_price_centavos: number;
  line_discount_centavos: number;
};

function parseAmount(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (value === "") return 0;

  const formData = new FormData();
  formData.set("amount", value);
  return pesoCentavos(formData, "amount");
}

function readLines(formData: FormData): ParsedLine[] | { error: string } {
  const refs = formData.getAll("line_ref").map(String);
  const descriptions = formData.getAll("line_description").map(String);
  const quantities = formData.getAll("line_quantity").map(String);
  const prices = formData.getAll("line_unit_price").map(String);
  const discounts = formData.getAll("line_discount").map(String);

  const lines: ParsedLine[] = [];

  for (let index = 0; index < descriptions.length; index += 1) {
    const description = (descriptions[index] ?? "").trim();
    if (!description) continue;

    const rawQuantity = (quantities[index] ?? "1").trim() || "1";
    if (!/^\d+$/.test(rawQuantity)) {
      return { error: `Line ${index + 1}: quantity must be a whole number.` };
    }

    const unitPrice = parseAmount(prices[index]);
    const discount = parseAmount(discounts[index]);
    if (unitPrice === null || discount === null) {
      return { error: `Line ${index + 1}: enter amounts as plain numbers.` };
    }

    lines.push({
      catalog_item_id: (refs[index] ?? "").trim() || null,
      description,
      quantity: Number.parseInt(rawQuantity, 10),
      unit_price_centavos: unitPrice,
      line_discount_centavos: discount,
    });
  }

  return lines;
}

/**
 * Rings up a sale: the order, its lines, the stock movement, and the
 * payment, in one go.
 */
export async function createOrderAction(
  _prev: OrderState,
  formData: FormData,
): Promise<OrderState> {
  const actor = await requirePermission("orders.manage");

  const lines = readLines(formData);
  if ("error" in lines) return lines;

  const discount = pesoCentavos(formData, "discount");
  if (discount === null) {
    return { error: "Enter the discount as a plain amount, e.g. 50.00." };
  }

  const customerId = nullableText(formData, "customer_id");
  const soldOn = text(formData, "sold_on") || todayInManila();
  // A walk-in has no directory record, which is the common case.
  const customerLabel = text(formData, "customer_label") || "Walk-in";

  const draft = {
    lines,
    discount_centavos: discount,
    customer_label: customerLabel,
    sold_on: soldOn,
  };

  const invalid = validateOrder(draft);
  if (invalid) return { error: invalid };

  const method = text(formData, "method");
  if (!isPaymentMethod(method)) {
    return { error: "Choose how the customer paid." };
  }

  const totals = orderTotals(draft);
  const supabase = await createClient();

  // Read stock before writing, so the discrepancy report reflects what
  // the shelf was believed to hold at the moment of sale.
  const itemIds = [...soldQuantities(lines).keys()];
  const { data: stockRows } = itemIds.length
    ? await supabase
        .from("catalog_items")
        .select("id, name, stock_quantity, low_stock_threshold")
        .in("id", itemIds)
    : { data: [] };

  const onHand: StockOnHand[] = (stockRows ?? []).map((row) => ({
    catalog_item_id: row.id,
    name: row.name,
    stock_quantity: row.stock_quantity,
    low_stock_threshold: row.low_stock_threshold,
  }));

  const discrepancies = findDiscrepancies(lines, onHand);

  const { data: orderNumber, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_prefix: DOCUMENT_PREFIXES.order },
  );

  if (numberError || !orderNumber) {
    return {
      error: `Could not reserve an order number: ${numberError?.message ?? "unknown error"}`,
    };
  }

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: customerId,
      customer_label: customerLabel,
      status: "completed",
      sold_on: soldOn,
      discount_centavos: totals.discount_centavos,
      notes: text(formData, "notes"),
      sold_by: actor.id,
    })
    .select("id, order_number")
    .single();

  if (error) return { error: error.message };

  const { error: lineError } = await supabase.from("order_items").insert(
    lines.map((line, index) => ({
      order_id: order.id,
      catalog_item_id: line.catalog_item_id,
      description: line.description,
      quantity: line.quantity,
      unit_price_centavos: line.unit_price_centavos,
      line_discount_centavos: line.line_discount_centavos,
      sort_order: index,
    })),
  );

  if (lineError) {
    return { error: `Sale saved, but its items did not: ${lineError.message}` };
  }

  // Stock leaves the shelf now, not on some later confirmation — the
  // customer is walking out with it.
  await applyStockMovement(lines, onHand, "sale");

  // Cash is verified on sight; an e-wallet sale waits for the Owner,
  // exactly as a booking payment does (Spec 4.7).
  const { error: paymentError } = await supabase.from("payments").insert({
    order_id: order.id,
    paid_on: soldOn,
    amount_centavos: totals.total_centavos,
    method,
    reference_number: text(formData, "reference_number"),
    status: initialStatus(method),
    verified_by: initialStatus(method) === "verified" ? actor.id : null,
    verified_at:
      initialStatus(method) === "verified" ? new Date().toISOString() : null,
    recorded_by: actor.id,
  });

  if (paymentError) {
    return {
      error: `Sale saved, but the payment did not: ${paymentError.message}`,
    };
  }

  await logAudit({
    action: "order.create",
    entityType: "order",
    entityId: order.id,
    summary: `${order.order_number}: ${formatPeso(totals.total_centavos)} to ${customerLabel} (${method})`,
    details: {
      customer_label: customerLabel,
      total_centavos: totals.total_centavos,
      method,
      line_count: lines.length,
      discrepancies,
    },
  });

  if (discrepancies.length > 0) {
    await logAudit({
      action: "order.stock_discrepancy",
      entityType: "order",
      entityId: order.id,
      summary: `${order.order_number}: ${describeDiscrepancies(discrepancies)}`,
      details: { discrepancies },
    });
  }

  revalidateOrders(order.id);
  redirect(`/orders/${order.id}`);
}

/** Applies the stock change for every catalogued line. */
async function applyStockMovement(
  lines: readonly StockLine[],
  onHand: readonly StockOnHand[],
  direction: "sale" | "void",
): Promise<void> {
  const supabase = await createClient();
  const byItem = new Map(onHand.map((item) => [item.catalog_item_id, item]));

  for (const [itemId, quantity] of soldQuantities(lines)) {
    const item = byItem.get(itemId);
    if (!item) continue;

    const next =
      direction === "sale"
        ? stockAfterSale(item.stock_quantity, quantity)
        : stockAfterVoid(item.stock_quantity, quantity);

    await supabase
      .from("catalog_items")
      .update({ stock_quantity: next })
      .eq("id", itemId);
  }
}

/**
 * Voids a sale (Spec 4.6 — nothing is deleted).
 *
 * Owner only: it moves money and stock back, and the mistake stays on
 * the record with its reason.
 */
export async function voidOrderAction(
  _prev: OrderState,
  formData: FormData,
): Promise<OrderState> {
  await requireOwner();

  const orderId = text(formData, "order_id");
  const reason = text(formData, "voided_reason");

  if (!orderId) return { error: "Missing order." };
  if (!reason) {
    return { error: "Give a reason for voiding it — it stays on the record." };
  }

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*, order_items(catalog_item_id, description, quantity)")
    .eq("id", orderId)
    .single();

  if (!order) return { error: "That sale no longer exists." };

  if (!canVoid(order.status)) {
    return { error: "That sale has already been voided." };
  }

  const lines: StockLine[] = (order.order_items ?? []).map((line) => ({
    catalog_item_id: line.catalog_item_id,
    description: line.description,
    quantity: line.quantity,
  }));

  const itemIds = [...soldQuantities(lines).keys()];
  const { data: stockRows } = itemIds.length
    ? await supabase
        .from("catalog_items")
        .select("id, name, stock_quantity, low_stock_threshold")
        .in("id", itemIds)
    : { data: [] };

  const { error } = await supabase
    .from("orders")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_reason: reason,
    })
    .eq("id", orderId);

  if (error) return { error: error.message };

  // The goods came back, so the stock does too.
  await applyStockMovement(
    lines,
    (stockRows ?? []).map((row) => ({
      catalog_item_id: row.id,
      name: row.name,
      stock_quantity: row.stock_quantity,
      low_stock_threshold: row.low_stock_threshold,
    })),
    "void",
  );

  // The money is no longer owed either; the payment is rejected rather
  // than deleted, so the trail still shows it happened.
  await supabase
    .from("payments")
    .update({
      status: "rejected",
      rejected_reason: `Sale voided — ${reason}`,
      verified_by: null,
      verified_at: null,
    })
    .eq("order_id", orderId)
    .neq("status", "rejected");

  await logAudit({
    action: "order.void",
    entityType: "order",
    entityId: orderId,
    summary: `${order.order_number} voided — ${reason}`,
    details: { reason, restored_lines: lines.length },
  });

  revalidateOrders(orderId);
  revalidatePath("/catalog");

  return { success: `${order.order_number} voided and the stock put back.` };
}

function revalidateOrders(id?: string): void {
  revalidatePath("/orders");
  if (id) revalidatePath(`/orders/${id}`);
  revalidatePath("/catalog");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}
