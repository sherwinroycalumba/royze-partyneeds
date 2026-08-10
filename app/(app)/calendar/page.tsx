import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import {
  isCalendarScale,
  rangeFor,
  type CalendarBooking,
  type CalendarScale,
} from "@/lib/bookings/calendar";
import { manilaCalendarDate, todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ scale?: string; date?: string }>;
}) {
  await requirePermission("calendar.view");
  const { scale: rawScale, date: rawDate } = await searchParams;

  const scale: CalendarScale = isCalendarScale(rawScale ?? "")
    ? (rawScale as CalendarScale)
    : "month";
  const date =
    rawDate && isCalendarDate(rawDate) ? rawDate : todayInManila();

  const range = rangeFor(scale, date);

  const supabase = await createClient();
  // A booking shows on the calendar for its whole window, so anything
  // overlapping the visible range has to come back.
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, event_date, delivery_at, pickup_at, setup_at, teardown_at, reserved_from, reserved_to, event_address, customers(name)",
    )
    .neq("status", "cancelled")
    .lte("reserved_from", range.to)
    .gte("reserved_to", range.from)
    .order("event_date", { ascending: true });

  const bookings: (CalendarBooking & { event_address: string })[] = (
    data ?? []
  ).map((booking) => ({
    id: booking.id,
    booking_number: booking.booking_number,
    customer_name: booking.customers?.name ?? "—",
    status: booking.status,
    event_date: booking.event_date,
    // Folded to Manila days here, so the grid never has to think
    // about timezones.
    delivery_day: booking.delivery_at
      ? manilaCalendarDate(booking.delivery_at)
      : null,
    pickup_day: booking.pickup_at
      ? manilaCalendarDate(booking.pickup_at)
      : null,
    setup_day: booking.setup_at ? manilaCalendarDate(booking.setup_at) : null,
    teardown_day: booking.teardown_at
      ? manilaCalendarDate(booking.teardown_at)
      : null,
    reserved_from: booking.reserved_from,
    reserved_to: booking.reserved_to,
    event_address: booking.event_address,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Calendar
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Everything the team is committed to. Backdrop setups are marked
            separately — they need a styling crew, not just a drop-off.
          </p>
        </div>

        <Link
          href={`/calendar?scale=${scale}&date=${todayInManila()}`}
          className={buttonClasses("secondary")}
        >
          Today
        </Link>
      </header>

      {error && (
        <Banner tone="error">Could not load the calendar: {error.message}</Banner>
      )}

      <CalendarView
        scale={scale}
        date={date}
        today={todayInManila()}
        bookings={bookings}
      />
    </div>
  );
}
