/**
 * Reading the audit trail (Spec 5).
 *
 * Every write in the app appends an entry, which after a busy month is
 * thousands of rows of `booking.update`. What makes it useful is being
 * able to answer two questions quickly: *what happened in this part of
 * the business*, and *what happened that somebody should look at*.
 *
 * Pure, so both questions are answered the same way on the screen and
 * in any later export.
 */

export const AUDIT_DOMAINS = [
  "booking",
  "quotation",
  "agreement",
  "payment",
  "order",
  "expense",
  "asset",
  "catalog",
  "customer",
  "supplier",
  "user",
  "settings",
] as const;

export type AuditDomain = (typeof AUDIT_DOMAINS)[number];

export const AUDIT_DOMAIN_LABELS: Record<AuditDomain, string> = {
  booking: "Bookings",
  quotation: "Quotations",
  agreement: "Agreements",
  payment: "Payments",
  order: "Quick sales",
  expense: "Expenses",
  asset: "Equipment",
  catalog: "Catalog",
  customer: "Customers",
  supplier: "Suppliers",
  user: "Users",
  settings: "Settings",
};

export function isAuditDomain(value: string): value is AuditDomain {
  return (AUDIT_DOMAINS as readonly string[]).includes(value);
}

/**
 * The domain an action belongs to — the part before the first dot.
 * Anything unrecognised comes back as null rather than being forced
 * into a bucket it does not belong in.
 */
export function domainOf(action: string): AuditDomain | null {
  const prefix = action.split(".")[0];
  return isAuditDomain(prefix) ? prefix : null;
}

/**
 * Actions worth a second look.
 *
 * Not "suspicious" — every one of these is a legitimate thing to do.
 * They are the ones that move money, override a rule, or remove
 * something, so they are what an owner scans for when reconciling a
 * month or wondering why a number changed.
 */
const NOTABLE_FRAGMENTS = [
  "override",
  "void",
  "reject",
  "cancel",
  "archive",
  "delete",
  "written_off",
  "write_off",
  "discrepancy",
  "password_reset",
  "stock_adjust",
];

export function isNotable(action: string): boolean {
  const value = action.toLowerCase();
  return NOTABLE_FRAGMENTS.some((fragment) => value.includes(fragment));
}

/**
 * "booking.availability_override" → "Availability override".
 *
 * The summary already says what happened in a sentence, so this is
 * only a short label for the badge beside it.
 */
export function actionLabel(action: string): string {
  const rest = action.split(".").slice(1).join(" ") || action;
  const words = rest.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type AuditFilter = {
  domain: AuditDomain | "all";
  notableOnly: boolean;
};

export type AuditEntryLike = {
  action: string;
};

/** Applies the domain and notable-only filters together. */
export function matchesAuditFilter(
  entry: AuditEntryLike,
  filter: AuditFilter,
): boolean {
  if (filter.notableOnly && !isNotable(entry.action)) return false;
  if (filter.domain === "all") return true;
  return domainOf(entry.action) === filter.domain;
}

/** How many entries each domain accounts for, busiest first. */
export function countByDomain(
  entries: readonly AuditEntryLike[],
): { domain: AuditDomain | null; label: string; count: number }[] {
  const counts = new Map<AuditDomain | null, number>();

  for (const entry of entries) {
    const domain = domainOf(entry.action);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, count]) => ({
      domain,
      label: domain ? AUDIT_DOMAIN_LABELS[domain] : "Other",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
