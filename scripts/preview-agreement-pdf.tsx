/**
 * Renders a sample rental agreement PDF from made-up data:
 *
 *   npm run preview:pdf
 *
 * Same purpose as the quotation preview — iterate on the document
 * without a database. Exercises the awkward cases: a package line, an
 * item with no replacement value on file, and the snapshotted clauses.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { renderToFile } from "@react-pdf/renderer";

import { AgreementDocument } from "@/lib/pdf/agreement";
import type {
  Booking,
  BookingItem,
  BusinessSettings,
  Customer,
  PaymentAccount,
  RentalAgreement,
} from "@/lib/supabase/database.types";

const outDir = path.join(process.cwd(), ".preview");
const out = path.join(outDir, "agreement.pdf");

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
  cash_payment_note: "At the shop only — we do not accept cash on delivery.",
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
  facebook_name: null,
  facebook_url: null,
  address: "24 Sampaguita St, Malhacan, Meycauayan, Bulacan",
  landmark: "beside the barangay hall",
  email: "maria.santos@example.com",
  notes: "",
  is_active: true,
  created_by: null,
  created_at: "",
  updated_at: "",
  phone_digits: "09175558899",
};

const booking = {
  id: "b1",
  booking_number: "BK-2026-0007",
  customer_id: "c1",
  status: "reserved",
  source_quotation_id: null,
  event_date: "2026-08-29",
  event_start_time: "14:00",
  event_end_time: "22:00",
  delivery_at: "2026-08-28T06:00:00.000Z",
  pickup_at: "2026-08-30T01:00:00.000Z",
  setup_at: "2026-08-28T23:00:00.000Z",
  teardown_at: "2026-08-29T16:00:00.000Z",
  reserved_from: "2026-08-28",
  reserved_to: "2026-08-30",
  event_address: "24 Sampaguita St, Malhacan, Meycauayan, Bulacan",
  landmark: "beside the barangay hall",
  contact_person_name: "Ate Let",
  contact_person_phone: "0918 222 3333",
  occasion: "7th Birthday — Safari theme",
  theme_motif: "Safari, sage green and cream",
  celebrant_name: "Sofia",
  reference_photo_urls: [],
  within_free_delivery_area: false,
  delivery_fee_centavos: 50_000,
  delivery_fee_override_reason: "",
  discount_centavos: 0,
  downpayment_percent: 50,
  agreement_signed: false,
  agreement_signed_at: null,
  confirmation_override_reason: "",
  availability_override_reason: "",
  assigned_delivery_staff: null,
  notes: "",
  internal_notes: "",
  reserved_at: null,
  confirmed_at: null,
  delivered_at: null,
  returned_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: "",
  created_by: null,
  created_at: "",
  updated_at: "",
} satisfies Booking;

function item(
  overrides: Partial<BookingItem> & { replacement_value_centavos: number },
): BookingItem & { replacement_value_centavos: number } {
  return {
    id: crypto.randomUUID(),
    booking_id: "b1",
    line_type: "rental",
    catalog_item_id: "ci1",
    package_id: null,
    parent_item_id: null,
    is_component: false,
    description: "Monoblock chair (white)",
    component_summary: "",
    quantity: 100,
    unit_price_centavos: 2_500,
    line_discount_centavos: 0,
    reserves_stock: true,
    consumes_stock: false,
    stock_consumed: false,
    return_condition: "pending",
    return_notes: "",
    damaged_quantity: 0,
    lost_quantity: 0,
    source_item_id: null,
    sort_order: 0,
    ...overrides,
  };
}

const items = [
  item({ replacement_value_centavos: 45_000 }),
  item({
    description: "Round table, 5-seater",
    quantity: 20,
    unit_price_centavos: 15_000,
    replacement_value_centavos: 180_000,
    sort_order: 1,
  }),
  item({
    line_type: "package",
    description: "Birthday Arch Backdrop Package",
    component_summary:
      "1 × Arch frame, 6 × Cloth drape, 2 × Fairy light set, +3 more",
    quantity: 1,
    unit_price_centavos: 450_000,
    replacement_value_centavos: 0, // no value on file — must not print ₱0.00
    sort_order: 2,
  }),
];

const agreement: RentalAgreement = {
  id: "a1",
  agreement_number: "RA-2026-0007",
  booking_id: "b1",
  status: "generated",
  clauses: [
    {
      heading: "Rental Period",
      body: "Equipment is rented for the period stated above. Late returns are charged an additional day's rental per item unless otherwise agreed in writing.",
    },
    {
      heading: "Damage & Loss",
      body: "The Client is responsible for any item damaged, lost, or not returned, and shall be charged the replacement value stated in the itemized list above.",
    },
    {
      heading: "Care of Equipment",
      body: "The Client shall keep all rented equipment clean, dry, and protected from weather damage, and shall not modify, paint, or sublease any item.",
    },
  ],
  total_centavos: 0,
  downpayment_centavos: 0,
  sent_at: null,
  signed_at: null,
  signed_copy_path: null,
  signed_by_name: "",
  generated_by: null,
  created_at: "",
  updated_at: "",
};

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
];

async function main() {
  await mkdir(outDir, { recursive: true });
  await renderToFile(
    AgreementDocument({
      agreement,
      booking,
      items,
      customer,
      business,
      paymentAccounts,
    }),
    out,
  );
  console.log("wrote", out);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
