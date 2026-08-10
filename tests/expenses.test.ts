import { describe, expect, it } from "vitest";

import {
  applyAssetMove,
  assetBreakdown,
  daysOverdue,
  isAssetMove,
  isOvercommitted,
  overdueReturns,
  validateAssetMove,
  type AssetCounts,
  type OutItem,
} from "@/lib/assets/status";
import {
  agingBucketFor,
  summarisePayables,
  totalsByCategory,
  uncategorisedCount,
  type ExpenseLike,
} from "@/lib/expenses/payables";
import {
  isKnownCategory,
  validateExpense,
  type ExpenseDraft,
} from "@/lib/expenses/validation";

function counts(overrides: Partial<AssetCounts> = {}): AssetCounts {
  return {
    quantity_owned: 100,
    damaged_quantity: 0,
    under_repair_quantity: 0,
    written_off_quantity: 0,
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseLike> = {}): ExpenseLike {
  return {
    amount_centavos: 150_000,
    category: "Purchases / Restock",
    is_paid: true,
    due_date: null,
    expense_date: "2026-08-01",
    ...overrides,
  };
}

function draft(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    expense_date: "2026-08-10",
    payee: "Ace Hardware",
    category: "Repairs",
    amount_centavos: 150_000,
    is_paid: true,
    due_date: null,
    paid_on: "2026-08-10",
    ...overrides,
  };
}

function out(overrides: Partial<OutItem> = {}): OutItem {
  return {
    booking_id: "b1",
    booking_number: "BK-2026-0001",
    customer_name: "Maria Santos",
    due_back: "2026-08-30",
    status: "delivered",
    ...overrides,
  };
}

// ── Asset breakdown (Spec 4.9) ────────────────────────────────
describe("assetBreakdown", () => {
  it("leaves available as what nothing else has a claim on", () => {
    const breakdown = assetBreakdown(
      counts({ quantity_owned: 100, damaged_quantity: 5, under_repair_quantity: 3 }),
      { reserved: 20, out_on_rental: 12 },
    );

    expect(breakdown.available).toBe(60);
    expect(breakdown.reserved).toBe(20);
    expect(breakdown.out_on_rental).toBe(12);
  });

  it("floors available at zero and flags the over-commitment", () => {
    const activity = { reserved: 90, out_on_rental: 30 };
    const fleet = counts({ quantity_owned: 100 });

    expect(assetBreakdown(fleet, activity).available).toBe(0);
    expect(isOvercommitted(fleet, activity)).toBe(true);
  });

  it("is not over-committed when it exactly fits", () => {
    expect(
      isOvercommitted(counts({ quantity_owned: 10, damaged_quantity: 2 }), {
        reserved: 8,
        out_on_rental: 0,
      }),
    ).toBe(false);
  });
});

// ── Moving broken stock (the Milestone 4 gap) ─────────────────
describe("validateAssetMove", () => {
  it("refuses repairing more than are broken", () => {
    expect(
      validateAssetMove(counts({ damaged_quantity: 3 }), "repaired_from_damaged", 4),
    ).toMatch(/Only 3 are marked damaged/);
  });

  it("refuses returning more than are away for repair", () => {
    expect(
      validateAssetMove(
        counts({ under_repair_quantity: 1 }),
        "repaired_from_repair",
        2,
      ),
    ).toMatch(/Only 1 are away for repair/);
  });

  it("refuses a zero or fractional quantity", () => {
    expect(
      validateAssetMove(counts({ damaged_quantity: 5 }), "sent_for_repair", 0),
    ).toMatch(/1 or more/);
    expect(
      validateAssetMove(counts({ damaged_quantity: 5 }), "sent_for_repair", 1.5),
    ).toMatch(/1 or more/);
  });

  it("accepts a move that fits", () => {
    expect(
      validateAssetMove(counts({ damaged_quantity: 5 }), "sent_for_repair", 5),
    ).toBeNull();
  });

  it("recognises its own move names", () => {
    expect(isAssetMove("sent_for_repair")).toBe(true);
    expect(isAssetMove("thrown_away")).toBe(false);
  });
});

describe("applyAssetMove", () => {
  it("puts repaired stock straight back on the shelf", () => {
    // Taking it out of the damaged pile IS putting it back — available
    // is derived, not stored.
    const after = applyAssetMove(
      counts({ quantity_owned: 100, damaged_quantity: 4 }),
      "repaired_from_damaged",
      4,
    );

    expect(after.damaged_quantity).toBe(0);
    expect(after.quantity_owned).toBe(100);
    expect(assetBreakdown(after, { reserved: 0, out_on_rental: 0 }).available).toBe(
      100,
    );
  });

  it("moves damaged stock into the repair pile without losing it", () => {
    const after = applyAssetMove(
      counts({ damaged_quantity: 6 }),
      "sent_for_repair",
      2,
    );

    expect(after.damaged_quantity).toBe(4);
    expect(after.under_repair_quantity).toBe(2);
    // Still owned, still unavailable.
    expect(after.quantity_owned).toBe(100);
    expect(
      assetBreakdown(after, { reserved: 0, out_on_rental: 0 }).available,
    ).toBe(94);
  });

  it("brings stock back from repair", () => {
    const after = applyAssetMove(
      counts({ under_repair_quantity: 3 }),
      "repaired_from_repair",
      3,
    );
    expect(after.under_repair_quantity).toBe(0);
  });

  it("writing off shrinks the fleet, not just the broken pile", () => {
    // A written-off item is gone, exactly like one lost on return.
    const after = applyAssetMove(
      counts({ quantity_owned: 100, damaged_quantity: 5 }),
      "written_off_from_damaged",
      5,
    );

    expect(after.damaged_quantity).toBe(0);
    expect(after.written_off_quantity).toBe(5);
    expect(after.quantity_owned).toBe(95);
    expect(
      assetBreakdown(after, { reserved: 0, out_on_rental: 0 }).available,
    ).toBe(95);
  });

  it("writes off from the repair pile too", () => {
    const after = applyAssetMove(
      counts({ quantity_owned: 20, under_repair_quantity: 2 }),
      "written_off_from_repair",
      2,
    );

    expect(after.under_repair_quantity).toBe(0);
    expect(after.quantity_owned).toBe(18);
    expect(after.written_off_quantity).toBe(2);
  });

  it("round-trips damaged → repair → back in service", () => {
    let fleet = counts({ quantity_owned: 50, damaged_quantity: 4 });
    fleet = applyAssetMove(fleet, "sent_for_repair", 4);
    fleet = applyAssetMove(fleet, "repaired_from_repair", 4);

    expect(fleet).toEqual(counts({ quantity_owned: 50 }));
  });
});

// ── Overdue returns ───────────────────────────────────────────
describe("overdueReturns", () => {
  it("flags a booking whose items should already be back", () => {
    expect(
      overdueReturns([out({ due_back: "2026-08-28" })], "2026-08-30"),
    ).toHaveLength(1);
  });

  it("is not overdue on the day it is due", () => {
    expect(
      overdueReturns([out({ due_back: "2026-08-30" })], "2026-08-30"),
    ).toEqual([]);
  });

  it("ignores a booking with no agreed return day", () => {
    // Nobody agreed a date, so there is nothing to be late for —
    // flagging it would train staff to ignore the list.
    expect(overdueReturns([out({ due_back: null })], "2026-12-31")).toEqual([]);
  });

  it("puts the longest overdue first", () => {
    const list = overdueReturns(
      [
        out({ booking_id: "recent", due_back: "2026-08-29" }),
        out({ booking_id: "ancient", due_back: "2026-07-01" }),
      ],
      "2026-08-30",
    );
    expect(list[0].booking_id).toBe("ancient");
  });

  it("counts how many days late", () => {
    expect(daysOverdue("2026-08-28", "2026-08-30")).toBe(2);
    expect(daysOverdue("2026-08-30", "2026-08-30")).toBe(0);
  });
});

// ── Payables (Spec 4.8) ───────────────────────────────────────
describe("summarisePayables", () => {
  it("separates paid, outstanding, and overdue", () => {
    const summary = summarisePayables(
      [
        expense({ is_paid: true, amount_centavos: 100_000 }),
        expense({ is_paid: false, due_date: "2026-09-30", amount_centavos: 50_000 }),
        expense({ is_paid: false, due_date: "2026-08-01", amount_centavos: 25_000 }),
      ],
      "2026-08-30",
    );

    expect(summary.paid_centavos).toBe(100_000);
    // Outstanding is everything unpaid, overdue or not.
    expect(summary.outstanding_centavos).toBe(75_000);
    expect(summary.overdue_centavos).toBe(25_000);
    expect(summary.overdue_count).toBe(1);
  });

  it("is all zeroes for an empty ledger", () => {
    expect(summarisePayables([], "2026-08-30")).toEqual({
      paid_centavos: 0,
      outstanding_centavos: 0,
      overdue_centavos: 0,
      overdue_count: 0,
    });
  });
});

describe("agingBucketFor", () => {
  it("buckets by how long it has been overdue", () => {
    expect(agingBucketFor("2026-09-30", "2026-08-30")).toBe("Not yet due");
    expect(agingBucketFor("2026-08-30", "2026-08-30")).toBe("Not yet due");
    expect(agingBucketFor("2026-08-20", "2026-08-30")).toBe("1–30 days");
    expect(agingBucketFor("2026-07-10", "2026-08-30")).toBe("31–60 days");
    expect(agingBucketFor("2026-06-10", "2026-08-30")).toBe("61–90 days");
    expect(agingBucketFor("2026-01-10", "2026-08-30")).toBe("Over 90 days");
  });

  it("treats an undated payable as not yet due", () => {
    expect(agingBucketFor(null, "2026-08-30")).toBe("Not yet due");
  });
});

describe("totalsByCategory", () => {
  it("totals per category, biggest first", () => {
    const totals = totalsByCategory([
      expense({ category: "Fuel & Delivery", amount_centavos: 30_000 }),
      expense({ category: "Repairs", amount_centavos: 200_000 }),
      expense({ category: "Fuel & Delivery", amount_centavos: 20_000 }),
    ]);

    expect(totals[0]).toEqual({
      category: "Repairs",
      total_centavos: 200_000,
      count: 1,
    });
    expect(totals[1]).toEqual({
      category: "Fuel & Delivery",
      total_centavos: 50_000,
      count: 2,
    });
  });

  it("gives uncategorised spending a visible bucket", () => {
    // This is exactly what the bookkeeper is hunting for, so it must
    // not disappear into a blank label.
    const totals = totalsByCategory([expense({ category: "  " })]);
    expect(totals[0].category).toBe("Uncategorised");
    expect(uncategorisedCount([expense({ category: "" })])).toBe(1);
  });
});

// ── Expense validation ────────────────────────────────────────
describe("validateExpense", () => {
  it("accepts a paid expense", () => {
    expect(validateExpense(draft())).toBeNull();
  });

  it("accepts a payable with a due date", () => {
    expect(
      validateExpense(
        draft({ is_paid: false, paid_on: null, due_date: "2026-09-15" }),
      ),
    ).toBeNull();
  });

  it("refuses an unpaid expense with no due date", () => {
    expect(
      validateExpense(draft({ is_paid: false, paid_on: null, due_date: null })),
    ).toMatch(/never be chased/);
  });

  it("refuses a payment date before the expense was incurred", () => {
    expect(
      validateExpense(
        draft({ expense_date: "2026-08-10", paid_on: "2026-08-01" }),
      ),
    ).toMatch(/paid before it was incurred/);
  });

  it("requires an amount and a payee", () => {
    expect(validateExpense(draft({ amount_centavos: 0 }))).toMatch(/above ₱0/);
    expect(validateExpense(draft({ payee: "  " }))).toMatch(/who was paid/);
  });
});

describe("isKnownCategory", () => {
  const configured = ["Repairs", "Fuel & Delivery", "Utilities"];

  it("matches regardless of case and padding", () => {
    expect(isKnownCategory("  repairs ", configured)).toBe(true);
  });

  it("does not match a blank or unknown category", () => {
    expect(isKnownCategory("", configured)).toBe(false);
    expect(isKnownCategory("Bribes", configured)).toBe(false);
  });
});
