import type { Permission } from "@/lib/auth/permissions";

/**
 * Navigation model. Each item declares the permission that reveals it,
 * so the nav a user sees always matches what the server will let them
 * do. Later milestones add entries here; nothing else needs to change.
 */
export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel?: string;
  icon: IconName;
  /** Item is shown when the user holds ANY of these permissions. */
  permissions: readonly Permission[];
  /** Surfaced in the phone bottom bar (kept to four or fewer). */
  primary?: boolean;
  /** Sub-links, rendered as an expandable group under the parent. */
  children?: readonly NavChild[];
};

export type NavChild = {
  href: string;
  label: string;
  /** Shown as the sub-page's own subtitle. */
  description?: string;
};

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

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: "dashboard",
    permissions: ["bookings.view", "calendar.view", "reports.financial.view"],
    primary: true,
  },
  {
    href: "/customers",
    label: "Customers",
    icon: "customers",
    permissions: ["customers.view"],
    primary: true,
  },
  {
    href: "/quotations",
    label: "Quotations",
    shortLabel: "Quotes",
    icon: "quotations",
    // The Bookkeeper holds this too, read-only, for the receivables
    // picture; Delivery Staff never see prices (Spec 3).
    permissions: ["quotations.view"],
  },
  {
    href: "/catalog",
    label: "Price Catalog",
    shortLabel: "Catalog",
    icon: "catalog",
    permissions: ["catalog.view"],
    primary: true,
  },
  {
    href: "/packages",
    label: "Backdrop Packages",
    shortLabel: "Packages",
    icon: "packages",
    permissions: ["catalog.view"],
  },
  {
    href: "/suppliers",
    label: "Suppliers",
    icon: "suppliers",
    permissions: ["suppliers.view"],
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: "settings",
    // Owner-only, exactly as before the split — every sub-page still
    // calls requireOwner on the server.
    permissions: ["settings.manage"],
    primary: true,
    children: SETTINGS_SECTIONS,
  },
];
