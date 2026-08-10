import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import { orderTotals } from "@/lib/orders/totals";
import { sumCentavos } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { OrdersList, type OrderRow } from "./orders-list";

export const metadata: Metadata = { title: "Quick sales" };

const ROW_CAP = 500;

export default async function OrdersPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const profile = await requirePermission("quotations.view");
  const { from, to, status = "completed" } = await searchParams;

  const canSell = can(profile, "orders.manage");
  const today = todayInManila();

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*, order_items(quantity, unit_price_centavos, line_discount_centavos)")
    .order("sold_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);

  if (status === "completed" || status === "voided") {
    query = query.eq("status", status);
  }
  if (from && isCalendarDate(from)) query = query.gte("sold_on", from);
  if (to && isCalendarDate(to)) query = query.lte("sold_on", to);

  const { data, error } = await query;

  const rows: OrderRow[] = (data ?? []).map((order) => {
    const totals = orderTotals({
      lines: order.order_items ?? [],
      discount_centavos: order.discount_centavos,
    });

    return {
      id: order.id,
      order_number: order.order_number,
      customer_label: order.customer_label,
      status: order.status,
      sold_on: order.sold_on,
      total_centavos: totals.total_centavos,
      item_count: (order.order_items ?? []).length,
      voided_reason: order.voided_reason,
    };
  });

  // Voided sales are not takings, so they are excluded from the total.
  const takings = sumCentavos(
    rows
      .filter((row) => row.status === "completed")
      .map((row) => row.total_centavos),
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Quick sales
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Walk-in and Messenger sales of supplies, and what they took off the
            shelf.
          </p>
        </div>

        {canSell && (
          <Link href="/orders/new" className={buttonClasses("primary")}>
            + New sale
          </Link>
        )}
      </header>

      <form
        action="/orders"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <div>
          <label htmlFor="order-status" className="sr-only">
            Status
          </label>
          <select
            id="order-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="completed">Completed sales</option>
            <option value="voided">Voided</option>
            <option value="all">All</option>
          </select>
        </div>

        <div>
          <label htmlFor="order-from" className="sr-only">
            Sold from
          </label>
          <input
            id="order-from"
            name="from"
            type="date"
            defaultValue={from ?? ""}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="order-to" className="sr-only">
            Sold to
          </label>
          <input
            id="order-to"
            name="to"
            type="date"
            defaultValue={to ?? today}
            className={inputClasses}
          />
        </div>

        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load sales: {error.message}</Banner>
      )}

      <OrdersList
        orders={rows}
        takings={takings}
        truncated={rows.length === ROW_CAP}
      />
    </div>
  );
}
