import { describe, expect, it } from "vitest";

import {
  daysBetweenDates,
  receivableBucket,
  totalOutstanding,
  totalsByBucket,
} from "@/lib/reports/aging";
import {
  escapeCsvValue,
  formatCsvCell,
  reportFilename,
  reportToCsv,
  sectionToCsv,
} from "@/lib/reports/csv";
import {
  addMix,
  allocateProportionally,
  documentRevenueMix,
  emptyMix,
  mixTotal,
  recogniseRevenue,
  type RevenueLine,
} from "@/lib/reports/revenue";
import { isReportKind, REPORT_KINDS, type Report } from "@/lib/reports/types";

// ── Splitting money without losing any ────────────────────────
describe("allocateProportionally", () => {
  it("splits in proportion to the weights", () => {
    expect(allocateProportionally(100_000, [1, 1])).toEqual([50_000, 50_000]);
    expect(allocateProportionally(100_000, [3, 1])).toEqual([75_000, 25_000]);
  });

  it("always sums to exactly the amount, however it divides", () => {
    // A third of a centavo cannot exist, so the leftovers have to land
    // somewhere — a P&L whose lines do not add up to the cash received
    // is worse than no P&L at all.
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("gives the leftovers to the shares cut hardest", () => {
    const parts = allocateProportionally(10, [1, 2, 4]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10);
  });

  it("is all zeroes when there is nothing to split or nothing to split it by", () => {
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportionally(500, [0, 0])).toEqual([0, 0]);
  });

  it("handles a single weight", () => {
    expect(allocateProportionally(12_345, [7])).toEqual([12_345]);
  });
});

// ── The revenue mix of a document ─────────────────────────────
function lines(): RevenueLine[] {
  return [
    { source: "rental", amount_centavos: 600_000 },
    { source: "package", amount_centavos: 300_000 },
    { source: "delivery", amount_centavos: 100_000 },
  ];
}

describe("documentRevenueMix", () => {
  it("buckets each line by what it was selling", () => {
    const mix = documentRevenueMix(lines(), 0);

    expect(mix.rental).toBe(600_000);
    expect(mix.package).toBe(300_000);
    expect(mix.delivery).toBe(100_000);
    expect(mixTotal(mix)).toBe(1_000_000);
  });

  it("takes the whole-document discount off proportionally", () => {
    // A discount is not "off the delivery fee" — it reduces what the
    // customer pays for everything.
    const mix = documentRevenueMix(lines(), 100_000);

    expect(mixTotal(mix)).toBe(900_000);
    expect(mix.rental).toBe(540_000);
    expect(mix.package).toBe(270_000);
    expect(mix.delivery).toBe(90_000);
  });

  it("never discounts below zero", () => {
    const mix = documentRevenueMix(lines(), 99_999_999);
    expect(mixTotal(mix)).toBe(0);
  });

  it("adds two mixes together", () => {
    const total = addMix(documentRevenueMix(lines(), 0), emptyMix());
    expect(total.rental).toBe(600_000);
  });
});

describe("recogniseRevenue", () => {
  const mix = documentRevenueMix(lines(), 0); // ₱10,000.00 total

  it("recognises nothing until something is verified", () => {
    expect(mixTotal(recogniseRevenue(0, mix))).toBe(0);
  });

  it("recognises a part payment across every source proportionally", () => {
    // Half paid is half of each source — the customer did not pay
    // "for the chairs first".
    const recognised = recogniseRevenue(500_000, mix);

    expect(mixTotal(recognised)).toBe(500_000);
    expect(recognised.rental).toBe(300_000);
    expect(recognised.package).toBe(150_000);
    expect(recognised.delivery).toBe(50_000);
  });

  it("recognises the whole document once it is fully paid", () => {
    expect(recogniseRevenue(1_000_000, mix)).toEqual({
      rental: 600_000,
      sale: 0,
      package: 300_000,
      damage: 0,
      delivery: 100_000,
    });
  });

  it("treats an overpayment as a credit, not income", () => {
    // The business has the money, but it did not earn more than it
    // billed.
    const recognised = recogniseRevenue(1_500_000, mix);
    expect(mixTotal(recognised)).toBe(1_000_000);
  });

  it("recognises nothing against a document worth nothing", () => {
    expect(mixTotal(recogniseRevenue(50_000, emptyMix()))).toBe(0);
  });
});

// ── Receivables aging ─────────────────────────────────────────
describe("receivableBucket", () => {
  it("buckets by how long the money has been owed", () => {
    expect(receivableBucket("2026-08-30", "2026-08-30")).toBe("0–7 days");
    expect(receivableBucket("2026-08-23", "2026-08-30")).toBe("0–7 days");
    expect(receivableBucket("2026-08-22", "2026-08-30")).toBe("8–30 days");
    expect(receivableBucket("2026-07-31", "2026-08-30")).toBe("8–30 days");
    expect(receivableBucket("2026-07-30", "2026-08-30")).toBe("31+ days");
  });

  it("puts a balance that is not due yet in the first bucket", () => {
    // Rather than inventing a "future" column nobody asked for.
    expect(receivableBucket("2026-09-30", "2026-08-30")).toBe("0–7 days");
  });

  it("counts whole days between dates", () => {
    expect(daysBetweenDates("2026-08-01", "2026-08-31")).toBe(30);
    expect(daysBetweenDates("2026-08-31", "2026-08-01")).toBe(-30);
  });
});

describe("totalsByBucket", () => {
  it("totals each bucket and keeps them in order", () => {
    const totals = totalsByBucket([
      { balance_centavos: 100_000, bucket: "0–7 days" },
      { balance_centavos: 50_000, bucket: "31+ days" },
      { balance_centavos: 25_000, bucket: "0–7 days" },
    ]);

    expect(totals).toEqual({
      "0–7 days": 125_000,
      "8–30 days": 0,
      "31+ days": 50_000,
    });
    expect(
      totalOutstanding([
        { balance_centavos: 100_000, bucket: "0–7 days" },
        { balance_centavos: 50_000, bucket: "31+ days" },
      ]),
    ).toBe(150_000);
  });
});

// ── CSV export ────────────────────────────────────────────────
describe("escapeCsvValue", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvValue("Maria Santos")).toBe("Maria Santos");
  });

  it("quotes anything containing a comma, quote, or newline", () => {
    expect(escapeCsvValue("Santos, Maria")).toBe('"Santos, Maria"');
    expect(escapeCsvValue('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvValue("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises anything a spreadsheet would run as a formula", () => {
    // A payee named =cmd|... is a real attack on whoever opens the
    // file, and one apostrophe prevents it.
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvValue("-2")).toBe("'-2");
    expect(escapeCsvValue("@import")).toBe("'@import");
  });

  it("puts the guard inside the quotes, not outside", () => {
    expect(escapeCsvValue("=a,b")).toBe(`"'=a,b"`);
  });
});

describe("formatCsvCell", () => {
  const money = { key: "total", label: "Total", type: "money" as const };

  it("writes money as a plain decimal a spreadsheet can add up", () => {
    // Not ₱1,234.56 — a peso sign and thousands separators turn the
    // column into text.
    expect(formatCsvCell(123_456, money)).toBe("1234.56");
  });

  it("writes an empty cell for a missing value", () => {
    expect(formatCsvCell(null, money)).toBe("");
  });

  it("passes text through untouched", () => {
    expect(formatCsvCell("Cash", { key: "m", label: "Method" })).toBe("Cash");
  });
});

describe("reportToCsv", () => {
  const report: Report = {
    kind: "daily-sales",
    title: "Daily Sales",
    subtitle: "Verified payments by day",
    range: { from: "2026-08-01", to: "2026-08-31" },
    highlights: [{ label: "Total collected", value: 250_000, money: true }],
    sections: [
      {
        title: "By day",
        columns: [
          { key: "day", label: "Day", type: "date" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: [
          { day: "2026-08-10", amount: 150_000 },
          { day: "2026-08-11", amount: 100_000 },
        ],
        totals: { day: "Total", amount: 250_000 },
      },
    ],
  };

  it("leads with what the report is and what it covers", () => {
    // A report that does not say its own date range is useless a week
    // later.
    const csv = reportToCsv(report);
    expect(csv.startsWith("Daily Sales\r\n2026-08-01 to 2026-08-31")).toBe(true);
  });

  it("writes the highlights, then each section with a header row", () => {
    const csv = reportToCsv(report);
    expect(csv).toContain("Total collected,2500.00");
    expect(csv).toContain("Day,Amount");
    expect(csv).toContain("2026-08-10,1500.00");
    expect(csv).toContain("Total,2500.00");
  });

  it("uses CRLF, which is what the format says and Excel expects", () => {
    expect(reportToCsv(report)).toContain("\r\n");
  });

  it("renders a section on its own", () => {
    const lines = sectionToCsv(report.sections[0]);
    expect(lines[0]).toBe("By day");
    expect(lines[1]).toBe("Day,Amount");
    expect(lines).toHaveLength(5); // title, header, 2 rows, totals
  });
});

describe("reportFilename", () => {
  it("names the file after the report and its range", () => {
    expect(
      reportFilename(
        { kind: "receivables", range: { from: "2026-08-01", to: "2026-08-31" } },
        "csv",
      ),
    ).toBe("receivables-2026-08-01-to-2026-08-31.csv");
  });
});

describe("report kinds", () => {
  it("covers the eight reports the spec lists", () => {
    expect(REPORT_KINDS).toHaveLength(8);
  });

  it("recognises its own kinds", () => {
    expect(isReportKind("profit-and-loss")).toBe(true);
    expect(isReportKind("balance-sheet")).toBe(false);
  });
});
