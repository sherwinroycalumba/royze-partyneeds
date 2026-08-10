import { describe, expect, it } from "vitest";

import { can, canAny, type Principal } from "@/lib/auth/permissions";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    role: "booking_staff",
    catalog_manager: false,
    is_active: true,
    ...overrides,
  };
}

describe("owner", () => {
  const owner = principal({ role: "owner" });

  it("holds every owner-only permission (Spec 3)", () => {
    expect(can(owner, "users.manage")).toBe(true);
    expect(can(owner, "payments.verify")).toBe(true);
    expect(can(owner, "reports.financial.view")).toBe(true);
    expect(can(owner, "expenses.manage")).toBe(true);
    expect(can(owner, "records.delete")).toBe(true);
    expect(can(owner, "settings.manage")).toBe(true);
  });

  it("can manage the catalog without the flag", () => {
    expect(can(owner, "catalog.manage")).toBe(true);
  });
});

describe("booking staff", () => {
  it("records payments but cannot verify them", () => {
    const staff = principal();
    // The core of the payment verification workflow (Spec 4.7).
    expect(can(staff, "payments.record")).toBe(true);
    expect(can(staff, "payments.verify")).toBe(false);
  });

  it("cannot reach owner-only surfaces", () => {
    const staff = principal();
    expect(can(staff, "users.manage")).toBe(false);
    expect(can(staff, "settings.manage")).toBe(false);
    expect(can(staff, "reports.financial.view")).toBe(false);
    expect(can(staff, "records.delete")).toBe(false);
  });

  it("manages the catalog only when granted the flag (Spec 3)", () => {
    expect(can(principal({ catalog_manager: false }), "catalog.manage")).toBe(
      false,
    );
    expect(can(principal({ catalog_manager: true }), "catalog.manage")).toBe(
      true,
    );
  });

  it("can always view the catalog", () => {
    expect(can(principal(), "catalog.view")).toBe(true);
  });
});

describe("delivery staff", () => {
  const driver = principal({ role: "delivery_staff" });

  it("updates delivery status and reads the calendar", () => {
    expect(can(driver, "delivery.update")).toBe(true);
    expect(can(driver, "calendar.view")).toBe(true);
    expect(can(driver, "bookings.view")).toBe(true);
  });

  it("is read-only on bookings themselves", () => {
    expect(can(driver, "bookings.manage")).toBe(false);
    expect(can(driver, "quotations.manage")).toBe(false);
    expect(can(driver, "payments.record")).toBe(false);
  });

  it("never gets catalog write access, even with the flag set", () => {
    // The flag is meaningful only for booking staff.
    const flagged = principal({ role: "delivery_staff", catalog_manager: true });
    expect(can(flagged, "catalog.manage")).toBe(false);
  });
});

describe("bookkeeper", () => {
  const bookkeeper = principal({ role: "bookkeeper" });

  it("reads financials and exports reports", () => {
    expect(can(bookkeeper, "reports.financial.view")).toBe(true);
    expect(can(bookkeeper, "reports.export")).toBe(true);
    expect(can(bookkeeper, "expenses.categorize")).toBe(true);
  });

  it("is read-only: cannot verify payments or edit bookings", () => {
    expect(can(bookkeeper, "payments.verify")).toBe(false);
    expect(can(bookkeeper, "payments.record")).toBe(false);
    expect(can(bookkeeper, "bookings.manage")).toBe(false);
    expect(can(bookkeeper, "expenses.manage")).toBe(false);
  });
});

describe("deactivated accounts", () => {
  it("lose every permission regardless of role (Spec 3)", () => {
    const deactivatedOwner = principal({ role: "owner", is_active: false });
    expect(can(deactivatedOwner, "users.manage")).toBe(false);
    expect(can(deactivatedOwner, "calendar.view")).toBe(false);
    expect(can(deactivatedOwner, "catalog.view")).toBe(false);
  });

  it("lose the catalog_manager grant too", () => {
    const deactivated = principal({ catalog_manager: true, is_active: false });
    expect(can(deactivated, "catalog.manage")).toBe(false);
  });
});

describe("canAny", () => {
  it("is true when the principal holds at least one permission", () => {
    const driver = principal({ role: "delivery_staff" });
    expect(canAny(driver, ["users.manage", "calendar.view"])).toBe(true);
  });

  it("is false when it holds none", () => {
    const driver = principal({ role: "delivery_staff" });
    expect(canAny(driver, ["users.manage", "settings.manage"])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(canAny(principal(), [])).toBe(false);
  });
});
