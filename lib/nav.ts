import { canAny, type Permission, type Principal } from "@/lib/auth/permissions";

/**
 * Navigation model.
 *
 * Each link declares the permission that reveals it, so the nav a user
 * sees always matches what the server will let them open — hiding a
 * page somebody could still reach by typing the URL would be a lie,
 * and showing one they cannot open is worse.
 *
 * Links are gathered into collapsible groups because a flat list of
 * thirteen destinations is unreadable on a phone and not much better
 * on a laptop. Dashboard and Settings stay at the top level: the first
 * is where everyone lands, and the second already carries its own
 * sub-sections.
 */

export type NavChild = {
  href: string;
  label: string;
  /** Shown as the sub-page's own subtitle. */
  description?: string;
};

export type NavLink = {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel?: string;
  icon: IconName;
  /** Shown when the user holds ANY of these permissions. */
  permissions: readonly Permission[];
  /** Surfaced in the phone bottom bar (kept to four or fewer). */
  primary?: boolean;
  /** Sub-links, rendered as an expandable list under the parent. */
  children?: readonly NavChild[];
};

export type NavGroup = {
  /** Stable key — also what the collapsed state is remembered under. */
  id: string;
  label: string;
  icon: IconName;
  items: readonly NavLink[];
};

export type NavEntry =
  | { kind: "link"; link: NavLink }
  | { kind: "group"; group: NavGroup };

/**
 * Settings is seven distinct screens (Spec 4.12), which is far more
 * than one page should scroll. This list is the single source for the
 * sidebar sub-links, each section's heading, and where `/settings`
 * redirects to.
 */
export const SETTINGS_SECTIONS: readonly NavChild[] = [
  {
    href: "/settings/business",
    label: "Business Profile",
    description:
      "Name, address, contact numbers, TIN, and logo — these appear on every quotation, agreement, and report.",
  },
  {
    href: "/settings/payments",
    label: "Payment Channels",
    description:
      "The GCash, Maya, and bank accounts customers may send money to.",
  },
  {
    href: "/settings/delivery",
    label: "Delivery Fees",
    description:
      "Your free-delivery area and the suggested fees for everywhere else.",
  },
  {
    href: "/settings/defaults",
    label: "Booking Defaults",
    description:
      "Downpayment percentage and quotation validity applied to new records.",
  },
  {
    href: "/settings/agreement",
    label: "Agreement Template",
    description: "The clauses printed on every rental agreement.",
  },
  {
    href: "/settings/expenses",
    label: "Expense Categories",
    description:
      "How expenses are grouped for the bookkeeper's BIR filing report.",
  },
  {
    href: "/settings/users",
    label: "Users & Roles",
    description: "Staff accounts and what each person may do.",
  },
];

export type IconName =
  | "dashboard"
  | "calendar"
  | "bookings"
  | "quotations"
  | "customers"
  | "catalog"
  | "packages"
  | "suppliers"
  | "orders"
  | "payments"
  | "expenses"
  | "reports"
  | "users"
  | "settings";

export const NAV_STRUCTURE: readonly NavEntry[] = [
  {
    kind: "link",
    link: {
      href: "/dashboard",
      label: "Dashboard",
      shortLabel: "Home",
      icon: "dashboard",
      permissions: ["bookings.view", "calendar.view", "reports.financial.view"],
      primary: true,
    },
  },

  {
    kind: "group",
    group: {
      id: "sales",
      label: "Sales & Bookings",
      icon: "bookings",
      items: [
        {
          href: "/bookings",
          label: "Bookings",
          icon: "bookings",
          permissions: ["bookings.view"],
          primary: true,
        },
        {
          href: "/calendar",
          label: "Calendar",
          icon: "calendar",
          // The whole team's source of truth for the day (Spec 4.10) —
          // this is what replaced the Messenger announcements.
          permissions: ["calendar.view"],
          primary: true,
        },
        {
          href: "/quotations",
          label: "Quotations",
          shortLabel: "Quotes",
          icon: "quotations",
          // The Bookkeeper holds this too, read-only, for the
          // receivables picture; Delivery Staff never see prices.
          permissions: ["quotations.view"],
        },
        {
          href: "/orders",
          label: "Quick Sales",
          shortLabel: "Sales",
          icon: "orders",
          permissions: ["orders.manage", "reports.financial.view"],
        },
        {
          href: "/payments",
          label: "Payments",
          icon: "payments",
          permissions: ["payments.record", "reports.financial.view"],
        },
      ],
    },
  },

  {
    kind: "group",
    group: {
      id: "catalog",
      label: "Catalog & Assets",
      icon: "catalog",
      items: [
        {
          href: "/catalog",
          label: "Price Catalog",
          shortLabel: "Catalog",
          icon: "catalog",
          permissions: ["catalog.view"],
        },
        {
          href: "/packages",
          label: "Backdrop Packages",
          shortLabel: "Packages",
          icon: "packages",
          permissions: ["catalog.view"],
        },
        {
          href: "/assets",
          label: "Equipment",
          icon: "reports",
          permissions: ["catalog.view"],
        },
      ],
    },
  },

  {
    kind: "group",
    group: {
      id: "contacts",
      label: "Contacts",
      icon: "customers",
      items: [
        {
          href: "/customers",
          label: "Customers",
          icon: "customers",
          permissions: ["customers.view"],
        },
        {
          href: "/suppliers",
          label: "Suppliers",
          icon: "suppliers",
          permissions: ["suppliers.view"],
        },
      ],
    },
  },

  {
    kind: "group",
    group: {
      id: "finance",
      label: "Finance",
      icon: "expenses",
      items: [
        {
          href: "/expenses",
          label: "Expenses",
          icon: "expenses",
          // The Bookkeeper categorises them for the BIR filing report;
          // the Owner records and pays them (Spec 3).
          permissions: ["expenses.manage", "expenses.categorize"],
        },
        // Reports joins this group in Milestone 8.
      ],
    },
  },

  {
    kind: "link",
    link: {
      href: "/settings",
      label: "Settings",
      shortLabel: "Settings",
      icon: "settings",
      // Owner-only; every sub-page still calls requireOwner server-side.
      permissions: ["settings.manage"],
      primary: true,
      children: SETTINGS_SECTIONS,
    },
  },
];

/**
 * The nav this user should actually see.
 *
 * A group whose every link is hidden disappears entirely rather than
 * leaving a heading that expands into nothing — which is how Delivery
 * Staff end up with just Dashboard, Bookings, and Calendar.
 */
export function visibleNav(
  principal: Principal,
  structure: readonly NavEntry[] = NAV_STRUCTURE,
): NavEntry[] {
  const visible: NavEntry[] = [];

  for (const entry of structure) {
    if (entry.kind === "link") {
      if (canAny(principal, entry.link.permissions)) visible.push(entry);
      continue;
    }

    const items = entry.group.items.filter((item) =>
      canAny(principal, item.permissions),
    );

    if (items.length > 0) {
      visible.push({ kind: "group", group: { ...entry.group, items } });
    }
  }

  return visible;
}

/** Every link in the structure, flattened — used by the bottom bar. */
export function flattenNav(structure: readonly NavEntry[]): NavLink[] {
  return structure.flatMap((entry) =>
    entry.kind === "link" ? [entry.link] : [...entry.group.items],
  );
}

/** True when the path is this link's page, or one nested beneath it. */
export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The group holding the current page, so it can be opened on arrival.
 * Null when the page is a top-level link, or nothing matches.
 */
export function activeGroupId(
  structure: readonly NavEntry[],
  pathname: string,
): string | null {
  for (const entry of structure) {
    if (entry.kind !== "group") continue;
    const hit = entry.group.items.some((item) =>
      isActiveHref(pathname, item.href),
    );
    if (hit) return entry.group.id;
  }
  return null;
}
