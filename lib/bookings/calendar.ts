import { addCalendarDays } from "@/lib/date";

/**
 * Grid maths for the shared calendar (Spec 4.10).
 *
 * Pure `YYYY-MM-DD` string arithmetic: the calendar is a wall planner
 * for a business in one timezone, so a "day" here is a Manila day and
 * nothing else. Keeping it out of Date objects also keeps the grid
 * from drifting when the server runs in UTC.
 */

export type CalendarScale = "month" | "week" | "day";

export function isCalendarScale(value: string): value is CalendarScale {
  return value === "month" || value === "week" || value === "day";
}

/** `2026-08-29` → `2026-08` */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The first day of the month a date falls in. */
export function startOfMonth(date: string): string {
  return `${monthOf(date)}-01`;
}

export function daysInMonth(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function endOfMonth(date: string): string {
  return `${monthOf(date)}-${String(daysInMonth(date)).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday, for a `YYYY-MM-DD`. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The Sunday on or before this date — where a calendar week starts. */
export function startOfWeek(date: string): string {
  return addCalendarDays(date, -weekdayOf(date));
}

export function shiftMonth(date: string, months: number): string {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Every cell of a month grid: whole weeks, Sunday to Saturday, padded
 * out of the neighbouring months so the grid is always rectangular.
 */
export function monthGrid(date: string): string[] {
  const first = startOfWeek(startOfMonth(date));
  const last = endOfMonth(date);

  const cells: string[] = [];
  let cursor = first;

  // Run to the end of the week the month ends in.
  while (cursor <= last || weekdayOf(cursor) !== 0) {
    cells.push(cursor);
    cursor = addCalendarDays(cursor, 1);
    // A month spans at most six weeks.
    if (cells.length >= 42) break;
  }

  return cells;
}

/** The seven days of the week a date falls in. */
export function weekGrid(date: string): string[] {
  const first = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(first, index),
  );
}

/** The window a scale covers, for the query that loads it. */
export function rangeFor(
  scale: CalendarScale,
  date: string,
): { from: string; to: string } {
  if (scale === "day") return { from: date, to: date };
  if (scale === "week") {
    const week = weekGrid(date);
    return { from: week[0], to: week[6] };
  }
  const cells = monthGrid(date);
  return { from: cells[0], to: cells[cells.length - 1] };
}

/** What a booking contributes to a given day on the calendar. */
export type CalendarMarker =
  | "delivery"
  | "setup"
  | "pickup"
  | "teardown"
  | "event"
  | "ongoing";

export type CalendarBooking = {
  id: string;
  booking_number: string;
  customer_name: string;
  status: string;
  event_date: string;
  /** Manila calendar days, already folded from the instants. */
  delivery_day: string | null;
  pickup_day: string | null;
  setup_day: string | null;
  teardown_day: string | null;
  reserved_from: string;
  reserved_to: string;
};

/**
 * Which markers a booking puts on one day.
 *
 * A booking usually shows on several days — out on the 28th, event on
 * the 29th, back on the 30th — and the day view lists each of those
 * separately (Spec 4.10).
 */
export function markersOn(
  booking: CalendarBooking,
  day: string,
): CalendarMarker[] {
  const markers: CalendarMarker[] = [];

  if (booking.setup_day === day) markers.push("setup");
  if (booking.delivery_day === day) markers.push("delivery");
  if (booking.event_date === day) markers.push("event");
  if (booking.teardown_day === day) markers.push("teardown");
  if (booking.pickup_day === day) markers.push("pickup");

  // Still out, but nothing scheduled today.
  if (
    markers.length === 0 &&
    day >= booking.reserved_from &&
    day <= booking.reserved_to
  ) {
    markers.push("ongoing");
  }

  return markers;
}

export const MARKER_LABELS: Record<CalendarMarker, string> = {
  delivery: "Delivery",
  setup: "Backdrop setup",
  pickup: "Pickup",
  teardown: "Teardown",
  event: "Event",
  ongoing: "Ongoing",
};

/**
 * Bookings that touch a day at all, in the order staff work through
 * them. Generic over the row shape so a caller carrying extra fields
 * — the address, say — gets them back rather than the bare type.
 */
export function bookingsOn<T extends CalendarBooking>(
  bookings: readonly T[],
  day: string,
): { booking: T; markers: CalendarMarker[] }[] {
  return bookings
    .map((booking) => ({ booking, markers: markersOn(booking, day) }))
    .filter((entry) => entry.markers.length > 0)
    .sort((a, b) => {
      // Setups first: they need a styling crew on site early.
      const rank = (markers: CalendarMarker[]) =>
        markers.includes("setup")
          ? 0
          : markers.includes("delivery")
            ? 1
            : markers.includes("event")
              ? 2
              : 3;
      return rank(a.markers) - rank(b.markers);
    });
}
