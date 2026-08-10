import { Document, Page, Text, View } from "@react-pdf/renderer";

import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import {
  deliveryFeeLabel,
  lineTotal,
  quotationTotals,
} from "@/lib/quotations/totals";
import {
  QUOTATION_STATUS_LABELS,
  effectiveStatus,
} from "@/lib/quotations/status";
import type {
  BusinessSettings,
  Customer,
  PaymentAccount,
  Quotation,
  QuotationItem,
} from "@/lib/supabase/database.types";
import {
  Bullets,
  DocumentFooter,
  DocumentHeader,
  ItemsTable,
  MetaRow,
  Panel,
  PanelColumns,
  PaymentChannelsBlock,
  Section,
  TotalsBlock,
  type PrintedLine,
} from "./document";
import { documentStyles as s, registerDocumentFonts } from "./theme";

/**
 * The customer-facing quotation (Spec 4.3).
 *
 * Everything printed here comes from the saved record, never from the
 * live catalog: a quotation the customer is holding must still say
 * what it said the day it was sent, whatever the price list does
 * afterwards.
 */

export type QuotationDocumentData = {
  quotation: Quotation;
  items: readonly QuotationItem[];
  customer: Customer;
  business: BusinessSettings;
  paymentAccounts: readonly PaymentAccount[];
  /** Today in Manila, so expiry is judged in the business's own day. */
  today: string;
};

export function QuotationDocument({
  quotation,
  items,
  customer,
  business,
  paymentAccounts,
  today,
}: QuotationDocumentData) {
  registerDocumentFonts();

  const totals = quotationTotals({
    lines: items,
    within_free_delivery_area: quotation.within_free_delivery_area,
    delivery_fee_centavos: quotation.delivery_fee_centavos,
    discount_centavos: quotation.discount_centavos,
    downpayment_percent: quotation.downpayment_percent,
  });

  const status = effectiveStatus(
    quotation.status,
    quotation.valid_until,
    today,
  );

  const lines: PrintedLine[] = items.map((item) => ({
    description: item.description,
    // A backdrop package prints as one priced line with its components
    // summarised underneath (Spec 4.4).
    detail: item.component_summary || undefined,
    quantity: item.quantity,
    unit_price_centavos: item.unit_price_centavos,
    line_discount_centavos: item.line_discount_centavos,
    amount_centavos: lineTotal(item),
  }));

  const hasLineDiscounts = items.some(
    (item) => item.line_discount_centavos > 0,
  );

  const deliveryLabel = deliveryFeeLabel(
    quotation.within_free_delivery_area,
    business.free_delivery_area,
  );

  const totalsRows = [
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
      label: deliveryLabel,
      value: quotation.within_free_delivery_area
        ? "FREE"
        : formatPeso(totals.delivery_fee_centavos),
    },
  ];

  // Only worth flagging when it tells the reader something: a draft
  // that escaped, or a quotation that has lapsed or been answered.
  const statusLabel =
    status === "sent" ? undefined : QUOTATION_STATUS_LABELS[status];

  return (
    <Document
      title={`${quotation.quotation_number} — ${business.business_name}`}
      author={business.business_name}
      subject={`Quotation for ${customer.name}`}
      creator={business.business_name}
      producer={business.business_name}
    >
      <Page size="A4" style={s.page}>
        <DocumentHeader
          business={business}
          title="QUOTATION"
          documentNumber={quotation.quotation_number}
          statusLabel={statusLabel}
        />

        <PanelColumns>
          <Panel heading="Quotation for">
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

          <Panel heading="Details">
            <MetaRow
              label="Quotation date"
              value={formatCalendarDate(quotation.issue_date)}
            />
            <MetaRow
              label="Valid until"
              value={formatCalendarDate(quotation.valid_until)}
            />
            {quotation.event_date ? (
              <MetaRow
                label="Event date"
                value={formatCalendarDate(quotation.event_date)}
              />
            ) : null}
            {quotation.occasion ? (
              <MetaRow label="Occasion" value={quotation.occasion} />
            ) : null}
          </Panel>
        </PanelColumns>

        {quotation.event_address ? (
          <Section heading="Delivery address">
            <Text style={s.body}>{quotation.event_address}</Text>
          </Section>
        ) : null}

        <ItemsTable lines={lines} showDiscountColumn={hasLineDiscounts} />

        <TotalsBlock
          rows={totalsRows}
          grandTotalLabel="Total"
          grandTotalCentavos={totals.total_centavos}
          callout={{
            label: `${formatPercent(quotation.downpayment_percent)}% downpayment to confirm`,
            value: formatPeso(totals.downpayment_centavos),
          }}
        />

        {quotation.notes ? (
          <Section heading="Notes">
            <Text style={s.body}>{quotation.notes}</Text>
          </Section>
        ) : null}

        <PaymentChannelsBlock accounts={paymentAccounts} />

        <Section heading="Terms">
          <Bullets
            items={quotationTerms({
              quotation,
              business,
              downpaymentCentavos: totals.downpayment_centavos,
            })}
          />
        </Section>

        <View style={s.section}>
          <Text style={s.footerText}>
            Thank you for considering {business.business_name}. Reply to this
            quotation to reserve your date.
          </Text>
        </View>

        <DocumentFooter
          note={`${quotation.quotation_number}  ·  ${business.business_name}`}
        />
      </Page>
    </Document>
  );
}

/**
 * The terms printed under every quotation.
 *
 * Generated from the record rather than typed by staff, so the stated
 * downpayment and validity can never disagree with the figures above
 * them. The rental agreement's clauses stay separately editable in
 * Settings (Spec 4.5) because those are the ones that get signed.
 */
function quotationTerms({
  quotation,
  business,
  downpaymentCentavos,
}: {
  quotation: Quotation;
  business: BusinessSettings;
  downpaymentCentavos: number;
}): string[] {
  const area = business.free_delivery_area.trim();
  const percent = formatPercent(quotation.downpayment_percent);

  return [
    `This quotation is valid until ${formatCalendarDate(quotation.valid_until)}. Prices after that date may change.`,
    `A ${percent}% downpayment of ${formatPeso(downpaymentCentavos)} confirms the booking and reserves the items for your date.`,
    "The balance is due on or before delivery.",
    quotation.within_free_delivery_area
      ? `Delivery and pickup are free${area ? ` within ${area}` : ""}.`
      : `Delivery and pickup are free${area ? ` within ${area}` : " in our service area"}; the fee above covers your location.`,
    "Items are checked on return. Damaged or lost items are charged at their replacement value.",
    "Reserved items are held for your event dates only; availability is confirmed once the downpayment is received.",
  ];
}

/** "50" from 50.00, "12.5" from 12.50 — no trailing zeroes on a document. */
function formatPercent(percent: number): string {
  return String(Number.parseFloat(String(percent)));
}
