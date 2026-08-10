/**
 * Renders a sample quotation PDF from made-up data:
 *
 *   npm run preview:pdf        # writes .preview/quotation.pdf
 *
 * Nothing here touches the database, so document design can be
 * iterated on without seeding or signing in. The sample deliberately
 * exercises the awkward cases — a package line with a component
 * summary, a per-line discount, a whole-quotation discount, a delivery
 * fee, and an inactive payment account that must NOT be printed.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { renderToFile } from "@react-pdf/renderer";

import { QuotationDocument } from "@/lib/pdf/quotation";
import type {
  BusinessSettings,
  Customer,
  PaymentAccount,
  Quotation,
  QuotationItem,
} from "@/lib/supabase/database.types";

const outDir = path.join(process.cwd(), ".preview");
const out = path.join(outDir, "quotation.pdf");

const business: BusinessSettings = {
  id: true,
  business_name: "Royze Party Needs Rental",
  address: "Blk 12 Lot 8, Deca Homes Meycauayan, Bulacan",
  contact_numbers: ["0917 123 4567", "0995 888 1234"],
  email: "royzepartyneeds@gmail.com",
  facebook_page: "fb.com/royzepartyneeds",
  tin: "123-456-789-000",
  logo_url: null,
  downpayment_percent: 50,
  quotation_validity_days: 7,
  free_delivery_area: "Deca Homes Meycauayan",
  cash_payment_note: "On delivery or at the shop.",
  delivery_fee_table: [],
  agreement_clauses: [],
  expense_categories: [],
  updated_by: null,
  updated_at: new Date().toISOString(),
};

const customer: Customer = {
  id: "c1",
  name: "Maria Santos",
  phone: "0917 555 8899",
  alt_phone: null,
  facebook_name: "Maria Santos",
  facebook_url: null,
  address: "24 Sampaguita St, Malhacan, Meycauayan, Bulacan",
  landmark: "beside the barangay hall",
  email: "maria.santos@example.com",
  notes: "",
  is_active: true,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  phone_digits: "09175558899",
};

const quotation: Quotation = {
  id: "q1",
  quotation_number: "QT-2026-0042",
  customer_id: "c1",
  status: "sent",
  issue_date: "2026-08-10",
  valid_until: "2026-08-17",
  event_date: "2026-08-29",
  event_address: "24 Sampaguita St, Malhacan, Meycauayan, Bulacan (beside the barangay hall)",
  occasion: "7th Birthday — Safari theme",
  within_free_delivery_area: false,
  delivery_fee_centavos: 50_000,
  delivery_fee_override_reason: "",
  discount_centavos: 37_650,
  downpayment_percent: 50,
  notes:
    "Setup starts 7:00 AM on the event date. Please keep the driveway clear for the delivery tricycle.",
  internal_notes: "",
  sent_at: new Date().toISOString(),
  decided_at: null,
  converted_booking_id: null,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const items: QuotationItem[] = [
  {
    id: "i1",
    quotation_id: "q1",
    line_type: "rental",
    catalog_item_id: "ci1",
    package_id: null,
    description: "Monoblock chair (white)",
    component_summary: "",
    quantity: 100,
    unit_price_centavos: 2_500,
    line_discount_centavos: 0,
    sort_order: 0,
  },
  {
    id: "i2",
    quotation_id: "q1",
    line_type: "rental",
    catalog_item_id: "ci2",
    package_id: null,
    description: "Round table, 5-seater",
    component_summary: "Includes plain table cover",
    quantity: 20,
    unit_price_centavos: 15_000,
    line_discount_centavos: 0,
    sort_order: 1,
  },
  {
    id: "i3",
    quotation_id: "q1",
    line_type: "package",
    catalog_item_id: null,
    package_id: "p1",
    description: "Birthday Arch Backdrop Package",
    component_summary:
      "1 × Arch frame, 6 × Cloth drape, 2 × Fairy light set, 1 × Celebrant banner, +3 more",
    quantity: 1,
    unit_price_centavos: 450_000,
    line_discount_centavos: 50_000,
    sort_order: 2,
  },
  {
    id: "i4",
    quotation_id: "q1",
    line_type: "sale",
    catalog_item_id: "ci3",
    package_id: null,
    description: "Balloon garland kit (safari colours)",
    component_summary: "",
    quantity: 3,
    unit_price_centavos: 12_550,
    line_discount_centavos: 0,
    sort_order: 3,
  },
];

const paymentAccounts: PaymentAccount[] = [
  {
    id: "pa1",
    channel: "gcash",
    bank_name: "",
    account_name: "Royze O. Calumba",
    account_number: "0917 123 4567",
    is_active: true,
    sort_order: 0,
    created_by: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "pa2",
    channel: "maya",
    bank_name: "",
    account_name: "Royze O. Calumba",
    account_number: "0995 888 1234",
    is_active: true,
    sort_order: 1,
    created_by: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "pa3",
    channel: "bank_transfer",
    bank_name: "BPI",
    account_name: "Royze Party Needs Rental",
    account_number: "1234-5678-90",
    is_active: true,
    sort_order: 2,
    created_by: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "pa4",
    channel: "gcash",
    bank_name: "",
    account_name: "Closed account",
    account_number: "0900 000 0000",
    is_active: false,
    sort_order: 3,
    created_by: null,
    created_at: "",
    updated_at: "",
  },
];

const shortOut = path.join(outDir, "quotation-short.pdf");

async function main() {
  await mkdir(outDir, { recursive: true });

  await renderToFile(
    QuotationDocument({
      quotation,
      items,
      customer,
      business,
      paymentAccounts,
      today: "2026-08-12",
    }),
    out,
  );
  console.log("wrote", out);

  // A one-page variant: the full sample runs onto a second page, and
  // most preview tools only render page one, so this keeps the terms
  // and the running footer where they can actually be checked.
  await renderToFile(
    QuotationDocument({
      quotation: { ...quotation, notes: "", event_address: "" },
      items: items.slice(0, 1),
      customer,
      business,
      paymentAccounts: paymentAccounts.slice(0, 1),
      today: "2026-08-12",
    }),
    shortOut,
  );
  console.log("wrote", shortOut);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
