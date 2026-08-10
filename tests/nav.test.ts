import { describe, expect, it } from "vitest";

import type { Principal } from "@/lib/auth/permissions";
import {
  activeGroupId,
  flattenNav,
  isActiveHref,
  NAV_STRUCTURE,
  visibleNav,
  type NavEntry,
} from "@/lib/nav";
import type { UserRole } from "@/lib/supabase/database.types";

function principal(role: UserRole, catalogManager = false): Principal {
  return { role, catalog_manager: catalogManager, is_active: true };
}

/** Flattened labels, which is what somebody actually sees down the side. */
function labels(entries: NavEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "link"
      ? [entry.link.label]
      : [entry.group.label, ...entry.group.items.map((item) => item.label)],
  );
}

function groupIds(entries: NavEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === "group")
    .map((entry) => (entry.kind === "group" ? entry.group.id : ""));
}

describe("nav structure", () => {
  it("keeps Dashboard and Settings out of the groups", () => {
    const topLevel = NAV_STRUCTURE.filter((entry) => entry.kind === "link");
    expect(
      topLevel.map((entry) => (entry.kind === "link" ? entry.link.href : "")),
    ).toEqual(["/dashboard", "/settings"]);
  });

  it("groups every other destination", () => {
    // A link that belongs to no group would simply never render.
    const grouped = flattenNav(NAV_STRUCTURE).map((link) => link.href);
    expect(grouped).toContain("/bookings");
    expect(grouped).toContain("/calendar");
    expect(grouped).toContain("/quotations");
    expect(grouped).toContain("/orders");
    expect(grouped).toContain("/payments");
    expect(grouped).toContain("/catalog");
    expect(grouped).toContain("/packages");
    expect(grouped).toContain("/assets");
    expect(grouped).toContain("/customers");
    expect(grouped).toContain("/suppliers");
    expect(grouped).toContain("/expenses");
  });

  it("keeps the bottom bar to four", () => {
    const primary = flattenNav(NAV_STRUCTURE).filter((link) => link.primary);
    expect(primary.length).toBeLessThanOrEqual(4);
  });

  it("gives every group a unique id to remember its state under", () => {
    const ids = groupIds([...NAV_STRUCTURE]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("visibleNav", () => {
  it("shows the owner everything", () => {
    const entries = visibleNav(principal("owner"));
    expect(groupIds(entries)).toEqual([
      "sales",
      "catalog",
      "contacts",
      "finance",
    ]);
    expect(labels(entries)).toContain("Settings");
  });

  it("gives delivery staff only Dashboard, Bookings, and Calendar", () => {
    // The driver's whole job is the calendar and the booking in front
    // of them; prices, spending, and the catalog are none of it.
    const entries = visibleNav(principal("delivery_staff"));

    expect(labels(entries)).toEqual([
      "Dashboard",
      "Sales & Bookings",
      "Bookings",
      "Calendar",
    ]);
  });

  it("drops a group whose every link is hidden", () => {
    // Not an empty heading that expands into nothing.
    const entries = visibleNav(principal("delivery_staff"));
    expect(groupIds(entries)).toEqual(["sales"]);
    expect(labels(entries)).not.toContain("Catalog & Assets");
    expect(labels(entries)).not.toContain("Finance");
  });

  it("hides settings from everyone but the owner", () => {
    for (const role of ["booking_staff", "delivery_staff", "bookkeeper"] as const) {
      expect(labels(visibleNav(principal(role)))).not.toContain("Settings");
    }
  });

  it("shows booking staff the sales floor but not the books", () => {
    const shown = labels(visibleNav(principal("booking_staff")));

    expect(shown).toContain("Quotations");
    expect(shown).toContain("Quick Sales");
    expect(shown).toContain("Customers");
    expect(shown).toContain("Price Catalog");
    // Expenses are the owner's and the bookkeeper's (Spec 3).
    expect(shown).not.toContain("Expenses");
  });

  it("shows the bookkeeper the money without the operations", () => {
    const shown = labels(visibleNav(principal("bookkeeper")));

    expect(shown).toContain("Expenses");
    expect(shown).toContain("Payments");
    expect(shown).toContain("Quotations");
    expect(shown).toContain("Suppliers");
  });

  it("shows nothing at all to a deactivated account", () => {
    const entries = visibleNav({
      role: "owner",
      catalog_manager: false,
      is_active: false,
    });
    expect(entries).toEqual([]);
  });
});

describe("isActiveHref", () => {
  it("matches the page and anything nested beneath it", () => {
    expect(isActiveHref("/bookings", "/bookings")).toBe(true);
    expect(isActiveHref("/bookings/abc/edit", "/bookings")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // /orders must not light up while you are on /orders-archive.
    expect(isActiveHref("/orders-archive", "/orders")).toBe(false);
  });
});

describe("activeGroupId", () => {
  const owner = visibleNav(principal("owner"));

  it("finds the group holding the current page", () => {
    expect(activeGroupId(owner, "/quotations")).toBe("sales");
    expect(activeGroupId(owner, "/assets")).toBe("catalog");
    expect(activeGroupId(owner, "/suppliers/123")).toBe("contacts");
    expect(activeGroupId(owner, "/expenses")).toBe("finance");
  });

  it("is null on a top-level page", () => {
    // Dashboard and Settings belong to no group, so nothing auto-opens.
    expect(activeGroupId(owner, "/dashboard")).toBeNull();
    expect(activeGroupId(owner, "/settings/payments")).toBeNull();
  });

  it("is null for a page that is not in the nav at all", () => {
    expect(activeGroupId(owner, "/nowhere")).toBeNull();
  });
});
