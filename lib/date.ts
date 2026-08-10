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

const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Which Manila calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * A 9pm delivery on the 28th is stored as the 29th in UTC; reservation
 * windows and calendar rows have to agree with the day staff would say
 * out loud, so every instant is folded through Manila first.
 */
export function manilaCalendarDate(value: string | Date): string {
  return calendarFormatter.format(toDate(value));
}

/** Today's date in Manila as `YYYY-MM-DD`, for date input defaults. */
export function todayInManila(): string {
  return calendarFormatter.format(new Date());
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
 * Manila is UTC+8 all year — the Philippines has kept no daylight
 * saving since 1978 — so the offset can be a constant rather than a
 * timezone-database lookup.
 */
const MANILA_OFFSET = "+08:00";

/**
 * Reads a `<input type="datetime-local">` value as Manila wall-clock
 * time and returns the ISO instant to store.
 *
 * Without this the browser's own timezone decides what "2:00 PM"
 * means, so a booking entered on a phone set to another country would
 * be delivered at the wrong hour.
 */
export function manilaLocalToInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;

  const instant = new Date(`${value}:00${MANILA_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The inverse: an instant as the `YYYY-MM-DDTHH:mm` a datetime-local
 * input wants, in Manila time.
 */
export function instantToManilaLocal(value: string | Date): string {
  const parts = localFormatter.formatToParts(toDate(value));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  // en-CA renders midnight as 24; the input needs 00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
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
