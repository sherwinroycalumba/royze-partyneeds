import type { Profile, UserRole } from "@/lib/supabase/database.types";

/**
 * The single source of truth for what each role may do (Spec 3).
 *
 * This module is intentionally dependency-free so it can be unit
 * tested and reused by both the server guards and the nav rendering.
 */
export type Permission =
  // Owner-only (Spec 3)
  | "users.manage"
  | "payments.verify"
  | "reports.financial.view"
  | "expenses.manage"
  | "records.delete"
  | "settings.manage"
  | "audit.view"
  // Catalog
  | "catalog.view"
  | "catalog.manage"
  // Operations
  | "customers.view"
  | "customers.manage"
  | "suppliers.view"
  | "suppliers.manage"
  | "bookings.manage"
  | "bookings.view"
  | "quotations.view"
  | "quotations.manage"
  | "orders.manage"
  | "payments.record"
  | "delivery.update"
  | "calendar.view"
  // Finance / reporting
  | "expenses.categorize"
  | "reports.export";

const OWNER: Permission[] = [
  "users.manage",
  "payments.verify",
  "reports.financial.view",
  "expenses.manage",
  "records.delete",
  "settings.manage",
  "audit.view",
  "catalog.view",
  "catalog.manage",
  "customers.view",
  "customers.manage",
  "suppliers.view",
  "suppliers.manage",
  "bookings.manage",
  "bookings.view",
  "quotations.view",
  "quotations.manage",
  "orders.manage",
  "payments.record",
  "delivery.update",
  "calendar.view",
  "expenses.categorize",
  "reports.export",
];

const BOOKING_STAFF: Permission[] = [
  "catalog.view",
  "customers.view",
  "customers.manage",
  // Reads the supplier directory when recording where a restock came
  // from; only the Owner edits it (Spec 4.8).
  "suppliers.view",
  "bookings.manage",
  "bookings.view",
  "quotations.view",
  "quotations.manage",
  "orders.manage",
  // Records payments, but they land as Pending Verification —
  // only the Owner holds "payments.verify" (Spec 4.7).
  "payments.record",
  "calendar.view",
  "delivery.update",
];

const DELIVERY_STAFF: Permission[] = [
  // Read-only on bookings; the only mutation is delivery status and
  // item condition on return (Spec 3).
  "bookings.view",
  "calendar.view",
  "delivery.update",
  "catalog.view",
];

const BOOKKEEPER: Permission[] = [
  // Read-only across financial data, plus expense categorization and
  // report export for BIR filing (Spec 3).
  "reports.financial.view",
  "reports.export",
  "expenses.categorize",
  "bookings.view",
  // Reads quotations for the receivables picture, but never writes
  // them — the Bookkeeper's access is read-only throughout (Spec 3).
  "quotations.view",
  "calendar.view",
  "catalog.view",
  // Needed for the customer and expense reports (Spec 4.11).
  "customers.view",
  "suppliers.view",
  "audit.view",
];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: OWNER,
  booking_staff: BOOKING_STAFF,
  delivery_staff: DELIVERY_STAFF,
  bookkeeper: BOOKKEEPER,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  booking_staff: "Booking Staff",
  delivery_staff: "Delivery Staff",
  bookkeeper: "Bookkeeper",
};

export const ALL_ROLES: UserRole[] = [
  "owner",
  "booking_staff",
  "delivery_staff",
  "bookkeeper",
];

/** The subject of a permission check — just the fields that matter. */
export type Principal = Pick<
  Profile,
  "role" | "catalog_manager" | "is_active"
>;

export function can(principal: Principal, permission: Permission): boolean {
  // A deactivated account can do nothing, whatever its role.
  if (!principal.is_active) return false;

  // Booking Staff manage the catalog only when granted the flag (Spec 3).
  if (
    permission === "catalog.manage" &&
    principal.role === "booking_staff" &&
    principal.catalog_manager
  ) {
    return true;
  }

  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

export function canAny(
  principal: Principal,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(principal, permission));
}
