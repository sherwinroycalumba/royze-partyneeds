import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import {
  AUDIT_DOMAINS,
  AUDIT_DOMAIN_LABELS,
  countByDomain,
  isAuditDomain,
  isNotable,
  matchesAuditFilter,
} from "@/lib/audit-log";
import { addCalendarDays, todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { AuditList, type AuditRow } from "./audit-list";

export const metadata: Metadata = { title: "Audit trail" };

const ROW_CAP = 500;

export default async function AuditPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{
    domain?: string;
    notable?: string;
    from?: string;
    to?: string;
  }>;
}) {
  // Owner and Bookkeeper (Spec 3).
  await requirePermission("audit.view");
  const {
    domain: rawDomain = "all",
    notable,
    from: rawFrom,
    to: rawTo,
  } = await searchParams;

  const today = todayInManila();
  // A month back by default: far enough to answer "why did this
  // change", short enough to stay readable.
  const from =
    rawFrom && isCalendarDate(rawFrom) ? rawFrom : addCalendarDays(today, -30);
  const to = rawTo && isCalendarDate(rawTo) ? rawTo : today;
  const notableOnly = notable === "true";
  const domain = isAuditDomain(rawDomain) ? rawDomain : "all";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_name, action, entity_type, summary, created_at")
    // `to` is a day, and rows carry an instant — take the whole of it.
    .gte("created_at", `${from}T00:00:00+08:00`)
    .lte("created_at", `${to}T23:59:59+08:00`)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);

  const all = (data ?? []) as AuditRow[];
  const rows = all.filter((entry) =>
    matchesAuditFilter(entry, { domain, notableOnly }),
  );

  const counts = countByDomain(all);
  const notableCount = all.filter((entry) => isNotable(entry.action)).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Audit trail
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Every change anyone made, in order. Append-only — nothing here can be
          edited or removed, including by the owner.
        </p>
      </header>

      <form
        action="/audit"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="min-w-44 sm:flex-1">
          <label htmlFor="audit-domain" className="sr-only">
            Area
          </label>
          <select
            id="audit-domain"
            name="domain"
            defaultValue={domain}
            className={inputClasses}
          >
            <option value="all">Everything</option>
            {AUDIT_DOMAINS.map((value) => (
              <option key={value} value={value}>
                {AUDIT_DOMAIN_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="min-w-36 flex-1">
            <label htmlFor="audit-from" className="sr-only">
              From
            </label>
            <input
              id="audit-from"
              name="from"
              type="date"
              defaultValue={from}
              className={inputClasses}
            />
          </div>

          <span className="text-sm text-ink-500" aria-hidden="true">
            to
          </span>

          <div className="min-w-36 flex-1">
            <label htmlFor="audit-to" className="sr-only">
              To
            </label>
            <input
              id="audit-to"
              name="to"
              type="date"
              defaultValue={to}
              className={inputClasses}
            />
          </div>

          <button type="submit" className={buttonClasses("secondary")}>
            Show
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="notable"
            value="true"
            defaultChecked={notableOnly}
            className="size-4 accent-brand-600"
          />
          Only overrides, voids, and cancellations
        </label>
      </form>

      {error && (
        <Banner tone="error">
          Could not load the audit trail: {error.message}
        </Banner>
      )}

      {counts.length > 0 && (
        <Card>
          <CardHeader
            title="In this period"
            description={
              notableCount > 0
                ? `${all.length} changes, ${notableCount} of them an override, void, or cancellation.`
                : `${all.length} changes, none of them an override or cancellation.`
            }
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {counts.map((entry) => (
                <li
                  key={entry.label}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
                >
                  <span className="font-semibold text-ink-800">
                    {entry.label}
                  </span>
                  <span className="tabular ml-2 text-ink-500">
                    {entry.count}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <AuditList entries={rows} truncated={all.length === ROW_CAP} />
    </div>
  );
}
