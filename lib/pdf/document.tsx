import type { ReactNode } from "react";

import { Image, Text, View } from "@react-pdf/renderer";

import { formatPeso } from "@/lib/money";
import {
  accountsByChannel,
  needsBankName,
} from "@/lib/settings/payment-accounts";
import type {
  BusinessSettings,
  PaymentAccount,
} from "@/lib/supabase/database.types";
import { documentStyles as s } from "./theme";

/**
 * The pieces every printed document is built from (Spec 4.3, 4.5).
 *
 * The quotation uses all of them; the rental agreement in Milestone 5
 * reuses the header, the item table, and the signature block, which is
 * why nothing here knows what a quotation is.
 */

// ── Header ─────────────────────────────────────────────────────
/** The business identity that heads every document (Spec 2.1). */
export function DocumentHeader({
  business,
  title,
  documentNumber,
  statusLabel,
}: {
  business: BusinessSettings;
  /** "QUOTATION", "RENTAL AGREEMENT". */
  title: string;
  documentNumber: string;
  /** Printed only when it warns the reader — a draft or a dead quote. */
  statusLabel?: string;
}) {
  const contact = business.contact_numbers.filter(Boolean).join("  ·  ");

  return (
    <View style={s.header} fixed>
      <View style={s.headerBusiness}>
        {business.logo_url ? (
          // This is @react-pdf's Image drawing into a PDF, not an HTML
          // <img> — there is no alt attribute to give it.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={business.logo_url} style={s.logo} />
        ) : (
          // Spec 4.3 asks for a logo *placeholder* — a document printed
          // before the owner uploads a logo should still look finished.
          <View style={s.logoPlaceholder}>
            <Text style={s.logoPlaceholderText}>
              {initials(business.business_name)}
            </Text>
          </View>
        )}

        <View>
          <Text style={s.businessName}>{business.business_name}</Text>
          {business.address ? (
            <Text style={s.businessLine}>{business.address}</Text>
          ) : null}
          {contact ? <Text style={s.businessLine}>{contact}</Text> : null}
          <Text style={s.businessLine}>
            {[
              business.email,
              business.facebook_page,
              business.tin ? `TIN ${business.tin}` : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
        </View>
      </View>

      <View style={s.headerDocument}>
        <Text style={s.documentTitle}>{title}</Text>
        <Text style={s.documentNumber}>{documentNumber}</Text>
        {statusLabel ? (
          <Text style={s.documentStatus}>{statusLabel.toUpperCase()}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** "Royze Party Needs Rental" → "RP", for the logo placeholder. */
function initials(businessName: string): string {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Panels ─────────────────────────────────────────────────────
export function Panel({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <View style={s.panel}>
      <Text style={s.panelHeading}>{heading.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function PanelColumns({ children }: { children: ReactNode }) {
  return <View style={s.columns}>{children}</View>;
}

/** A label/value pair inside a panel — "Quotation date  Aug 10, 2026". */
export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

// ── Item table ─────────────────────────────────────────────────
/** One printed line. Prices are the ones frozen onto the record. */
export type PrintedLine = {
  description: string;
  /** Component summary under a package line, or a note (Spec 4.4). */
  detail?: string;
  quantity: number;
  unit_price_centavos: number;
  line_discount_centavos: number;
  amount_centavos: number;
};

export function ItemsTable({
  lines,
  showDiscountColumn,
}: {
  lines: readonly PrintedLine[];
  /** Dropped when nothing is discounted, to keep the page uncluttered. */
  showDiscountColumn: boolean;
}) {
  return (
    <View style={s.table}>
      <View style={s.tableHeader} fixed>
        <Text style={[s.tableHeaderCell, s.cellDescription]}>ITEM</Text>
        <Text style={[s.tableHeaderCell, s.cellQuantity]}>QTY</Text>
        <Text style={[s.tableHeaderCell, s.cellUnit]}>UNIT PRICE</Text>
        {showDiscountColumn && (
          <Text style={[s.tableHeaderCell, s.cellDiscount]}>DISCOUNT</Text>
        )}
        <Text style={[s.tableHeaderCell, s.cellAmount]}>AMOUNT</Text>
      </View>

      {lines.map((line, index) => (
        <View
          key={`${line.description}-${index}`}
          style={index % 2 === 1 ? [s.tableRow, s.tableRowAlt] : s.tableRow}
          wrap={false}
        >
          <View style={s.cellDescription}>
            <Text style={s.itemName}>{line.description}</Text>
            {line.detail ? (
              <Text style={s.itemDetail}>{line.detail}</Text>
            ) : null}
          </View>
          <Text style={[s.amount, s.cellQuantity]}>{line.quantity}</Text>
          <Text style={[s.amount, s.cellUnit]}>
            {formatPeso(line.unit_price_centavos)}
          </Text>
          {showDiscountColumn && (
            <Text style={[s.amount, s.cellDiscount]}>
              {line.line_discount_centavos > 0
                ? `−${formatPeso(line.line_discount_centavos)}`
                : "—"}
            </Text>
          )}
          <Text style={[s.amountStrong, s.cellAmount]}>
            {formatPeso(line.amount_centavos)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Totals ─────────────────────────────────────────────────────
export function TotalsBlock({
  rows,
  grandTotalLabel,
  grandTotalCentavos,
  callout,
}: {
  rows: readonly { label: string; value: string }[];
  grandTotalLabel: string;
  grandTotalCentavos: number;
  /** The downpayment strip under the total (Spec 4.3). */
  callout?: { label: string; value: string };
}) {
  return (
    <View style={s.totalsWrap}>
      <View style={s.totals}>
        {rows.map((row) => (
          <View key={row.label} style={s.totalsRow}>
            <Text style={s.totalsLabel}>{row.label}</Text>
            <Text style={s.totalsValue}>{row.value}</Text>
          </View>
        ))}

        <View style={s.grandTotalRow}>
          <Text style={s.grandTotalLabel}>{grandTotalLabel.toUpperCase()}</Text>
          <Text style={s.grandTotalValue}>
            {formatPeso(grandTotalCentavos)}
          </Text>
        </View>

        {callout ? (
          <View style={s.downpaymentRow}>
            <Text style={s.downpaymentLabel}>{callout.label}</Text>
            <Text style={s.downpaymentValue}>{callout.value}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ── Blocks ─────────────────────────────────────────────────────
export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.sectionHeading}>{heading.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} style={s.bullet}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Where the customer may send money (Spec 4.3).
 *
 * Only accounts marked active in Settings are printed, so a closed
 * account stays on file without ever being quoted again. Cash is
 * listed first because it needs no account details.
 */
export function PaymentChannelsBlock({
  accounts,
}: {
  accounts: readonly PaymentAccount[];
}) {
  const groups = accountsByChannel(accounts);

  return (
    <Section heading="How to pay">
      <View style={s.channels}>
        <View style={s.channel}>
          <Text style={s.channelName}>CASH</Text>
          <Text style={s.channelLine}>On delivery or at the shop.</Text>
        </View>

        {groups.flatMap((group) =>
          group.accounts.map((account) => (
            <View key={account.id} style={s.channel}>
              <Text style={s.channelName}>
                {(needsBankName(account.channel)
                  ? `${group.label} · ${account.bank_name}`
                  : group.label
                ).toUpperCase()}
              </Text>
              <Text style={s.channelNumber}>{account.account_number}</Text>
              <Text style={s.channelLine}>{account.account_name}</Text>
            </View>
          )),
        )}
      </View>
    </Section>
  );
}

/** Signature blocks — used by the rental agreement (Spec 4.5). */
export function SignatureBlocks({
  blocks,
}: {
  blocks: readonly { role: string; name?: string }[];
}) {
  return (
    <View style={s.signatures} wrap={false}>
      {blocks.map((block) => (
        <View key={block.role} style={s.signature}>
          <View style={s.signatureLine}>
            <Text style={s.metaValue}>{block.name || " "}</Text>
            <Text style={s.metaLabel}>{block.role}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Footer ─────────────────────────────────────────────────────
export function DocumentFooter({ note }: { note: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>{note}</Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}
