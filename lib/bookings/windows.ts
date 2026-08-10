import { manilaCalendarDate } from "@/lib/date";

/**
 * The window a booking holds stock for (Spec 4.4).
 *
 * "the overlapping date range (delivery/setup date → return/teardown
 * date)". Everything is folded to a Manila calendar day first: a 9pm
 * delivery on the 28th is the 29th in UTC, and a chair that leaves the
 * yard on the 28th must not read as free that day.
 *
 * Pure, so the same window backs the saved row, the availability
 * check, and the calendar.
 */

export type BookingSchedule = {
  /** `YYYY-MM-DD`. The one date every booking has. */
  event_date: string;
  /** ISO instants, or null when not scheduled yet. */
  delivery_at: string | null;
  pickup_at: string | null;
  setup_at: string | null;
  teardown_at: string | null;
};

export type ReservationWindow = {
  from: string;
  to: string;
};

/**
 * Earliest of setup/delivery/event through latest of teardown/pickup/
 * event. The event date always participates, so a booking with no
 * logistics entered yet still holds its stock for the day itself
 * rather than for nothing at all.
 */
export function reservationWindow(
  schedule: BookingSchedule,
): ReservationWindow {
  const days = [
    schedule.event_date,
    ...[
      schedule.delivery_at,
      schedule.pickup_at,
      schedule.setup_at,
      schedule.teardown_at,
    ]
      .filter((value): value is string => Boolean(value))
      .map(manilaCalendarDate),
  ];

  // `YYYY-MM-DD` sorts lexicographically, so min/max need no parsing.
  return {
    from: days.reduce((earliest, day) => (day < earliest ? day : earliest)),
    to: days.reduce((latest, day) => (day > latest ? day : latest)),
  };
}

/** Do two closed day-ranges share at least one day? */
export function windowsOverlap(
  a: ReservationWindow,
  b: ReservationWindow,
): boolean {
  return a.from <= b.to && a.to >= b.from;
}

/**
 * The problem with a booking's schedule, or null when it hangs
 * together. Ordering is checked in Manila days rather than instants,
 * because that is how staff read it back.
 */
export function validateSchedule(schedule: BookingSchedule): string | null {
  const day = (value: string | null) =>
    value ? manilaCalendarDate(value) : null;

  const delivery = day(schedule.delivery_at);
  const pickup = day(schedule.pickup_at);
  const setup = day(schedule.setup_at);
  const teardown = day(schedule.teardown_at);

  if (delivery && pickup && pickup < delivery) {
    return "Pickup cannot be before delivery.";
  }

  if (setup && teardown && teardown < setup) {
    return "Teardown cannot be before setup.";
  }

  if (delivery && delivery > schedule.event_date) {
    return "Delivery is after the event date — the items would arrive late.";
  }

  if (setup && setup > schedule.event_date) {
    return "Setup is after the event date.";
  }

  if (pickup && pickup < schedule.event_date) {
    return "Pickup is before the event date — the items would be gone.";
  }

  return null;
}
