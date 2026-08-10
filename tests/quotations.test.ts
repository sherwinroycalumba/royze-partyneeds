import { describe, expect, it } from "vitest";

import { addCalendarDays } from "@/lib/date";
import {
  DOCUMENT_PREFIXES,
  documentFilename,
  formatDocumentNumber,
  isDocumentNumber,
  parseDocumentNumber,
} from "@/lib/quotations/numbering";
import {
  allowedTransitions,
  canConvertToBooking,
  canEditQuotation,
  canTransition,
  daysUntilExpiry,
  defaultValidUntil,
  effectiveStatus,
  isQuotationStatus,
} from "@/lib/quotations/status";
import {
  deliveryFeeCharged,
  deliveryFeeLabel,
  isCalendarDate,
  lineTotal,
  linesSubtotal,
  quotationTotals,
  validateLine,
  validateQuotation,
  type LineDraft,
  type QuotationDraft,
} from "@/lib/quotations/totals";

// ── Helpers ───────────────────────────────────────────────────
function line(overrides: Partial<LineDraft> = {}): LineDraft {
  return {
    line_type: "rental",
    description: "Monoblock chair",
    quantity: 1,
    unit_price_centavos: 2_500, // ₱25.00
    line_discount_centavos: 0,
    ...overrides,
  };
}

function draft(overrides: Partial<QuotationDraft> = {}): QuotationDraft {
  return {
    customer_id: "11111111-1111-1111-1111-111111111111",
    issue_date: "2026-08-10",
    valid_until: "2026-08-17",
    lines: [line()],
    within_free_delivery_area: false,
    delivery_fee_centavos: 0,
    delivery_fee_override_reason: "",
    discount_centavos: 0,
    downpayment_percent: 50,
    ...overrides,
  };
}

// ── Numbering ─────────────────────────────────────────────────
describe("formatDocumentNumber", () => {
  it("formats as PREFIX-YYYY-#### with a four-digit sequence", () => {
    expect(formatDocumentNumber("QT", 2026, 1)).toBe("QT-2026-0001");
    expect(formatDocumentNumber("QT", 2026, 42)).toBe("QT-2026-0042");
    expect(formatDocumentNumber("BK", 2026, 9999)).toBe("BK-2026-9999");
  });

  it("lets the sequence grow past four digits rather than truncating", () => {
    // Truncating would recycle a number that is already on a document.
    expect(formatDocumentNumber("QT", 2026, 10_000)).toBe("QT-2026-10000");
  });

  it("rejects impossible years and sequences", () => {
    expect(() => formatDocumentNumber("QT", 26, 1)).toThrow(RangeError);
    expect(() => formatDocumentNumber("QT", 2026, 0)).toThrow(RangeError);
    expect(() => formatDocumentNumber("QT", 2026, 1.5)).toThrow(RangeError);
  });

  it("covers every document kind the spec numbers", () => {
    expect(Object.values(DOCUMENT_PREFIXES)).toEqual(["QT", "BK", "RA", "OR"]);
  });
});

describe("parseDocumentNumber", () => {
  it("reads a number back apart", () => {
    expect(parseDocumentNumber("QT-2026-0007")).toEqual({
      prefix: "QT",
      year: 2026,
      sequence: 7,
    });
  });

  it("tolerates casing and surrounding space from a pasted search", () => {
    expect(parseDocumentNumber("  qt-2026-0007 ")?.sequence).toBe(7);
  });

  it("rejects anything that is not a document number", () => {
    expect(parseDocumentNumber("QT-2026-7")).toBeNull();
    expect(parseDocumentNumber("QT-26-0007")).toBeNull();
    expect(parseDocumentNumber("Maria Santos")).toBeNull();
    expect(parseDocumentNumber("")).toBeNull();
  });

  it("identifies the kind", () => {
    expect(isDocumentNumber("QT-2026-0001", "quotation")).toBe(true);
    expect(isDocumentNumber("BK-2026-0001", "quotation")).toBe(false);
  });
});

describe("documentFilename", () => {
  it("names the download after the document", () => {
    expect(documentFilename("QT-2026-0001")).toBe("QT-2026-0001.pdf");
  });

  it("refuses anything that could inject a response header", () => {
    // The value lands in Content-Disposition — a quote or newline
    // there is a header-injection bug, so it is rejected, not cleaned.
    expect(() => documentFilename('QT-2026-0001"; x="')).toThrow(RangeError);
    expect(() => documentFilename("QT-2026-0001\r\nX-Evil: 1")).toThrow(
      RangeError,
    );
  });
});

// ── Line and total arithmetic ─────────────────────────────────
describe("lineTotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineTotal(line({ quantity: 50, unit_price_centavos: 2_500 }))).toBe(
      125_000,
    );
  });

  it("subtracts the line discount", () => {
    expect(
      lineTotal(
        line({
          quantity: 10,
          unit_price_centavos: 2_500,
          line_discount_centavos: 5_000,
        }),
      ),
    ).toBe(20_000);
  });

  it("never goes negative, so a bad row cannot eat the other lines", () => {
    expect(
      lineTotal(
        line({
          quantity: 1,
          unit_price_centavos: 2_500,
          line_discount_centavos: 999_999,
        }),
      ),
    ).toBe(0);
  });
});

describe("linesSubtotal", () => {
  it("sums every line exactly", () => {
    expect(
      linesSubtotal([
        line({ quantity: 50, unit_price_centavos: 2_500 }), // ₱1,250.00
        line({ quantity: 10, unit_price_centavos: 15_000 }), // ₱1,500.00
        line({
          quantity: 2,
          unit_price_centavos: 450_000,
          line_discount_centavos: 50_000,
        }), // ₱8,500.00
      ]),
    ).toBe(1_125_000);
  });

  it("is zero for no lines", () => {
    expect(linesSubtotal([])).toBe(0);
  });
});

describe("deliveryFeeCharged", () => {
  it("charges the entered fee outside the free area", () => {
    expect(
      deliveryFeeCharged({
        within_free_delivery_area: false,
        delivery_fee_centavos: 50_000,
      }),
    ).toBe(50_000);
  });

  it("forces the fee to zero inside the free area (Spec 4.4)", () => {
    // The toggle wins over a stale number left in the field, so the
    // money can never contradict the "FREE Delivery" line on the PDF.
    expect(
      deliveryFeeCharged({
        within_free_delivery_area: true,
        delivery_fee_centavos: 50_000,
      }),
    ).toBe(0);
  });
});

describe("quotationTotals", () => {
  it("adds delivery after taking the discount off the goods", () => {
    const totals = quotationTotals({
      lines: [line({ quantity: 100, unit_price_centavos: 2_500 })], // ₱2,500.00
      within_free_delivery_area: false,
      delivery_fee_centavos: 50_000, // ₱500.00
      discount_centavos: 25_000, // ₱250.00
      downpayment_percent: 50,
    });

    expect(totals.subtotal_centavos).toBe(250_000);
    expect(totals.discount_centavos).toBe(25_000);
    expect(totals.delivery_fee_centavos).toBe(50_000);
    // The delivery fee is a cost the business carries either way, so
    // the discount must not come off it.
    expect(totals.total_centavos).toBe(275_000);
  });

  it("computes the 50% downpayment off the final total", () => {
    const totals = quotationTotals({
      lines: [line({ quantity: 1, unit_price_centavos: 450_100 })],
      within_free_delivery_area: true,
      delivery_fee_centavos: 0,
      discount_centavos: 0,
      downpayment_percent: 50,
    });

    // ₱4,501.00 → half is ₱2,250.50, rounded half-up to the centavo.
    expect(totals.total_centavos).toBe(450_100);
    expect(totals.downpayment_centavos).toBe(225_050);
  });

  it("honours a downpayment percentage other than the default", () => {
    const totals = quotationTotals({
      lines: [line({ quantity: 1, unit_price_centavos: 100_000 })],
      within_free_delivery_area: true,
      delivery_fee_centavos: 0,
      discount_centavos: 0,
      downpayment_percent: 30,
    });

    expect(totals.downpayment_centavos).toBe(30_000);
  });

  it("zeroes the delivery fee inside the free area", () => {
    const totals = quotationTotals({
      lines: [line({ quantity: 1, unit_price_centavos: 100_000 })],
      within_free_delivery_area: true,
      delivery_fee_centavos: 50_000,
      discount_centavos: 0,
      downpayment_percent: 50,
    });

    expect(totals.delivery_fee_centavos).toBe(0);
    expect(totals.total_centavos).toBe(100_000);
  });

  it("caps the general discount at the subtotal so the total stays positive", () => {
    const totals = quotationTotals({
      lines: [line({ quantity: 1, unit_price_centavos: 100_000 })],
      within_free_delivery_area: false,
      delivery_fee_centavos: 20_000,
      discount_centavos: 999_999,
      downpayment_percent: 50,
    });

    expect(totals.discount_centavos).toBe(100_000);
    expect(totals.total_centavos).toBe(20_000);
  });

  it("reconciles to the centavo across a realistic mixed quotation", () => {
    const totals = quotationTotals({
      lines: [
        line({ quantity: 100, unit_price_centavos: 2_500 }), // chairs ₱2,500.00
        line({ quantity: 20, unit_price_centavos: 15_000 }), // tables ₱3,000.00
        line({
          line_type: "package",
          quantity: 1,
          unit_price_centavos: 450_000,
          line_discount_centavos: 50_000,
        }), // backdrop ₱4,000.00
        line({ line_type: "sale", quantity: 3, unit_price_centavos: 12_550 }), // ₱376.50
      ],
      within_free_delivery_area: false,
      delivery_fee_centavos: 50_000,
      discount_centavos: 37_650,
      downpayment_percent: 50,
    });

    expect(totals.subtotal_centavos).toBe(987_650); // ₱9,876.50
    expect(totals.total_centavos).toBe(1_000_000); // ₱10,000.00
    expect(totals.downpayment_centavos).toBe(500_000); // ₱5,000.00
  });
});

describe("deliveryFeeLabel", () => {
  it("names the free area on the document (Spec 4.4)", () => {
    expect(deliveryFeeLabel(true, "Deca Homes Meycauayan")).toBe(
      "FREE Delivery & Pickup (within Deca Homes Meycauayan)",
    );
  });

  it("falls back gracefully when no area is configured", () => {
    expect(deliveryFeeLabel(true, "  ")).toBe("FREE Delivery & Pickup");
  });

  it("is a plain charge line outside the area", () => {
    expect(deliveryFeeLabel(false, "Deca Homes Meycauayan")).toBe(
      "Delivery & Pickup",
    );
  });
});

// ── Validation ────────────────────────────────────────────────
describe("validateLine", () => {
  it("accepts a good line", () => {
    expect(validateLine(line(), 1)).toBeNull();
  });

  it("names the row it is complaining about", () => {
    expect(validateLine(line({ description: "  " }), 3)).toMatch(/^Line 3:/);
  });

  it("rejects a zero or fractional quantity", () => {
    expect(validateLine(line({ quantity: 0 }), 1)).toMatch(/whole number/);
    expect(validateLine(line({ quantity: 2.5 }), 1)).toMatch(/whole number/);
  });

  it("rejects a line discount above the line's value", () => {
    expect(
      validateLine(
        line({
          quantity: 2,
          unit_price_centavos: 2_500,
          line_discount_centavos: 5_001,
        }),
        1,
      ),
    ).toMatch(/more than the line is worth/);
  });

  it("allows a discount of exactly the line's value — a free giveaway", () => {
    expect(
      validateLine(
        line({
          quantity: 2,
          unit_price_centavos: 2_500,
          line_discount_centavos: 5_000,
        }),
        1,
      ),
    ).toBeNull();
  });
});

describe("validateQuotation", () => {
  it("accepts a complete draft", () => {
    expect(validateQuotation(draft())).toBeNull();
  });

  it("requires a customer and at least one line", () => {
    expect(validateQuotation(draft({ customer_id: "" }))).toMatch(/customer/i);
    expect(validateQuotation(draft({ lines: [] }))).toMatch(/at least one item/);
  });

  it("refuses a validity date before the quotation date", () => {
    expect(
      validateQuotation(
        draft({ issue_date: "2026-08-10", valid_until: "2026-08-09" }),
      ),
    ).toMatch(/cannot be before/);
  });

  it("accepts a same-day validity — a quotation good for today only", () => {
    expect(
      validateQuotation(
        draft({ issue_date: "2026-08-10", valid_until: "2026-08-10" }),
      ),
    ).toBeNull();
  });

  it("refuses a fee inside the free-delivery area", () => {
    expect(
      validateQuotation(
        draft({
          within_free_delivery_area: true,
          delivery_fee_centavos: 50_000,
        }),
      ),
    ).toMatch(/free-delivery area/);
  });

  it("refuses a discount larger than the items", () => {
    expect(
      validateQuotation(
        draft({
          lines: [line({ quantity: 1, unit_price_centavos: 10_000 })],
          discount_centavos: 10_001,
        }),
      ),
    ).toMatch(/more than the items/);
  });

  it("refuses a downpayment percentage outside 0–100", () => {
    expect(validateQuotation(draft({ downpayment_percent: 120 }))).toMatch(
      /between 0 and 100/,
    );
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates", () => {
    expect(isCalendarDate("2026-08-10")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects impossible and malformed dates", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-8-10")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

// ── Status lifecycle ──────────────────────────────────────────
describe("defaultValidUntil", () => {
  it("adds the configured validity period (Spec 4.3 default: 7 days)", () => {
    expect(defaultValidUntil("2026-08-10", 7)).toBe("2026-08-17");
  });

  it("crosses month and year boundaries", () => {
    expect(defaultValidUntil("2026-08-28", 7)).toBe("2026-09-04");
    expect(defaultValidUntil("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("falls back to 7 days when the setting is nonsense", () => {
    expect(defaultValidUntil("2026-08-10", 0)).toBe("2026-08-17");
    expect(defaultValidUntil("2026-08-10", -3)).toBe("2026-08-17");
  });
});

describe("addCalendarDays", () => {
  it("moves whole calendar days, including across a leap day", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("effectiveStatus", () => {
  it("expires a sent quotation once its validity date has passed", () => {
    expect(effectiveStatus("sent", "2026-08-17", "2026-08-18")).toBe("expired");
  });

  it("is still valid on the validity date itself", () => {
    expect(effectiveStatus("sent", "2026-08-17", "2026-08-17")).toBe("sent");
  });

  it("never expires a draft — nothing was promised to anyone", () => {
    expect(effectiveStatus("draft", "2026-08-01", "2026-08-18")).toBe("draft");
  });

  it("never expires an answered quotation", () => {
    // The customer already replied; the date passing does not undo it.
    expect(effectiveStatus("accepted", "2026-08-01", "2026-08-18")).toBe(
      "accepted",
    );
    expect(effectiveStatus("declined", "2026-08-01", "2026-08-18")).toBe(
      "declined",
    );
  });
});

describe("daysUntilExpiry", () => {
  it("counts down to the validity date and past it", () => {
    expect(daysUntilExpiry("2026-08-17", "2026-08-10")).toBe(7);
    expect(daysUntilExpiry("2026-08-17", "2026-08-17")).toBe(0);
    expect(daysUntilExpiry("2026-08-17", "2026-08-20")).toBe(-3);
  });
});

describe("quotation transitions", () => {
  it("walks Draft → Sent → Accepted", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "declined")).toBe(true);
  });

  it("cannot skip Sent, and cannot reopen an accepted quotation", () => {
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(allowedTransitions("accepted")).toEqual([]);
  });

  it("never offers Expired as a manual choice — it is derived", () => {
    for (const status of ["draft", "sent", "accepted", "declined", "expired"] as const) {
      expect(allowedTransitions(status)).not.toContain("expired");
    }
  });

  it("lets a declined or expired quotation be re-sent", () => {
    // Staff re-send with a fresh validity date rather than starting over.
    expect(canTransition("expired", "sent")).toBe(true);
    expect(canTransition("declined", "sent")).toBe(true);
  });

  it("freezes an accepted quotation but leaves the rest editable", () => {
    expect(canEditQuotation("accepted")).toBe(false);
    expect(canEditQuotation("sent")).toBe(true);
    expect(canEditQuotation("draft")).toBe(true);
  });

  it("converts to a booking only from Sent or Accepted", () => {
    expect(canConvertToBooking("sent")).toBe(true);
    expect(canConvertToBooking("accepted")).toBe(true);
    expect(canConvertToBooking("draft")).toBe(false);
    expect(canConvertToBooking("expired")).toBe(false);
  });

  it("recognises its own status strings", () => {
    expect(isQuotationStatus("sent")).toBe(true);
    expect(isQuotationStatus("cancelled")).toBe(false);
  });
});
