import { Document, Page, Text, View } from "@react-pdf/renderer";

import { formatCalendarDate, formatDateTime } from "@/lib/date";
import { deliveryFeeLabel, documentTotals, lineTotal } from "@/lib/documents/totals";
import { formatPeso } from "@/lib/money";
import type {
  AgreementClause,
  Booking,
  BookingItem,
  BusinessSettings,
  Customer,
  PaymentAccount,
  RentalAgreement,
} from "@/lib/supabase/database.types";
import {
  DocumentFooter,
  DocumentHeader,
  MetaRow,
  Panel,
  PanelColumns,
  PaymentChannelsBlock,
  Section,
  SignatureBlocks,
  TotalsBlock,
} from "./document";
import { documentStyles as s, registerDocumentFonts } from "./theme";

/**
 * The rental agreement (Spec 4.5).
 *
 * This is the document that gets signed, so everything on it comes
 * from the agreement row rather than from live data: the clauses, the
 * total, and the downpayment were all snapshotted when it was
 * generated. Editing the template in Settings afterwards must not
 * change what somebody has already put their name to.
 *
 * Reuses the Milestone 3 shell — the header band, totals block,
 * payment channels, and signature blocks are the same components the
 * quotation renders through.
 */

export type AgreementDocumentData = {
  agreement: RentalAgreement;
  booking: Booking;
  items: readonly (BookingItem & {
    replacement_value_centavos: number;
  })[];
  customer: Customer;
  business: BusinessSettings;
  paymentAccounts: readonly PaymentAccount[];
};

export function AgreementDocument({
  agreement,
  booking,
  items,
  customer,
  business,
  paymentAccounts,
}: AgreementDocumentData) {
  registerDocumentFonts();

  const priced = items.filter(
    (item) => !item.is_component && item.line_type !== "damage_charge",
  );

  const totals = documentTotals({
    lines: priced,
    within_free_delivery_area: booking.within_free_delivery_area,
    delivery_fee_centavos: booking.delivery_fee_centavos,
    discount_centavos: booking.discount_centavos,
    downpayment_percent: booking.downpayment_percent,
  });

  const clauses: AgreementClause[] =
    agreement.clauses.length > 0
      ? agreement.clauses
      : business.agreement_clauses;

  return (
    <Document
      title={`${agreement.agreement_number} — ${business.business_name}`}
      author={business.business_name}
      subject={`Rental agreement for ${customer.name}`}
      creator={business.business_name}
      producer={business.business_name}
    >
      <Page size="A4" style={s.page}>
        <DocumentHeader
          business={business}
          title="RENTAL AGREEMENT"
          documentNumber={agreement.agreement_number}
          statusLabel={agreement.status === "signed" ? "Signed" : undefined}
        />

        {/* ── Parties ─────────────────────────────────────────── */}
        <PanelColumns>
          <Panel heading="The Business">
            <Text style={s.panelStrong}>{business.business_name}</Text>
            {business.address ? (
              <Text style={s.panelLine}>{business.address}</Text>
            ) : null}
            {business.contact_numbers.length > 0 ? (
              <Text style={s.panelLine}>
                {business.contact_numbers.filter(Boolean).join("  ·  ")}
              </Text>
            ) : null}
            {business.tin ? (
              <Text style={s.panelLine}>TIN {business.tin}</Text>
            ) : null}
          </Panel>

          <Panel heading="The Client">
            <Text style={s.panelStrong}>{customer.name}</Text>
            {customer.phone ? (
              <Text style={s.panelLine}>{customer.phone}</Text>
            ) : null}
            {customer.address ? (
              <Text style={s.panelLine}>{customer.address}</Text>
            ) : null}
            {customer.email ? (
              <Text style={s.panelLine}>{customer.email}</Text>
            ) : null}
          </Panel>
        </PanelColumns>

        {/* ── Event, delivery, and return ─────────────────────── */}
        <PanelColumns>
          <Panel heading="Event">
            <MetaRow
              label="Booking"
              value={booking.booking_number}
            />
            <MetaRow
              label="Event date"
              value={formatCalendarDate(booking.event_date)}
            />
            {booking.occasion ? (
              <MetaRow label="Occasion" value={booking.occasion} />
            ) : null}
          </Panel>

          <Panel heading="Delivery & return">
            <MetaRow
              label="Delivery"
              value={
                booking.delivery_at
                  ? formatDateTime(booking.delivery_at)
                  : "To be arranged"
              }
            />
            <MetaRow
              label="Pickup / return"
              value={
                booking.pickup_at
                  ? formatDateTime(booking.pickup_at)
                  : "To be arranged"
              }
            />
            {booking.setup_at ? (
              <MetaRow
                label="Backdrop setup"
                value={formatDateTime(booking.setup_at)}
              />
            ) : null}
          </Panel>
        </PanelColumns>

        {booking.event_address ? (
          <Section heading="Delivery address">
            <Text style={s.body}>
              {booking.event_address}
              {booking.landmark ? ` (${booking.landmark})` : ""}
            </Text>
          </Section>
        ) : null}

        {/* ── Items, with what each is worth to replace ───────── */}
        <ReplacementValueTable items={priced} />

        <TotalsBlock
          rows={[
            { label: "Subtotal", value: formatPeso(totals.subtotal_centavos) },
            ...(totals.discount_centavos > 0
              ? [
                  {
                    label: "Discount",
                    value: `−${formatPeso(totals.discount_centavos)}`,
                  },
                ]
              : []),
            {
              label: deliveryFeeLabel(
                booking.within_free_delivery_area,
                business.free_delivery_area,
              ),
              value: booking.within_free_delivery_area
                ? "FREE"
                : formatPeso(totals.delivery_fee_centavos),
            },
          ]}
          grandTotalLabel="Total rental fees"
          grandTotalCentavos={totals.total_centavos}
          callout={{
            label: `${formatPercent(booking.downpayment_percent)}% downpayment to confirm`,
            value: formatPeso(totals.downpayment_centavos),
          }}
        />

        <PaymentChannelsBlock
          accounts={paymentAccounts}
          cashNote={business.cash_payment_note}
        />

        {/* ── The clauses that were agreed to ─────────────────── */}
        {clauses.map((clause) => (
          <Section key={clause.heading} heading={clause.heading}>
            <Text style={s.body}>{clause.body}</Text>
          </Section>
        ))}

        <Section heading="Agreement">
          <Text style={s.body}>
            By signing below, the Client confirms the items and dates listed
            above are correct, and agrees to the terms of this agreement —
            including responsibility for any item damaged, lost, or not
            returned, chargeable at the replacement value shown.
          </Text>
        </Section>

        <SignatureBlocks
          blocks={[
            { role: "Client — signature over printed name", name: customer.name },
            {
              role: "For the Business — signature over printed name",
              name: business.business_name,
            },
          ]}
        />

        <View style={s.section}>
          <Text style={s.footerText}>
            Date signed: ______________________
            {agreement.signed_at
              ? `   (recorded ${formatDateTime(agreement.signed_at)})`
              : ""}
          </Text>
        </View>

        <DocumentFooter
          note={`${agreement.agreement_number}  ·  ${business.business_name}`}
        />
      </Page>
    </Document>
  );
}

/**
 * The itemised list Spec 4.5 asks for: quantities *and* replacement
 * values, because the replacement value is the number the damage
 * clause refers back to. Anything with no value on file says so
 * rather than printing ₱0.00, which would read as "free to break".
 */
function ReplacementValueTable({
  items,
}: {
  items: readonly (BookingItem & { replacement_value_centavos: number })[];
}) {
  return (
    <View style={s.table}>
      <View style={s.tableHeader} fixed>
        <Text style={[s.tableHeaderCell, s.cellDescription]}>ITEM</Text>
        <Text style={[s.tableHeaderCell, s.cellQuantity]}>QTY</Text>
        <Text style={[s.tableHeaderCell, s.cellUnit]}>RENTAL FEE</Text>
        <Text style={[s.tableHeaderCell, s.cellAmount]}>REPLACEMENT</Text>
      </View>

      {items.map((item, index) => (
        <View
          key={item.id}
          style={index % 2 === 1 ? [s.tableRow, s.tableRowAlt] : s.tableRow}
          wrap={false}
        >
          <View style={s.cellDescription}>
            <Text style={s.itemName}>{item.description}</Text>
            {item.component_summary ? (
              <Text style={s.itemDetail}>{item.component_summary}</Text>
            ) : null}
          </View>
          <Text style={[s.amount, s.cellQuantity]}>{item.quantity}</Text>
          <Text style={[s.amount, s.cellUnit]}>
            {formatPeso(lineTotal(item))}
          </Text>
          <Text style={[s.amountStrong, s.cellAmount]}>
            {item.replacement_value_centavos > 0
              ? formatPeso(item.replacement_value_centavos * item.quantity)
              : "—"}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "50" from 50.00, "12.5" from 12.50 — no trailing zeroes. */
function formatPercent(percent: number): string {
  return String(Number.parseFloat(String(percent)));
}
