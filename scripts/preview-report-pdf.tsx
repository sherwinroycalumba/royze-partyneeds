/**
 * Renders a sample report PDF from made-up data:
 *
 *   npm run preview:pdf
 *
 * Exercises the awkward cases: a wide table, a totals row, a section
 * with no rows, and a negative figure.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { renderToFile } from "@react-pdf/renderer";

import { ReportDocument } from "@/lib/pdf/report";
import type { Report } from "@/lib/reports/types";
import type { BusinessSettings } from "@/lib/supabase/database.types";

const outDir = path.join(process.cwd(), ".preview");
const out = path.join(outDir, "report.pdf");

const business: BusinessSettings = {
  id: true,
  business_name: "Royze Party Needs Rental",
  address: "Blk 12 Lot 8, Deca Homes Meycauayan, Bulacan",
  contact_numbers: ["0917 123 4567"],
  email: "royzepartyneeds@gmail.com",
  facebook_page: "fb.com/royzepartyneeds",
  tin: "123-456-789-000",
  logo_url: null,
  downpayment_percent: 50,
  quotation_validity_days: 7,
  free_delivery_area: "Deca Homes Meycauayan",
  cash_payment_note: "At the shop.",
  delivery_fee_table: [],
  agreement_clauses: [],
  expense_categories: [],
  updated_by: null,
  updated_at: "",
};

const report: Report = {
  kind: "receivables",
  title: "Receivables (Aging)",
  subtitle:
    "Bookings and sales with money still owed, aged by how late they are.",
  range: { from: "2026-08-01", to: "2026-08-31" },
  highlights: [
    { label: "Outstanding", value: 1_235_000, money: true, tone: "negative" },
    { label: "Documents", value: 3 },
    { label: "Oldest", value: "44 days" },
  ],
  sections: [
    {
      title: "By age",
      columns: [
        { key: "0–7 days", label: "0–7 days", type: "money" },
        { key: "8–30 days", label: "8–30 days", type: "money" },
        { key: "31+ days", label: "31+ days", type: "money" },
      ],
      rows: [{ "0–7 days": 500_000, "8–30 days": 485_000, "31+ days": 250_000 }],
    },
    {
      title: "Outstanding balances",
      columns: [
        { key: "document", label: "Document" },
        { key: "customer", label: "Customer" },
        { key: "due", label: "Due since", type: "date" },
        { key: "status", label: "Status" },
        { key: "total", label: "Total", type: "money" },
        { key: "paid", label: "Verified", type: "money" },
        { key: "balance", label: "Balance", type: "money" },
        { key: "bucket", label: "Age" },
      ],
      rows: [
        {
          document: "BK-2026-0004",
          customer: "Maria Santos",
          due: "2026-08-29",
          status: "Delivered / Ongoing",
          total: 1_000_000,
          paid: 500_000,
          balance: 500_000,
          bucket: "0–7 days",
        },
        {
          document: "BK-2026-0002",
          customer: "Josefina dela Cruz",
          due: "2026-08-12",
          status: "Completed",
          total: 735_000,
          paid: 250_000,
          balance: 485_000,
          bucket: "8–30 days",
        },
        {
          document: "OR-2026-0003",
          customer: "Walk-in",
          due: "2026-07-18",
          status: "Quick sale",
          total: 250_000,
          paid: 0,
          balance: 250_000,
          bucket: "31+ days",
        },
      ],
      totals: {
        document: "Total",
        customer: null,
        due: null,
        status: null,
        total: null,
        paid: null,
        balance: 1_235_000,
        bucket: null,
      },
    },
    {
      title: "Written off",
      emptyLabel: "Nothing written off in this period.",
      columns: [
        { key: "document", label: "Document" },
        { key: "amount", label: "Amount", type: "money" },
      ],
      rows: [],
    },
  ],
};

async function main() {
  await mkdir(outDir, { recursive: true });
  await renderToFile(
    ReportDocument({
      report,
      business,
      generatedOn: "2026-08-31",
      generatedBy: "Sherwin Roy Calumba",
    }),
    out,
  );
  console.log("wrote", out);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
