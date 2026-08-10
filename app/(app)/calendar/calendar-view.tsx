"use client";

import Link from "next/link";

import {
  bookingsOn,
  MARKER_LABELS,
  monthGrid,
  monthOf,
  shiftMonth,
  weekGrid,
  type CalendarBooking,
  type CalendarMarker,
  type CalendarScale,
} from "@/lib/bookings/calendar";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { addCalendarDays, formatCalendarDate } from "@/lib/date";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";

/**
 * Month, week, and day views of the shared calendar (Spec 4.10).
 *
 * Colour follows booking status; a backdrop setup gets its own mark
 * because it is a different job for a different crew. Everything links
 * through to the booking, which is what delivery staff actually open.
 */

type Entry = CalendarBooking & { event_address: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Mirrors BOOKING_STATUS_TONES, as background chips for the grid. */
const STATUS_CHIP: Record<string, string> = {
  inquiry: "bg-ink-100 text-ink-700",
  quoted: "bg-ink-100 text-ink-700",
  reserved: "bg-warning-100 text-warning-700",
  confirmed: "bg-brand-100 text-brand-700",
  out_for_delivery: "bg-brand-100 text-brand-700",
  delivered: "bg-success-100 text-success-700",
  picked_up: "bg-success-100 text-success-700",
  completed: "bg-success-100 text-success-700",
  cancelled: "bg-danger-100 text-danger-700",
};

export function CalendarView({
  scale,
  date,
  today,
  bookings,
}: {
  scale: CalendarScale;
  date: string;
  today: string;
  bookings: Entry[];
}) {
  return (
    <div className="space-y-4">
      <Controls scale={scale} date={date} />

      {scale === "month" && (
        <MonthView date={date} today={today} bookings={bookings} />
      )}
      {scale === "week" && (
        <WeekView date={date} today={today} bookings={bookings} />
      )}
      {scale === "day" && <DayView date={date} bookings={bookings} />}

      <Legend />
    </div>
  );
}

function Controls({ scale, date }: { scale: CalendarScale; date: string }) {
  const step = (direction: -1 | 1) => {
    if (scale === "month") return shiftMonth(date, direction);
    if (scale === "week") return addCalendarDays(date, 7 * direction);
    return addCalendarDays(date, direction);
  };

  const title =
    scale === "day"
      ? formatCalendarDate(date)
      : scale === "week"
        ? `Week of ${formatCalendarDate(weekGrid(date)[0])}`
        : monthTitle(date);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link
          href={`/calendar?scale=${scale}&date=${step(-1)}`}
          className={buttonClasses("secondary", "sm")}
          aria-label="Previous"
        >
          ←
        </Link>
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        <Link
          href={`/calendar?scale=${scale}&date=${step(1)}`}
          className={buttonClasses("secondary", "sm")}
          aria-label="Next"
        >
          →
        </Link>
      </div>

      <div className="flex gap-1 rounded-lg border border-ink-300 p-1">
        {(["month", "week", "day"] as const).map((option) => (
          <Link
            key={option}
            href={`/calendar?scale=${option}&date=${date}`}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition-colors ${
              option === scale
                ? "bg-brand-600 text-white"
                : "text-ink-700 hover:bg-ink-100"
            }`}
          >
            {option}
          </Link>
        ))}
      </div>
    </div>
  );
}

function monthTitle(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function MonthView({
  date,
  today,
  bookings,
}: {
  date: string;
  today: string;
  bookings: Entry[];
}) {
  const cells = monthGrid(date);
  const month = monthOf(date);

  return (
    <Card>
      {/* Narrow phones scroll the grid rather than crushing it. */}
      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 border-b border-ink-200">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="px-2 py-2 text-center text-xs font-semibold text-ink-500"
              >
                {weekday}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day) => {
              const entries = bookingsOn(bookings, day);
              const outside = monthOf(day) !== month;

              return (
                <div
                  key={day}
                  className={`min-h-24 border-b border-r border-ink-200 p-1.5 ${
                    outside ? "bg-ink-50/60" : ""
                  }`}
                >
                  <Link
                    href={`/calendar?scale=day&date=${day}`}
                    className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                      day === today
                        ? "bg-brand-600 text-white"
                        : outside
                          ? "text-ink-400"
                          : "text-ink-700 hover:bg-ink-100"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </Link>

                  <div className="space-y-1">
                    {entries.slice(0, 3).map(({ booking, markers }) => (
                      <Link
                        key={booking.id}
                        href={`/bookings/${booking.id}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          STATUS_CHIP[booking.status] ?? "bg-ink-100"
                        }`}
                        title={`${booking.customer_name} — ${markers.map((marker) => MARKER_LABELS[marker]).join(", ")}`}
                      >
                        {markers.includes("setup") && "✦ "}
                        {booking.customer_name}
                      </Link>
                    ))}
                    {entries.length > 3 && (
                      <Link
                        href={`/calendar?scale=day&date=${day}`}
                        className="block px-1.5 text-[11px] font-medium text-ink-500"
                      >
                        +{entries.length - 3} more
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function WeekView({
  date,
  today,
  bookings,
}: {
  date: string;
  today: string;
  bookings: Entry[];
}) {
  return (
    <div className="space-y-3">
      {weekGrid(date).map((day) => (
        <DayCard key={day} day={day} bookings={bookings} highlight={day === today} />
      ))}
    </div>
  );
}

function DayView({ date, bookings }: { date: string; bookings: Entry[] }) {
  return <DayCard day={date} bookings={bookings} highlight expanded />;
}

function DayCard({
  day,
  bookings,
  highlight,
  expanded,
}: {
  day: string;
  bookings: Entry[];
  highlight?: boolean;
  expanded?: boolean;
}) {
  const entries = bookingsOn(bookings, day);

  return (
    <Card className={highlight ? "border-brand-200" : ""}>
      <CardHeader
        title={formatCalendarDate(day)}
        description={
          entries.length === 0
            ? "Nothing scheduled."
            : `${entries.length} ${entries.length === 1 ? "booking" : "bookings"}`
        }
      />
      {entries.length > 0 && (
        <ul className="divide-y divide-ink-200">
          {entries.map(({ booking, markers }) => (
            <li key={booking.id}>
              <Link
                href={`/bookings/${booking.id}`}
                className="block px-4 py-3 transition-colors hover:bg-ink-50 sm:px-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink-900">
                    {booking.customer_name}
                  </span>
                  {markers.map((marker) => (
                    <MarkerChip key={marker} marker={marker} />
                  ))}
                </div>
                <p className="mt-0.5 text-sm text-ink-600">
                  <span className="tabular">{booking.booking_number}</span> ·{" "}
                  {BOOKING_STATUS_LABELS[booking.status as BookingStatus]}
                </p>
                {expanded && booking.event_address && (
                  <p className="mt-0.5 text-xs text-ink-500">
                    {booking.event_address}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && expanded && (
        <CardBody>
          <p className="text-sm text-ink-500">
            No deliveries, setups, or pickups scheduled.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function MarkerChip({ marker }: { marker: CalendarMarker }) {
  const tones: Record<CalendarMarker, string> = {
    setup: "bg-brand-100 text-brand-700",
    teardown: "bg-brand-50 text-brand-700",
    delivery: "bg-info-50 text-info-700",
    pickup: "bg-info-50 text-info-700",
    event: "bg-success-100 text-success-700",
    ongoing: "bg-ink-100 text-ink-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[marker]}`}
    >
      {marker === "setup" && "✦ "}
      {MARKER_LABELS[marker]}
    </span>
  );
}

function Legend() {
  return (
    <p className="text-xs text-ink-500">
      ✦ marks a backdrop setup — a styling crew on site, not just a drop-off.
      Colour follows the booking status.
    </p>
  );
}
