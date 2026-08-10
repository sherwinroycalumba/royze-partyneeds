import { describe, expect, it } from "vitest";

import {
  availabilityVerdict,
  availableQuantity,
  describeShortages,
  findShortages,
  totalRequested,
  type StockLevel,
  type StockRequest,
} from "@/lib/bookings/availability";
import {
  allowedTransitions,
  BOOKING_STATUSES,
  canConfirm,
  canEditItems,
  canRecordReturn,
  canTransition,
  confirmationBlockers,
  confirmationVerdict,
  holdsStock,
  isBookingStatus,
  isClosed,
  type ConfirmationFacts,
} from "@/lib/bookings/status";
import {
  allLinesChecked,
  damageChargeFor,
  inventoryEffectFor,
  validateReturn,
  type ReturnRecord,
} from "@/lib/bookings/returns";
import {
  validateBooking,
  pricedLines,
  type BookingDraft,
  type BookingLineDraft,
} from "@/lib/bookings/validation";
import {
  reservationWindow,
  validateSchedule,
  windowsOverlap,
  type BookingSchedule,
} from "@/lib/bookings/windows";
import {
  instantToManilaLocal,
  manilaCalendarDate,
  manilaLocalToInstant,
} from "@/lib/date";
import {
  bookingsOn,
  endOfMonth,
  markersOn,
  monthGrid,
  rangeFor,
  shiftMonth,
  startOfWeek,
  weekGrid,
  type CalendarBooking,
} from "@/lib/bookings/calendar";

// ── Helpers ───────────────────────────────────────────────────
/**
 * An instant at `hour` o'clock Manila on `date`, as an ISO string.
 * Manila is UTC+8, and Date.UTC rolls a negative hour back a day for
 * us — 7am Manila is 11pm UTC the night before.
 */
const manila = (date: string, hour: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8)).toISOString();
};

function schedule(overrides: Partial<BookingSchedule> = {}): BookingSchedule {
  return {
    event_date: "2026-08-29",
    delivery_at: null,
    pickup_at: null,
    setup_at: null,
    teardown_at: null,
    ...overrides,
  };
}

function level(overrides: Partial<StockLevel> = {}): StockLevel {
  return {
    catalog_item_id: "chair",
    name: "Monoblock chair",
    quantity_owned: 100,
    damaged_quantity: 0,
    reserved_quantity: 0,
    ...overrides,
  };
}

function request(overrides: Partial<StockRequest> = {}): StockRequest {
  return {
    catalog_item_id: "chair",
    name: "Monoblock chair",
    quantity: 10,
    ...overrides,
  };
}

function bookingLine(
  overrides: Partial<BookingLineDraft> = {},
): BookingLineDraft {
  return {
    line_type: "rental",
    description: "Monoblock chair",
    quantity: 10,
    unit_price_centavos: 2_500,
    line_discount_centavos: 0,
    is_component: false,
    ...overrides,
  };
}

function bookingDraft(overrides: Partial<BookingDraft> = {}): BookingDraft {
  return {
    customer_id: "11111111-1111-1111-1111-111111111111",
    ...schedule(),
    lines: [bookingLine()],
    within_free_delivery_area: false,
    delivery_fee_centavos: 0,
    discount_centavos: 0,
    downpayment_percent: 50,
    ...overrides,
  };
}

function returnRecord(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    booking_item_id: "line-1",
    description: "Monoblock chair",
    quantity: 10,
    replacement_value_centavos: 45_000, // ₱450.00
    condition: "ok",
    damaged_quantity: 0,
    lost_quantity: 0,
    notes: "",
    ...overrides,
  };
}

function facts(overrides: Partial<ConfirmationFacts> = {}): ConfirmationFacts {
  return {
    agreement_signed: true,
    verified_paid_centavos: 500_000,
    total_centavos: 1_000_000,
    downpayment_percent: 50,
    ...overrides,
  };
}

// ── Reservation window ────────────────────────────────────────
describe("reservationWindow", () => {
  it("falls back to the event day when nothing else is scheduled", () => {
    expect(reservationWindow(schedule())).toEqual({
      from: "2026-08-29",
      to: "2026-08-29",
    });
  });

  it("spans the earliest departure to the latest return", () => {
    expect(
      reservationWindow(
        schedule({
          delivery_at: manila("2026-08-28", 14),
          pickup_at: manila("2026-08-30", 9),
        }),
      ),
    ).toEqual({ from: "2026-08-28", to: "2026-08-30" });
  });

  it("counts a backdrop setup that starts before the delivery", () => {
    expect(
      reservationWindow(
        schedule({
          setup_at: manila("2026-08-27", 7),
          delivery_at: manila("2026-08-28", 14),
          teardown_at: manila("2026-08-30", 18),
        }),
      ),
    ).toEqual({ from: "2026-08-27", to: "2026-08-30" });
  });

  it("uses the Manila day, not the UTC one", () => {
    // 9pm Manila on the 28th is 13:00Z the same day, but 1am Manila on
    // the 29th is 17:00Z on the 28th — the window has to follow the day
    // staff would say out loud.
    const lateNight = new Date("2026-08-28T17:00:00Z").toISOString();
    expect(
      reservationWindow(schedule({ pickup_at: lateNight })).to,
    ).toBe("2026-08-29");
  });
});

describe("windowsOverlap", () => {
  it("overlaps when the ranges touch at a single day", () => {
    expect(
      windowsOverlap(
        { from: "2026-08-27", to: "2026-08-29" },
        { from: "2026-08-29", to: "2026-08-31" },
      ),
    ).toBe(true);
  });

  it("does not overlap when one ends the day before the other starts", () => {
    expect(
      windowsOverlap(
        { from: "2026-08-27", to: "2026-08-28" },
        { from: "2026-08-29", to: "2026-08-31" },
      ),
    ).toBe(false);
  });
});

describe("validateSchedule", () => {
  it("accepts an ordinary schedule", () => {
    expect(
      validateSchedule(
        schedule({
          delivery_at: manila("2026-08-28", 14),
          pickup_at: manila("2026-08-30", 9),
        }),
      ),
    ).toBeNull();
  });

  it("refuses a pickup before the delivery", () => {
    expect(
      validateSchedule(
        schedule({
          delivery_at: manila("2026-08-30", 9),
          pickup_at: manila("2026-08-28", 9),
        }),
      ),
    ).toMatch(/before delivery/);
  });

  it("refuses a delivery after the event", () => {
    expect(
      validateSchedule(schedule({ delivery_at: manila("2026-08-30", 9) })),
    ).toMatch(/arrive late/);
  });

  it("refuses a pickup before the event", () => {
    expect(
      validateSchedule(schedule({ pickup_at: manila("2026-08-28", 9) })),
    ).toMatch(/items would be gone/);
  });

  it("refuses a teardown before the setup", () => {
    expect(
      validateSchedule(
        schedule({
          setup_at: manila("2026-08-29", 7),
          teardown_at: manila("2026-08-28", 7),
        }),
      ),
    ).toMatch(/Teardown cannot be before setup/);
  });
});

// ── Availability ──────────────────────────────────────────────
describe("availableQuantity", () => {
  it("is what is owned, less broken, less what others hold", () => {
    expect(
      availableQuantity(
        level({ quantity_owned: 100, damaged_quantity: 5, reserved_quantity: 60 }),
      ),
    ).toBe(35);
  });

  it("never goes negative, so an oversold past cannot lend to the future", () => {
    expect(
      availableQuantity(
        level({ quantity_owned: 10, damaged_quantity: 0, reserved_quantity: 25 }),
      ),
    ).toBe(0);
  });
});

describe("totalRequested", () => {
  it("adds up the same item asked for on several lines", () => {
    // Ten chairs on their own line and six more inside a backdrop
    // package is sixteen chairs, and sixteen is what has to fit.
    const totals = totalRequested([
      request({ quantity: 10 }),
      request({ quantity: 6 }),
    ]);
    expect(totals.get("chair")?.quantity).toBe(16);
  });

  it("ignores custom lines that point at no catalog item", () => {
    const totals = totalRequested([request({ catalog_item_id: "" })]);
    expect(totals.size).toBe(0);
  });
});

describe("findShortages", () => {
  it("is empty when everything fits", () => {
    expect(findShortages([request({ quantity: 40 })], [level()])).toEqual([]);
  });

  it("reports the gap when a booking asks for more than is free", () => {
    const shortages = findShortages(
      [request({ quantity: 50 })],
      [level({ quantity_owned: 100, reserved_quantity: 70 })],
    );

    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toMatchObject({
      name: "Monoblock chair",
      requested: 50,
      available: 30,
      short_by: 20,
    });
  });

  it("catches two backdrop bookings competing for the same arch", () => {
    // The arch is owned once and already held by another booking that
    // overlaps these dates, so this one cannot have it (Spec 4.4).
    const shortages = findShortages(
      [request({ catalog_item_id: "arch", name: "Arch frame", quantity: 1 })],
      [
        level({
          catalog_item_id: "arch",
          name: "Arch frame",
          quantity_owned: 1,
          reserved_quantity: 1,
        }),
      ],
    );

    expect(shortages[0]).toMatchObject({ available: 0, short_by: 1 });
  });

  it("counts damaged stock as unavailable", () => {
    const shortages = findShortages(
      [request({ quantity: 100 })],
      [level({ quantity_owned: 100, damaged_quantity: 12 })],
    );
    expect(shortages[0]?.short_by).toBe(12);
  });

  it("worst shortage first", () => {
    const shortages = findShortages(
      [
        request({ catalog_item_id: "chair", quantity: 20 }),
        request({ catalog_item_id: "table", name: "Table", quantity: 20 }),
      ],
      [
        level({ catalog_item_id: "chair", quantity_owned: 15 }),
        level({ catalog_item_id: "table", name: "Table", quantity_owned: 5 }),
      ],
    );

    expect(shortages.map((shortage) => shortage.catalog_item_id)).toEqual([
      "table",
      "chair",
    ]);
  });

  it("ignores an item with no stock level on file", () => {
    // A custom line points at no catalog record, so there is nothing
    // to check — it must not read as "zero available".
    expect(findShortages([request({ catalog_item_id: "mystery" })], [])).toEqual(
      [],
    );
  });
});

describe("availabilityVerdict", () => {
  const shortages = findShortages(
    [request({ quantity: 50 })],
    [level({ quantity_owned: 30 })],
  );

  it("allows a booking that fits", () => {
    expect(
      availabilityVerdict({ shortages: [], isOwner: false, overrideReason: "" }),
    ).toEqual({ allowed: true });
  });

  it("blocks staff and points them at the owner", () => {
    const verdict = availabilityVerdict({
      shortages,
      isOwner: false,
      overrideReason: "we can borrow some",
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.error).toMatch(/Ask the owner/);
  });

  it("blocks even the owner until a reason is given", () => {
    expect(
      availabilityVerdict({ shortages, isOwner: true, overrideReason: "  " })
        .allowed,
    ).toBe(false);
  });

  it("lets the owner through with a reason", () => {
    expect(
      availabilityVerdict({
        shortages,
        isOwner: true,
        overrideReason: "borrowing 20 chairs from Ate Let",
      }),
    ).toEqual({ allowed: true });
  });

  it("names the item and the numbers in the warning", () => {
    expect(describeShortages(shortages)).toBe(
      "Not enough stock for these dates: Monoblock chair — 50 needed, 30 free.",
    );
  });
});

// ── Status machine ────────────────────────────────────────────
describe("booking transitions", () => {
  it("walks the happy path end to end", () => {
    const path = [
      "inquiry",
      "quoted",
      "reserved",
      "confirmed",
      "out_for_delivery",
      "delivered",
      "picked_up",
      "completed",
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index], path[index + 1])).toBe(true);
    }
  });

  it("cannot skip Reserved on the way to Confirmed", () => {
    expect(canTransition("quoted", "confirmed")).toBe(false);
  });

  it("cannot cancel once the van has left", () => {
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("out_for_delivery", "cancelled")).toBe(false);
    expect(canTransition("delivered", "cancelled")).toBe(false);
  });

  it("is a dead end once completed or cancelled", () => {
    expect(allowedTransitions("completed")).toEqual([]);
    expect(allowedTransitions("cancelled")).toEqual([]);
    expect(isClosed("completed")).toBe(true);
    expect(isClosed("delivered")).toBe(false);
  });

  it("holds stock only between Reserved and Delivered", () => {
    // Mirrors booking_holds_stock() in migration 0006.
    expect(BOOKING_STATUSES.filter(holdsStock)).toEqual([
      "reserved",
      "confirmed",
      "out_for_delivery",
      "delivered",
    ]);
  });

  it("freezes the items once they have gone out", () => {
    expect(canEditItems("confirmed")).toBe(true);
    expect(canEditItems("out_for_delivery")).toBe(false);
  });

  it("takes returns only while the booking is out", () => {
    expect(canRecordReturn("delivered")).toBe(true);
    expect(canRecordReturn("picked_up")).toBe(true);
    expect(canRecordReturn("confirmed")).toBe(false);
  });

  it("recognises its own status strings", () => {
    expect(isBookingStatus("out_for_delivery")).toBe(true);
    expect(isBookingStatus("shipped")).toBe(false);
  });
});

// ── The 50% confirmation gate (Spec 4.4) ──────────────────────
describe("confirmationBlockers", () => {
  it("passes a signed agreement with the downpayment covered", () => {
    expect(confirmationBlockers(facts())).toEqual([]);
    expect(canConfirm(facts())).toBe(true);
  });

  it("blocks without a signed agreement", () => {
    expect(confirmationBlockers(facts({ agreement_signed: false }))).toEqual([
      "the rental agreement has not been signed",
    ]);
  });

  it("blocks when verified payments fall a centavo short", () => {
    const blockers = confirmationBlockers(
      facts({ verified_paid_centavos: 499_999 }),
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/₱4,999.99 of the ₱5,000.00 needed/);
  });

  it("accepts payment of exactly the downpayment", () => {
    expect(canConfirm(facts({ verified_paid_centavos: 500_000 }))).toBe(true);
  });

  it("reports both problems at once", () => {
    // Staff chasing a customer need to know they want a signature AND
    // the deposit, not discover the second one afterwards.
    expect(
      confirmationBlockers(
        facts({ agreement_signed: false, verified_paid_centavos: 0 }),
      ),
    ).toHaveLength(2);
  });

  it("honours a downpayment percentage other than 50", () => {
    expect(
      canConfirm(facts({ downpayment_percent: 30, verified_paid_centavos: 300_000 })),
    ).toBe(true);
    expect(
      canConfirm(facts({ downpayment_percent: 60, verified_paid_centavos: 500_000 })),
    ).toBe(false);
  });
});

describe("confirmationVerdict", () => {
  const blocked = facts({ agreement_signed: false, verified_paid_centavos: 0 });

  it("allows a clean confirmation without an override", () => {
    expect(
      confirmationVerdict({ facts: facts(), isOwner: false, overrideReason: "" }),
    ).toEqual({ allowed: true, overridden: false });
  });

  it("refuses staff, whatever reason they give", () => {
    const verdict = confirmationVerdict({
      facts: blocked,
      isOwner: false,
      overrideReason: "the customer promised",
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.error).toMatch(/Only the owner/);
  });

  it("refuses the owner until a reason is given", () => {
    expect(
      confirmationVerdict({ facts: blocked, isOwner: true, overrideReason: "" })
        .allowed,
    ).toBe(false);
  });

  it("lets the owner override with a reason, and marks it as overridden", () => {
    expect(
      confirmationVerdict({
        facts: blocked,
        isOwner: true,
        overrideReason: "paid in cash at the shop, agreement signing on delivery",
      }),
    ).toEqual({ allowed: true, overridden: true });
  });
});

// ── Booking validation ────────────────────────────────────────
describe("validateBooking", () => {
  it("accepts a complete draft", () => {
    expect(validateBooking(bookingDraft())).toBeNull();
  });

  it("requires a customer, an event date, and at least one item", () => {
    expect(validateBooking(bookingDraft({ customer_id: "" }))).toMatch(
      /customer/i,
    );
    expect(validateBooking(bookingDraft({ event_date: "29-08-2026" }))).toMatch(
      /calendar date/,
    );
    expect(validateBooking(bookingDraft({ lines: [] }))).toMatch(
      /empty booking reserves nothing/,
    );
  });

  it("does not complain about ₱0.00 package component rows", () => {
    // Components are priced at zero because the package line above
    // them carries the price.
    const draft = bookingDraft({
      lines: [
        bookingLine({
          line_type: "package",
          description: "Birthday Arch Backdrop",
          quantity: 1,
          unit_price_centavos: 450_000,
        }),
        bookingLine({
          line_type: "rental",
          description: "Arch frame",
          quantity: 1,
          unit_price_centavos: 0,
          is_component: true,
        }),
      ],
    });

    expect(validateBooking(draft)).toBeNull();
  });

  it("still refuses a booking of nothing but components", () => {
    expect(
      validateBooking(
        bookingDraft({ lines: [bookingLine({ is_component: true })] }),
      ),
    ).toMatch(/empty booking reserves nothing/);
  });

  it("carries the shared money rules through", () => {
    expect(
      validateBooking(
        bookingDraft({
          within_free_delivery_area: true,
          delivery_fee_centavos: 50_000,
        }),
      ),
    ).toMatch(/free-delivery area/);
  });

  it("checks the schedule too", () => {
    expect(
      validateBooking(
        bookingDraft({ delivery_at: manila("2026-08-30", 9) }),
      ),
    ).toMatch(/arrive late/);
  });
});

describe("pricedLines", () => {
  it("drops the component rows", () => {
    const lines = [
      bookingLine(),
      bookingLine({ is_component: true }),
      bookingLine(),
    ];
    expect(pricedLines(lines)).toHaveLength(2);
  });
});

// ── Returns and damage charges ────────────────────────────────
describe("validateReturn", () => {
  it("accepts a clean return", () => {
    expect(validateReturn(returnRecord({ condition: "ok" }))).toBeNull();
  });

  it("refuses more damaged than went out", () => {
    expect(
      validateReturn(
        returnRecord({
          quantity: 10,
          condition: "damaged",
          damaged_quantity: 11,
          notes: "crushed",
        }),
      ),
    ).toMatch(/more items marked damaged or lost/);
  });

  it("refuses damage counts on a line marked fine", () => {
    expect(
      validateReturn(
        returnRecord({ condition: "ok", damaged_quantity: 2, notes: "x" }),
      ),
    ).toMatch(/marked as fine/);
  });

  it("refuses a damaged line with no count", () => {
    expect(validateReturn(returnRecord({ condition: "damaged" }))).toMatch(
      /say how many/,
    );
  });

  it("requires a note before charging a customer", () => {
    expect(
      validateReturn(
        returnRecord({ condition: "damaged", damaged_quantity: 2, notes: "  " }),
      ),
    ).toMatch(/add a note/);
  });
});

describe("damageChargeFor", () => {
  it("raises nothing when everything came back fine", () => {
    expect(damageChargeFor(returnRecord({ condition: "ok" }))).toBeNull();
  });

  it("charges the replacement value per affected item", () => {
    const charge = damageChargeFor(
      returnRecord({
        condition: "damaged",
        damaged_quantity: 3,
        notes: "legs snapped",
      }),
    );

    expect(charge).toMatchObject({
      quantity: 3,
      unit_price_centavos: 45_000,
      total_centavos: 135_000, // ₱1,350.00
    });
    expect(charge?.description).toMatch(/damaged \(replacement value\)/);
  });

  it("describes a mixed damaged-and-lost return", () => {
    const charge = damageChargeFor(
      returnRecord({
        condition: "lost",
        damaged_quantity: 1,
        lost_quantity: 2,
        notes: "two never came back",
      }),
    );

    expect(charge?.quantity).toBe(3);
    expect(charge?.description).toMatch(/1 damaged, 2 lost/);
  });

  it("raises nothing when the item has no replacement value on file", () => {
    // A ₱0.00 charge line would only clutter the booking.
    expect(
      damageChargeFor(
        returnRecord({
          condition: "damaged",
          damaged_quantity: 1,
          replacement_value_centavos: 0,
          notes: "scuffed",
        }),
      ),
    ).toBeNull();
  });
});

describe("inventoryEffectFor", () => {
  it("takes damaged stock out of service without losing it", () => {
    expect(
      inventoryEffectFor(
        returnRecord({ condition: "damaged", damaged_quantity: 4, notes: "x" }),
        "chair",
      ),
    ).toEqual({ catalog_item_id: "chair", damaged_delta: 4, owned_delta: 0 });
  });

  it("reduces what the business owns when items are lost", () => {
    expect(
      inventoryEffectFor(
        returnRecord({ condition: "lost", lost_quantity: 2, notes: "x" }),
        "chair",
      ),
    ).toEqual({ catalog_item_id: "chair", damaged_delta: 0, owned_delta: -2 });
  });

  it("does nothing for a clean return or a custom line", () => {
    expect(inventoryEffectFor(returnRecord(), "chair")).toBeNull();
    expect(
      inventoryEffectFor(
        returnRecord({ condition: "damaged", damaged_quantity: 1, notes: "x" }),
        null,
      ),
    ).toBeNull();
  });
});

describe("allLinesChecked", () => {
  it("is true once nothing is pending", () => {
    expect(allLinesChecked(["ok", "damaged"])).toBe(true);
  });

  it("is false while a line is unchecked, or when there are none", () => {
    expect(allLinesChecked(["ok", "pending"])).toBe(false);
    expect(allLinesChecked([])).toBe(false);
  });
});

// ── Manila wall-clock conversion ──────────────────────────────
describe("manilaLocalToInstant", () => {
  it("reads a datetime-local value as Manila time, not the browser's", () => {
    // 2:00 PM in Meycauayan is 06:00 UTC, whatever timezone the phone
    // filling in the form happens to be set to.
    expect(manilaLocalToInstant("2026-08-28T14:00")).toBe(
      "2026-08-28T06:00:00.000Z",
    );
  });

  it("rolls back a day for early-morning setups", () => {
    expect(manilaLocalToInstant("2026-08-28T05:30")).toBe(
      "2026-08-27T21:30:00.000Z",
    );
  });

  it("rejects anything that is not a datetime-local value", () => {
    expect(manilaLocalToInstant("2026-08-28")).toBeNull();
    expect(manilaLocalToInstant("")).toBeNull();
    expect(manilaLocalToInstant("nonsense")).toBeNull();
  });
});

describe("instantToManilaLocal", () => {
  it("round-trips a wall-clock time", () => {
    const local = "2026-08-28T14:00";
    expect(instantToManilaLocal(manilaLocalToInstant(local)!)).toBe(local);
  });

  it("renders Manila midnight as 00:00, not 24:00", () => {
    expect(instantToManilaLocal("2026-08-28T16:00:00.000Z")).toBe(
      "2026-08-29T00:00",
    );
    expect(manilaCalendarDate("2026-08-28T16:00:00.000Z")).toBe("2026-08-29");
  });
});

// ── Calendar grid (Spec 4.10) ─────────────────────────────────
function calendarBooking(
  overrides: Partial<CalendarBooking> = {},
): CalendarBooking {
  return {
    id: "b1",
    booking_number: "BK-2026-0001",
    customer_name: "Maria Santos",
    status: "confirmed",
    event_date: "2026-08-29",
    delivery_day: "2026-08-28",
    pickup_day: "2026-08-30",
    setup_day: null,
    teardown_day: null,
    reserved_from: "2026-08-28",
    reserved_to: "2026-08-30",
    ...overrides,
  };
}

describe("calendar grid", () => {
  it("starts each week on Sunday", () => {
    // 2026-08-29 is a Saturday.
    expect(startOfWeek("2026-08-29")).toBe("2026-08-23");
    expect(weekGrid("2026-08-29")).toHaveLength(7);
    expect(weekGrid("2026-08-29")[0]).toBe("2026-08-23");
  });

  it("knows the length of a month, including February in a leap year", () => {
    expect(endOfMonth("2026-08-10")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("builds whole weeks, padded from the neighbouring months", () => {
    const grid = monthGrid("2026-08-10");
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe("2026-07-26"); // the Sunday before Aug 1
    expect(grid).toContain("2026-08-31");
    expect(grid.at(-1)).toBe("2026-09-05"); // the Saturday after Aug 31
  });

  it("steps months without landing on the 31st of a short month", () => {
    expect(shiftMonth("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("loads the range the visible grid actually covers", () => {
    expect(rangeFor("day", "2026-08-29")).toEqual({
      from: "2026-08-29",
      to: "2026-08-29",
    });
    expect(rangeFor("week", "2026-08-29")).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
    expect(rangeFor("month", "2026-08-10").from).toBe("2026-07-26");
  });
});

describe("markersOn", () => {
  it("marks each leg of the job on the day it happens", () => {
    const booking = calendarBooking();
    expect(markersOn(booking, "2026-08-28")).toEqual(["delivery"]);
    expect(markersOn(booking, "2026-08-29")).toEqual(["event"]);
    expect(markersOn(booking, "2026-08-30")).toEqual(["pickup"]);
  });

  it("marks a day in the middle as ongoing", () => {
    const booking = calendarBooking({
      event_date: "2026-08-31",
      pickup_day: "2026-09-01",
      reserved_to: "2026-09-01",
    });
    expect(markersOn(booking, "2026-08-30")).toEqual(["ongoing"]);
  });

  it("says nothing about a day outside the window", () => {
    expect(markersOn(calendarBooking(), "2026-09-05")).toEqual([]);
  });

  it("shows a setup and an event on the same day", () => {
    const booking = calendarBooking({
      setup_day: "2026-08-29",
      delivery_day: "2026-08-29",
    });
    expect(markersOn(booking, "2026-08-29")).toEqual([
      "setup",
      "delivery",
      "event",
    ]);
  });
});

describe("bookingsOn", () => {
  it("puts backdrop setups first — they need a crew on site early", () => {
    const entries = bookingsOn(
      [
        calendarBooking({ id: "delivery-job", delivery_day: "2026-08-29" }),
        calendarBooking({
          id: "backdrop-job",
          setup_day: "2026-08-29",
          delivery_day: null,
        }),
      ],
      "2026-08-29",
    );

    expect(entries[0].booking.id).toBe("backdrop-job");
  });

  it("leaves out bookings that do not touch the day", () => {
    expect(bookingsOn([calendarBooking()], "2026-10-01")).toEqual([]);
  });
});
