import { describe, expect, it } from "vitest";

import {
  actionLabel,
  countByDomain,
  domainOf,
  isAuditDomain,
  isNotable,
  matchesAuditFilter,
} from "@/lib/audit-log";

describe("domainOf", () => {
  it("reads the domain off the front of the action", () => {
    expect(domainOf("booking.create")).toBe("booking");
    expect(domainOf("catalog.item.stock_adjust")).toBe("catalog");
    expect(domainOf("settings.payment_accounts.update")).toBe("settings");
  });

  it("returns null for anything it does not recognise", () => {
    // Better an honest "Other" bucket than forcing a row somewhere it
    // does not belong.
    expect(domainOf("something.else")).toBeNull();
    expect(domainOf("")).toBeNull();
  });

  it("recognises its own domains", () => {
    expect(isAuditDomain("payment")).toBe(true);
    expect(isAuditDomain("invoice")).toBe(false);
  });
});

describe("isNotable", () => {
  it("flags the actions that move money or override a rule", () => {
    expect(isNotable("booking.availability_override")).toBe(true);
    expect(isNotable("booking.delivery_fee_override")).toBe(true);
    expect(isNotable("order.void")).toBe(true);
    expect(isNotable("payment.rejected")).toBe(true);
    expect(isNotable("booking.cancelled")).toBe(true);
    expect(isNotable("catalog.item.archive")).toBe(true);
    expect(isNotable("asset.written_off_from_damaged")).toBe(true);
    expect(isNotable("order.stock_discrepancy")).toBe(true);
    expect(isNotable("user.password_reset")).toBe(true);
    expect(isNotable("catalog.item.stock_adjust")).toBe(true);
  });

  it("leaves the ordinary run of business alone", () => {
    // Otherwise everything is flagged and nothing is.
    expect(isNotable("booking.create")).toBe(false);
    expect(isNotable("quotation.sent")).toBe(false);
    expect(isNotable("payment.record")).toBe(false);
    expect(isNotable("payment.verified")).toBe(false);
    expect(isNotable("expense.categorise")).toBe(false);
  });
});

describe("actionLabel", () => {
  it("turns the action into a short readable badge", () => {
    expect(actionLabel("booking.availability_override")).toBe(
      "Availability override",
    );
    expect(actionLabel("catalog.item.stock_adjust")).toBe("Item stock adjust");
    expect(actionLabel("payment.verified")).toBe("Verified");
  });

  it("falls back to the whole action when there is no dot", () => {
    expect(actionLabel("migrated")).toBe("Migrated");
  });
});

describe("matchesAuditFilter", () => {
  const entries = [
    { action: "booking.create" },
    { action: "booking.availability_override" },
    { action: "payment.verified" },
    { action: "order.void" },
  ];

  it("passes everything through when nothing is narrowed", () => {
    expect(
      entries.filter((entry) =>
        matchesAuditFilter(entry, { domain: "all", notableOnly: false }),
      ),
    ).toHaveLength(4);
  });

  it("narrows to one domain", () => {
    const shown = entries.filter((entry) =>
      matchesAuditFilter(entry, { domain: "booking", notableOnly: false }),
    );
    expect(shown.map((entry) => entry.action)).toEqual([
      "booking.create",
      "booking.availability_override",
    ]);
  });

  it("narrows to the notable ones", () => {
    const shown = entries.filter((entry) =>
      matchesAuditFilter(entry, { domain: "all", notableOnly: true }),
    );
    expect(shown.map((entry) => entry.action)).toEqual([
      "booking.availability_override",
      "order.void",
    ]);
  });

  it("applies both filters together", () => {
    const shown = entries.filter((entry) =>
      matchesAuditFilter(entry, { domain: "booking", notableOnly: true }),
    );
    expect(shown.map((entry) => entry.action)).toEqual([
      "booking.availability_override",
    ]);
  });
});

describe("countByDomain", () => {
  it("counts per domain, busiest first", () => {
    const counts = countByDomain([
      { action: "booking.create" },
      { action: "booking.update" },
      { action: "payment.record" },
    ]);

    expect(counts[0]).toEqual({
      domain: "booking",
      label: "Bookings",
      count: 2,
    });
    expect(counts[1].label).toBe("Payments");
  });

  it("gives unrecognised actions their own visible bucket", () => {
    const counts = countByDomain([{ action: "mystery.thing" }]);
    expect(counts[0]).toEqual({ domain: null, label: "Other", count: 1 });
  });
});
