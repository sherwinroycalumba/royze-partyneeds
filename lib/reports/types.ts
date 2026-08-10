/**
 * One shape for every report (Spec 4.11).
 *
 * There are eight reports and two export formats. Describing each
 * report as data rather than as markup means one CSV serialiser and
 * one PDF renderer serve all of them — and a new report is a query,
 * not another pair of exporters to keep in step.
 */

export type ReportColumnType = "text" | "money" | "number" | "date";

export type ReportColumn = {
  key: string;
  label: string;
  /** Money and numbers right-align; everything else reads left. */
  type?: ReportColumnType;
};

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportSection = {
  title?: string;
  /** Shown when the section has no rows, instead of an empty table. */
  emptyLabel?: string;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  /** Rendered as a bold final row, and labelled by the first column. */
  totals?: ReportRow;
};

/** The headline figures a reader should take away. */
export type ReportHighlight = {
  label: string;
  /** Centavos when `money`, otherwise shown as given. */
  value: number | string;
  money?: boolean;
  tone?: "neutral" | "positive" | "negative";
};

export type Report = {
  kind: ReportKind;
  title: string;
  /** One line explaining what the reader is looking at. */
  subtitle: string;
  range: { from: string; to: string };
  highlights: readonly ReportHighlight[];
  sections: readonly ReportSection[];
};

export const REPORT_KINDS = [
  "profit-and-loss",
  "daily-sales",
  "receivables",
  "payables",
  "bookings",
  "inventory",
  "customers",
  "expenses",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  "profit-and-loss": "Profit & Loss",
  "daily-sales": "Daily Sales",
  receivables: "Receivables (Aging)",
  payables: "Payables",
  bookings: "Booking Summary",
  inventory: "Inventory & Stock",
  customers: "Customers",
  expenses: "Expenses",
};

/** One line per report, shown under the picker. */
export const REPORT_DESCRIPTIONS: Record<ReportKind, string> = {
  "profit-and-loss":
    "Revenue by source less expenses by category. Cash-basis: revenue counts when a payment is verified.",
  "daily-sales": "Every verified payment received, by day and by method.",
  receivables: "Bookings and sales with money still owed, aged by how late.",
  payables: "Unpaid expenses by supplier and due date.",
  bookings: "How many bookings per status, and how many were cancelled.",
  inventory:
    "Sale stock levels, how often each rental item goes out, and which packages sell.",
  customers: "Top customers by what they have actually paid, and any damage.",
  expenses: "Spending by category and supplier, for the BIR filing handover.",
};

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}
