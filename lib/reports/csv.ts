import { centavosToDecimalString } from "@/lib/money";
import type { Report, ReportCell, ReportColumn, ReportSection } from "./types";

/**
 * CSV export (Spec 4.11).
 *
 * These files land in Excel and Google Sheets on the bookkeeper's
 * machine, which drives two decisions that are easy to get wrong:
 *
 *  - Money is written as a plain decimal — `1234.56`, not `₱1,234.56`
 *    — because a spreadsheet cannot add up a peso sign, and thousands
 *    separators turn a number into text.
 *  - Any value that starts like a formula is neutralised. A payee
 *    called `=cmd|...` is a real attack on whoever opens the file, and
 *    it costs one apostrophe to prevent.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** Escapes one value for CSV, quoting only when it has to. */
export function escapeCsvValue(value: string): string {
  // Prefix-guard first, then quote: the apostrophe must end up inside
  // the quotes, not outside them.
  const guarded = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }

  return guarded;
}

/** Renders a cell for the file, given what the column holds. */
export function formatCsvCell(
  value: ReportCell,
  column: ReportColumn,
): string {
  if (value === null || value === undefined) return "";

  if (column.type === "money") {
    // Plain decimal so the spreadsheet can sum the column.
    return typeof value === "number"
      ? centavosToDecimalString(value)
      : String(value);
  }

  return String(value);
}

export function sectionToCsv(section: ReportSection): string[] {
  const lines: string[] = [];

  if (section.title) lines.push(escapeCsvValue(section.title));

  lines.push(
    section.columns.map((column) => escapeCsvValue(column.label)).join(","),
  );

  for (const row of section.rows) {
    lines.push(
      section.columns
        .map((column) => escapeCsvValue(formatCsvCell(row[column.key], column)))
        .join(","),
    );
  }

  if (section.totals) {
    lines.push(
      section.columns
        .map((column) =>
          escapeCsvValue(formatCsvCell(section.totals?.[column.key] ?? null, column)),
        )
        .join(","),
    );
  }

  return lines;
}

/**
 * The whole report as one file: a small header saying what it is and
 * what period it covers, then each section separated by a blank line.
 * A report that does not say its own date range is useless a week
 * later.
 */
export function reportToCsv(report: Report): string {
  const lines: string[] = [
    escapeCsvValue(report.title),
    escapeCsvValue(`${report.range.from} to ${report.range.to}`),
  ];

  for (const highlight of report.highlights) {
    lines.push(
      [
        escapeCsvValue(highlight.label),
        escapeCsvValue(
          highlight.money && typeof highlight.value === "number"
            ? centavosToDecimalString(highlight.value)
            : String(highlight.value),
        ),
      ].join(","),
    );
  }

  for (const section of report.sections) {
    lines.push("");
    lines.push(...sectionToCsv(section));
  }

  // CRLF, which is what the CSV spec says and what Excel is happiest
  // with on Windows.
  return `${lines.join("\r\n")}\r\n`;
}

/** `daily-sales-2026-08-01-to-2026-08-31.csv` */
export function reportFilename(
  report: Pick<Report, "kind" | "range">,
  extension: "csv" | "pdf",
): string {
  return `${report.kind}-${report.range.from}-to-${report.range.to}.${extension}`;
}
