import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  isBookingStatus,
  isClosed,
} from "@/lib/bookings/status";
import { documentTotals } from "@/lib/documents/totals";
import { todayInManila } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { BookingsList, type BookingRow } from "./bookings-list";

export const metadata: Metadata = { title: "Bookings" };

const ROW_CAP = 500;

export default async function BookingsPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await requirePermission("bookings.view");
  const { status = "open" } = await searchParams;

  const canManage = can(profile, "bookings.manage");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "*, customers(name, phone), booking_items(quantity, unit_price_centavos, line_discount_centavos, is_component)",
    )
    .order("event_date", { ascending: false })
    .limit(ROW_CAP);

  const rows: BookingRow[] = (data ?? []).map((booking) => {
    const totals = documentTotals({
      // Components are priced at ₱0 under their package line, so they
      // must not be counted twice.
      lines: (booking.booking_items ?? []).filter((line) => !line.is_component),
      within_free_delivery_area: booking.within_free_delivery_area,
      delivery_fee_centavos: booking.delivery_fee_centavos,
      discount_centavos: booking.discount_centavos,
      downpayment_percent: booking.downpayment_percent,
    });

    return {
      id: booking.id,
      booking_number: booking.booking_number,
      customer_name: booking.customers?.name ?? "—",
      customer_phone: booking.customers?.phone ?? null,
      status: booking.status,
      event_date: booking.event_date,
      delivery_at: booking.delivery_at,
      setup_at: booking.setup_at,
      occasion: booking.occasion,
      event_address: booking.event_address,
      total_centavos: totals.total_centavos,
      item_count: (booking.booking_items ?? []).filter(
        (line) => !line.is_component,
      ).length,
    };
  });

  // "Open" is the working set — everything still needing attention.
  const filtered =
    status === "all"
      ? rows
      : isBookingStatus(status)
        ? rows.filter((row) => row.status === status)
        : rows.filter((row) => !isClosed(row.status));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Bookings
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Every event the business has committed to, from first enquiry to
            the items coming back.
          </p>
        </div>

        {canManage && (
          <Link href="/bookings/new" className={buttonClasses("primary")}>
            + New booking
          </Link>
        )}
      </header>

      <form action="/bookings" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="booking-status" className="sr-only">
            Status
          </label>
          <select
            id="booking-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="open">Open bookings</option>
            <option value="all">All bookings</option>
            {BOOKING_STATUSES.map((value) => (
              <option key={value} value={value}>
                {BOOKING_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load bookings: {error.message}</Banner>
      )}

      <BookingsList
        bookings={filtered}
        today={todayInManila()}
        heading={
          status === "all"
            ? "All bookings"
            : isBookingStatus(status)
              ? `${BOOKING_STATUS_LABELS[status]} bookings`
              : "Open bookings"
        }
        truncated={rows.length === ROW_CAP}
      />
    </div>
  );
}
