/**
 * Dates and times (Spec 1).
 *
 * The business runs in Asia/Manila. Timestamps are stored as UTC
 * timestamptz and always rendered in Manila time, so a booking created
 * from a phone abroad still shows the local event date staff expect.
 */

export const BUSINESS_TIMEZONE = "Asia/Manila";

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: BUSINESS_TIMEZONE,
  month: "short",
  day: "2-digit",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: BUSINESS_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: BUSINESS_TIMEZONE,
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Aug 09, 2026" — the display format required by Spec 1. */
export function formatDate(value: string | Date): string {
  return dateFormatter.format(toDate(value));
}

/** "3:30 PM" */
export function formatTime(value: string | Date): string {
  return timeFormatter.format(toDate(value));
}

/** "Aug 09, 2026, 3:30 PM" */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(toDate(value));
}

/** Today's date in Manila as `YYYY-MM-DD`, for date input defaults. */
export function todayInManila(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

/**
 * Formats a stored `YYYY-MM-DD` calendar date — "Aug 09, 2026".
 *
 * Deliberately not `formatDate(value)`: a bare date string parses as
 * UTC midnight, which is 8am Manila the *same* day but would print the
 * day before for any timezone west of UTC. Anchoring at midday makes
 * the calendar day survive the conversion.
 */
export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return formatDate(new Date(Date.UTC(year, month - 1, day, 12)));
}

/**
 * Adds whole days to a `YYYY-MM-DD` calendar date, returning one.
 *
 * Calendar arithmetic, deliberately not instant arithmetic: quotation
 * validity and event dates are days in Manila, and going through a
 * timestamp would let a timezone offset move the answer by one.
 */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days between two instants, for receivables aging (Spec 4.11). */
export function daysBetween(from: string | Date, to: string | Date): number {
  const start = toDate(from).getTime();
  const end = toDate(to).getTime();
  return Math.floor((end - start) / 86_400_000);
}
