import { describe, expect, it } from "vitest";

import { canVoid, isOrderStatus } from "@/lib/orders/status";
import {
  describeDiscrepancies,
  findDiscrepancies,
  lowStockItems,
  soldQuantities,
  stockAfterSale,
  stockAfterVoid,
  type StockLine,
  type StockOnHand,
} from "@/lib/orders/stock";
import {
  orderTotals,
  validateOrder,
  type OrderDraft,
} from "@/lib/orders/totals";
import { summarisePayments } from "@/lib/payments/totals";

type TestLine = StockLine & {
  unit_price_centavos: number;
  line_discount_centavos: number;
};

function line(overrides: Partial<TestLine> = {}): TestLine {
  return {
    catalog_item_id: "balloon",
    description: "Balloon garland kit",
    quantity: 2,
    unit_price_centavos: 12_550,
    line_discount_centavos: 0,
    ...overrides,
  };
}

function onHand(overrides: Partial<StockOnHand> = {}): StockOnHand {
  return {
    catalog_item_id: "balloon",
    name: "Balloon garland kit",
    stock_quantity: 10,
    low_stock_threshold: 3,
    ...overrides,
  };
}

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    lines: [line()],
    discount_centavos: 0,
    customer_label: "Walk-in",
    sold_on: "2026-08-10",
    ...overrides,
  };
}

// ── Order arithmetic ──────────────────────────────────────────
describe("orderTotals", () => {
  it("is lines less the discount — no delivery fee at a counter", () => {
    const totals = orderTotals({
      lines: [
        line({ quantity: 2, unit_price_centavos: 12_550 }), // ₱251.00
        line({ quantity: 1, unit_price_centavos: 45_000 }), // ₱450.00
      ],
      discount_centavos: 5_000,
    });

    expect(totals.subtotal_centavos).toBe(70_100);
    expect(totals.discount_centavos).toBe(5_000);
    expect(totals.total_centavos).toBe(65_100);
  });

  it("caps the discount so a sale can never go negative", () => {
    const totals = orderTotals({
      lines: [line({ quantity: 1, unit_price_centavos: 10_000 })],
      discount_centavos: 999_999,
    });

    expect(totals.discount_centavos).toBe(10_000);
    expect(totals.total_centavos).toBe(0);
  });

  it("honours a per-line discount", () => {
    const totals = orderTotals({
      lines: [
        line({
          quantity: 2,
          unit_price_centavos: 12_550,
          line_discount_centavos: 1_000,
        }),
      ],
      discount_centavos: 0,
    });

    expect(totals.total_centavos).toBe(24_100);
  });
});

describe("validateOrder", () => {
  it("accepts a walk-in sale", () => {
    expect(validateOrder(draft())).toBeNull();
  });

  it("refuses an empty sale", () => {
    expect(validateOrder(draft({ lines: [] }))).toMatch(/at least one item/);
  });

  it("refuses a discount larger than the items", () => {
    expect(
      validateOrder(
        draft({
          lines: [line({ quantity: 1, unit_price_centavos: 10_000 })],
          discount_centavos: 10_001,
        }),
      ),
    ).toMatch(/more than the items/);
  });

  it("refuses a blank customer label", () => {
    expect(validateOrder(draft({ customer_label: "  " }))).toMatch(
      /Walk-in/,
    );
  });

  it("refuses a malformed sale date", () => {
    expect(validateOrder(draft({ sold_on: "10-08-2026" }))).toMatch(
      /calendar date/,
    );
  });
});

// ── Stock ─────────────────────────────────────────────────────
describe("soldQuantities", () => {
  it("adds up the same item across lines", () => {
    expect(
      soldQuantities([line({ quantity: 2 }), line({ quantity: 3 })]).get(
        "balloon",
      ),
    ).toBe(5);
  });

  it("ignores a custom line with no catalog item", () => {
    expect(soldQuantities([line({ catalog_item_id: null })]).size).toBe(0);
  });
});

describe("stock movements", () => {
  it("takes stock away on a sale and never goes below empty", () => {
    expect(stockAfterSale(10, 3)).toBe(7);
    expect(stockAfterSale(2, 5)).toBe(0);
  });

  it("puts it back on a void", () => {
    expect(stockAfterVoid(7, 3)).toBe(10);
  });
});

describe("findDiscrepancies", () => {
  it("is quiet when there is enough on the shelf", () => {
    expect(findDiscrepancies([line({ quantity: 5 })], [onHand()])).toEqual([]);
  });

  it("flags a sale larger than the recorded stock", () => {
    // The goods physically left the shop — refusing to record it would
    // recreate the unrecorded-sales problem the POS screen exists for.
    // So it is a discrepancy to investigate, not a rejection.
    const found = findDiscrepancies(
      [line({ quantity: 12 })],
      [onHand({ stock_quantity: 10 })],
    );

    expect(found).toEqual([
      {
        catalog_item_id: "balloon",
        name: "Balloon garland kit",
        sold: 12,
        on_hand: 10,
      },
    ]);
    expect(describeDiscrepancies(found)).toMatch(/recounting the shelf/);
  });

  it("counts both lines of the same item before deciding", () => {
    // Six and six is twelve, and twelve does not fit in ten.
    expect(
      findDiscrepancies(
        [line({ quantity: 6 }), line({ quantity: 6 })],
        [onHand({ stock_quantity: 10 })],
      ),
    ).toHaveLength(1);
  });

  it("says nothing about an item it holds no count for", () => {
    expect(findDiscrepancies([line()], [])).toEqual([]);
  });
});

describe("lowStockItems", () => {
  it("lists items at or below their threshold, emptiest first", () => {
    const low = lowStockItems([
      onHand({ catalog_item_id: "a", name: "A", stock_quantity: 3, low_stock_threshold: 3 }),
      onHand({ catalog_item_id: "b", name: "B", stock_quantity: 1, low_stock_threshold: 5 }),
      onHand({ catalog_item_id: "c", name: "C", stock_quantity: 50, low_stock_threshold: 5 }),
    ]);

    expect(low.map((item) => item.catalog_item_id)).toEqual(["b", "a"]);
  });

  it("ignores items the owner does not track", () => {
    // A threshold of zero means "do not alert me about this".
    expect(
      lowStockItems([onHand({ stock_quantity: 0, low_stock_threshold: 0 })]),
    ).toEqual([]);
  });
});

// ── Order lifecycle ───────────────────────────────────────────
describe("order status", () => {
  it("can void a completed sale, but not a voided one", () => {
    expect(canVoid("completed")).toBe(true);
    expect(canVoid("voided")).toBe(false);
  });

  it("recognises its own status strings", () => {
    expect(isOrderStatus("voided")).toBe(true);
    expect(isOrderStatus("refunded")).toBe(false);
  });
});

// ── Money reconciles on an order too (Spec 8) ─────────────────
describe("an order's money reconciles", () => {
  it("total equals verified payments plus balance due", () => {
    const totals = orderTotals({
      lines: [line({ quantity: 2, unit_price_centavos: 12_550 })],
      discount_centavos: 0,
    });

    // Cash at the counter is verified on sight.
    const summary = summarisePayments(
      [{ amount_centavos: 25_100, status: "verified" }],
      totals.total_centavos,
    );

    expect(summary.verified_centavos + summary.balance_centavos).toBe(
      totals.total_centavos,
    );
    expect(summary.balance_centavos).toBe(0);
  });

  it("leaves a balance when the customer is short", () => {
    const summary = summarisePayments(
      [{ amount_centavos: 20_000, status: "verified" }],
      25_100,
    );
    expect(summary.balance_centavos).toBe(5_100);
  });
});
