import { describe, expect, it } from "vitest";

import {
  balanceDue,
  centavosToDecimalString,
  downpaymentRequired,
  formatPeso,
  meetsDownpayment,
  MoneyError,
  multiplyCentavos,
  parsePesoInput,
  percentOfCentavos,
  sumCentavos,
} from "@/lib/money";

describe("parsePesoInput", () => {
  it("parses plain and formatted amounts into centavos", () => {
    expect(parsePesoInput("1234.56")).toBe(123456);
    expect(parsePesoInput("1,234.56")).toBe(123456);
    expect(parsePesoInput("₱1,234.56")).toBe(123456);
    expect(parsePesoInput("1234")).toBe(123400);
    expect(parsePesoInput("0.05")).toBe(5);
    expect(parsePesoInput(".5")).toBe(50);
  });

  it("pads a single decimal place correctly", () => {
    // ₱1.5 is 150 centavos, not 105 — a classic off-by-one-digit bug.
    expect(parsePesoInput("1.5")).toBe(150);
  });

  it("rejects junk and over-precise input", () => {
    expect(parsePesoInput("abc")).toBeNull();
    expect(parsePesoInput("")).toBeNull();
    expect(parsePesoInput("1.234")).toBeNull();
    expect(parsePesoInput("1.2.3")).toBeNull();
  });
});

describe("formatPeso", () => {
  it("formats with the peso sign, thousands separators, and two decimals", () => {
    expect(formatPeso(123456)).toBe("₱1,234.56");
    expect(formatPeso(0)).toBe("₱0.00");
    expect(formatPeso(5)).toBe("₱0.05");
    expect(formatPeso(100000000)).toBe("₱1,000,000.00");
  });

  it("puts the sign ahead of the peso symbol for negatives", () => {
    expect(formatPeso(-25000)).toBe("-₱250.00");
  });

  it("refuses non-integer centavos rather than silently rounding", () => {
    expect(() => formatPeso(12.5)).toThrow(MoneyError);
  });
});

describe("centavosToDecimalString", () => {
  it("round-trips through parsePesoInput", () => {
    for (const centavos of [0, 5, 99, 100, 123456, 999999999]) {
      expect(parsePesoInput(centavosToDecimalString(centavos))).toBe(centavos);
    }
  });
});

describe("exact arithmetic", () => {
  it("adds without floating point drift", () => {
    // The ₱0.10 + ₱0.20 case that breaks float money.
    expect(sumCentavos([10, 20])).toBe(30);
    expect(sumCentavos([])).toBe(0);
  });

  it("multiplies a unit price by a quantity", () => {
    expect(multiplyCentavos(15000, 12)).toBe(180000); // ₱150 × 12 chairs
    expect(multiplyCentavos(15000, 0)).toBe(0);
  });

  it("rejects fractional or negative quantities", () => {
    expect(() => multiplyCentavos(15000, 1.5)).toThrow(MoneyError);
    expect(() => multiplyCentavos(15000, -1)).toThrow(MoneyError);
  });
});

describe("percentOfCentavos", () => {
  it("computes clean percentages exactly", () => {
    expect(percentOfCentavos(100000, 50)).toBe(50000); // 50% of ₱1,000
    expect(percentOfCentavos(100000, 12.5)).toBe(12500);
    expect(percentOfCentavos(100000, 0)).toBe(0);
    expect(percentOfCentavos(0, 50)).toBe(0);
  });

  it("rounds half-up to the nearest centavo", () => {
    // 50% of ₱10.01 = ₱5.005 → ₱5.01
    expect(percentOfCentavos(1001, 50)).toBe(501);
    // 33% of ₱10.00 = ₱3.30
    expect(percentOfCentavos(1000, 33)).toBe(330);
  });
});

describe("the 50% confirmation gate (Spec 4.4)", () => {
  const total = 1000000; // ₱10,000

  it("requires half the total by default", () => {
    expect(downpaymentRequired(total, 50)).toBe(500000);
  });

  it("blocks confirmation below the threshold", () => {
    expect(meetsDownpayment(total, 499999, 50)).toBe(false);
  });

  it("allows confirmation exactly at the threshold", () => {
    // Boundary case: exactly 50% must pass, not fail.
    expect(meetsDownpayment(total, 500000, 50)).toBe(true);
  });

  it("allows confirmation above the threshold", () => {
    expect(meetsDownpayment(total, 750000, 50)).toBe(true);
    expect(meetsDownpayment(total, total, 50)).toBe(true);
  });

  it("honours a custom downpayment percentage", () => {
    expect(meetsDownpayment(total, 300000, 30)).toBe(true);
    expect(meetsDownpayment(total, 299999, 30)).toBe(false);
  });

  it("treats a zero-percent requirement as always met", () => {
    expect(meetsDownpayment(total, 0, 0)).toBe(true);
  });

  it("rounds the requirement up before comparing", () => {
    // 50% of ₱10.01 is ₱5.005 → ₱5.01 required, so ₱5.00 is short.
    expect(meetsDownpayment(1001, 500, 50)).toBe(false);
    expect(meetsDownpayment(1001, 501, 50)).toBe(true);
  });
});

describe("balanceDue", () => {
  it("reconciles total against verified payments (Spec 8)", () => {
    const total = 1234567;
    const paid = 500000;
    expect(balanceDue(total, paid)).toBe(734567);
    // The invariant every booking must satisfy.
    expect(paid + balanceDue(total, paid)).toBe(total);
  });

  it("goes negative on overpayment rather than clamping", () => {
    // Surfacing an overpayment is more useful than hiding it at zero.
    expect(balanceDue(100000, 120000)).toBe(-20000);
  });
});
