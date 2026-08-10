"use client";

import Link from "next/link";

import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
} from "@/lib/bookings/status";
import { formatCalendarDate, formatTime } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type BookingRow = {
  id: string;
  booking_number: string;
  customer_name: string;
  customer_phone: string | null;
  status: BookingStatus;
  event_date: string;
  delivery_at: string | null;
  setup_at: string | null;
  occasion: string;
  event_address: string;
  total_centavos: number;
  item_count: number;
};

export function BookingsList({
  bookings,
  today,
  heading,
  truncated,
}: {
  bookings: BookingRow[];
  today: string;
  heading: string;
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(bookings, query, (booking) => [
    booking.booking_number,
    booking.customer_name,
    booking.customer_phone,
    booking.occasion,
    booking.event_address,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="booking-search"
        label="Search bookings"
        placeholder="Search booking number, customer, occasion, or address"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={bookings.length}
        noun="bookings"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the most recent {bookings.length} bookings by event date.
        </p>
      )}

      <Card>
        <CardHeader title={heading} description={`${bookings.length} loaded.`} />

        {visible.length > 0 ? (
          <ul>
            {visible.map((booking) => (
              <li
                key={booking.id}
                className="border-b border-ink-200 last:border-b-0"
              >
                <Link
                  href={`/bookings/${booking.id}`}
                  className="block px-4 py-4 transition-colors hover:bg-ink-50 sm:px-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink-900">
                        {booking.customer_name}
                      </p>
                      <Badge tone={BOOKING_STATUS_TONES[booking.status]}>
                        {BOOKING_STATUS_LABELS[booking.status]}
                      </Badge>
                      {booking.setup_at && (
                        <Badge tone="brand">Backdrop setup</Badge>
                      )}
                    </div>
                    <p className="tabular font-bold text-ink-900">
                      {formatPeso(booking.total_centavos)}
                    </p>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
                    <span className="tabular font-medium">
                      {booking.booking_number}
                    </span>
                    <span className={dateTone(booking.event_date, today)}>
                      {eventLabel(booking.event_date, today)}
                    </span>
                    <span>
                      {booking.item_count}{" "}
                      {booking.item_count === 1 ? "item" : "items"}
                    </span>
                    {booking.occasion && <span>{booking.occasion}</span>}
                  </div>

                  {booking.delivery_at && (
                    <p className="mt-0.5 text-xs text-ink-500">
                      Delivery {formatCalendarDate(booking.event_date)} ·{" "}
                      {formatTime(booking.delivery_at)}
                    </p>
                  )}
                  {booking.event_address && (
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {booking.event_address}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {bookings.length === 0
              ? "No bookings here yet."
              : `No booking matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}

function eventLabel(eventDate: string, today: string): string {
  if (eventDate === today) return "Today";
  const formatted = formatCalendarDate(eventDate);
  return eventDate < today ? formatted : `${formatted}`;
}

/** Today's events are what staff are looking for when they open this. */
function dateTone(eventDate: string, today: string): string {
  if (eventDate === today) return "font-semibold text-brand-700";
  if (eventDate < today) return "text-ink-500";
  return "text-ink-600";
}
