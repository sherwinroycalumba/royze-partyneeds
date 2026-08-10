import { Document, Page, Text, View } from "@react-pdf/renderer";

import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type {
  Report,
  ReportCell,
  ReportColumn,
  ReportSection,
} from "@/lib/reports/types";
import type { BusinessSettings } from "@/lib/supabase/database.types";
import { DocumentFooter, DocumentHeader } from "./document";
import { documentStyles as s, registerDocumentFonts, PDF_COLORS } from "./theme";

/**
 * One renderer for all eight reports (Spec 4.11).
 *
 * Reports are described as data — sections of columns and rows — so
 * this file and the CSV serialiser are the only two places that know
 * how a report is presented. Adding a ninth report is a query, not
 * another pair of exporters to keep in step.
 *
 * Landscape, because a receivables table has eight columns and A4
 * portrait would either clip it or shrink it past readable.
 */

export function ReportDocument({
  report,
  business,
  generatedOn,
  generatedBy,
}: {
  report: Report;
  business: BusinessSettings;
  /** `YYYY-MM-DD` in Manila. */
  generatedOn: string;
  generatedBy: string;
}) {
  registerDocumentFonts();

  return (
    <Document
      title={`${report.title} — ${business.business_name}`}
      author={business.business_name}
      subject={`${report.title}, ${report.range.from} to ${report.range.to}`}
      creator={business.business_name}
      producer={business.business_name}
    >
      <Page size="A4" orientation="landscape" style={s.page}>
        <DocumentHeader
          business={business}
          title="REPORT"
          documentNumber={report.title}
        />

        <View style={s.section}>
          <Text style={s.body}>{report.subtitle}</Text>
          <Text style={s.footerText}>
            {formatCalendarDate(report.range.from)} to{" "}
            {formatCalendarDate(report.range.to)} · generated{" "}
            {formatCalendarDate(generatedOn)} by {generatedBy}
          </Text>
        </View>

        {report.highlights.length > 0 && (
          <View style={[s.columns, { marginTop: 10 }]}>
            {report.highlights.map((highlight) => (
              <View key={highlight.label} style={s.panel}>
                <Text style={s.panelHeading}>
                  {highlight.label.toUpperCase()}
                </Text>
                <Text
                  style={[
                    s.panelStrong,
                    {
                      color:
                        highlight.tone === "negative"
                          ? PDF_COLORS.brandDark
                          : PDF_COLORS.ink,
                    },
                  ]}
                >
                  {highlight.money && typeof highlight.value === "number"
                    ? formatPeso(highlight.value)
                    : String(highlight.value)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {report.sections.map((section, index) => (
          <SectionTable key={section.title ?? index} section={section} />
        ))}

        <DocumentFooter
          note={`${report.title}  ·  ${business.business_name}`}
        />
      </Page>
    </Document>
  );
}

function SectionTable({ section }: { section: ReportSection }) {
  /**
   * Flex, not percentage widths. Percentages resolve against the row's
   * padding box, so eight columns of 12.5% overflow the row by exactly
   * its horizontal padding and the last two run into each other.
   * `flexBasis: 0` with equal grow divides whatever space is there.
   */
  const cell = { flexGrow: 1, flexBasis: 0, paddingRight: 6 } as const;

  if (section.rows.length === 0) {
    return (
      <View style={s.section}>
        {section.title ? (
          <Text style={s.sectionHeading}>{section.title.toUpperCase()}</Text>
        ) : null}
        <Text style={s.body}>
          {section.emptyLabel ?? "Nothing to show for this period."}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.section}>
      {section.title ? (
        <Text style={s.sectionHeading}>{section.title.toUpperCase()}</Text>
      ) : null}

      <View style={[s.table, { marginTop: 4 }]}>
        <View style={s.tableHeader} fixed>
          {section.columns.map((column) => (
            <Text
              key={column.key}
              style={[s.tableHeaderCell, cell, { textAlign: alignFor(column) }]}
            >
              {column.label.toUpperCase()}
            </Text>
          ))}
        </View>

        {section.rows.map((row, index) => (
          <View
            key={index}
            style={index % 2 === 1 ? [s.tableRow, s.tableRowAlt] : s.tableRow}
            wrap={false}
          >
            {section.columns.map((column) => (
              <Text
                key={column.key}
                style={[s.amount, cell, { textAlign: alignFor(column) }]}
              >
                {renderCell(row[column.key], column)}
              </Text>
            ))}
          </View>
        ))}

        {section.totals && (
          <View style={[s.tableRow, { backgroundColor: PDF_COLORS.brandTint }]}>
            {section.columns.map((column) => (
              <Text
                key={column.key}
                style={[s.amountStrong, cell, { textAlign: alignFor(column) }]}
              >
                {renderCell(section.totals?.[column.key] ?? null, column)}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function alignFor(column: ReportColumn): "left" | "right" {
  return column.type === "money" || column.type === "number" ? "right" : "left";
}

function renderCell(value: ReportCell, column: ReportColumn): string {
  if (value === null || value === undefined) return "";

  if (column.type === "money" && typeof value === "number") {
    return formatPeso(value);
  }

  if (column.type === "date" && typeof value === "string") {
    // Totals rows put a label in the date column; only format what is
    // actually a date.
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatCalendarDate(value)
      : value;
  }

  return String(value);
}
