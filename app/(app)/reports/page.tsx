import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { formatCalendarDate, todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import { formatPeso } from "@/lib/money";
import { buildReport } from "@/lib/reports/build";
import {
  isReportKind,
  REPORT_DESCRIPTIONS,
  REPORT_KINDS,
  REPORT_LABELS,
  type ReportCell,
  type ReportColumn,
  type ReportKind,
} from "@/lib/reports/types";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";

export const metadata: Metadata = { title: "Reports" };

/** First day of the month a date falls in. */
function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export default async function ReportsPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ kind?: string; from?: string; to?: string }>;
}) {
  // The Bookkeeper's whole job is these pages (Spec 3).
  const profile = await requirePermission("reports.financial.view");
  const { kind: rawKind, from: rawFrom, to: rawTo } = await searchParams;

  const today = todayInManila();
  const kind: ReportKind = isReportKind(rawKind ?? "")
    ? (rawKind as ReportKind)
    : "profit-and-loss";
  const from = rawFrom && isCalendarDate(rawFrom) ? rawFrom : startOfMonth(today);
  const to = rawTo && isCalendarDate(rawTo) ? rawTo : today;

  const report = await buildReport(kind, { from, to });
  const exportQuery = `kind=${kind}&from=${from}&to=${to}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Reports
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Cash-basis: revenue counts when a payment is verified, never when a
          booking is made.
        </p>
      </header>

      {/* ── Pick a report and a period ───────────────────────── */}
      {/* Flex rather than a grid: a grid's column count is fixed at
          each breakpoint, which pushed the second date onto its own
          row at every width between sm and lg. The two dates are one
          idea and stay together. */}
      <form
        action="/reports"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="min-w-52 sm:flex-1">
          <label htmlFor="report-kind" className="sr-only">
            Report
          </label>
          <select
            id="report-kind"
            name="kind"
            defaultValue={kind}
            className={inputClasses}
          >
            {REPORT_KINDS.map((value) => (
              <option key={value} value={value}>
                {REPORT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="min-w-36 flex-1">
            <label htmlFor="report-from" className="sr-only">
              From
            </label>
            <input
              id="report-from"
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
            <label htmlFor="report-to" className="sr-only">
              To
            </label>
            <input
              id="report-to"
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
      </form>

      <Card>
        <CardHeader
          title={report.title}
          description={REPORT_DESCRIPTIONS[kind]}
          action={
            can(profile, "reports.export") ? (
              <div className="flex gap-2">
                <a
                  href={`/reports/export?format=csv&${exportQuery}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  CSV
                </a>
                <a
                  href={`/reports/export?format=pdf&${exportQuery}`}
                  className={buttonClasses("primary", "sm")}
                >
                  PDF
                </a>
              </div>
            ) : undefined
          }
        />

        <CardBody className="space-y-4">
          <p className="text-sm text-ink-500">
            {formatCalendarDate(report.range.from)} to{" "}
            {formatCalendarDate(report.range.to)}
          </p>

          {report.highlights.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {report.highlights.map((highlight) => (
                <div
                  key={highlight.label}
                  className="rounded-xl border border-ink-200 p-3"
                >
                  <p className="text-sm text-ink-600">{highlight.label}</p>
                  <p
                    className={`tabular text-xl font-bold ${
                      highlight.tone === "negative"
                        ? "text-danger-600"
                        : highlight.tone === "positive"
                          ? "text-success-700"
                          : "text-ink-900"
                    }`}
                  >
                    {highlight.money && typeof highlight.value === "number"
                      ? formatPeso(highlight.value)
                      : highlight.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {report.sections.map((section, index) => (
        <Card key={section.title ?? index}>
          {section.title && <CardHeader title={section.title} />}

          {section.rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-500">
                {section.emptyLabel ?? "Nothing to show for this period."}
              </p>
            </CardBody>
          ) : (
            // A receivables table is eight columns wide; on a phone it
            // scrolls rather than being crushed.
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/60">
                    {section.columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 ${
                          alignClass(column)
                        }`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-b border-ink-200 last:border-b-0"
                    >
                      {section.columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-4 py-2 text-ink-800 ${alignClass(column)}`}
                        >
                          {renderCell(row[column.key], column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {section.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-ink-300 bg-brand-50">
                      {section.columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-4 py-2 font-bold text-ink-900 ${alignClass(column)}`}
                        >
                          {renderCell(section.totals?.[column.key] ?? null, column)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>
      ))}

      <p className="px-1 text-xs text-ink-500">
        Need a different period?{" "}
        <Link
          href={`/reports?kind=${kind}&from=${startOfMonth(today)}&to=${today}`}
          className="font-medium text-brand-700 underline underline-offset-2"
        >
          This month
        </Link>
        .
      </p>
    </div>
  );
}

function alignClass(column: ReportColumn): string {
  return column.type === "money" || column.type === "number"
    ? "text-right tabular"
    : "text-left";
}

function renderCell(value: ReportCell, column: ReportColumn): string {
  if (value === null || value === undefined) return "";

  if (column.type === "money" && typeof value === "number") {
    return formatPeso(value);
  }

  if (column.type === "date" && typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatCalendarDate(value)
      : value;
  }

  return String(value);
}
