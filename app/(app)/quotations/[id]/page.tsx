import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getBusinessSettings,
  getPaymentAccounts,
  requirePermission,
} from "@/lib/auth/dal";
import { missingChannelsWarning } from "@/lib/settings/payment-accounts";
import { can } from "@/lib/auth/permissions";
import { formatCalendarDate, formatDateTime, todayInManila } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import {
  canConvertToBooking,
  canEditQuotation,
  daysUntilExpiry,
  effectiveStatus,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
} from "@/lib/quotations/status";
import {
  deliveryFeeLabel,
  lineTotal,
  documentTotals,
} from "@/lib/documents/totals";
import { createClient } from "@/lib/supabase/server";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { buttonClasses } from "@/components/ui/button";
import { StatusActions } from "../status-actions";
import { ConvertToBookingButton } from "../convert-button";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationPage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requirePermission("quotations.view");
  const canManage = can(profile, "quotations.manage");

  const supabase = await createClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("*, customers(id, name, phone, address, email)")
    .eq("id", id)
    .single();

  if (!quotation) notFound();

  const [{ data: items }, business, paymentAccounts, { data: booking }] =
    await Promise.all([
    supabase
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("sort_order", { ascending: true }),
    getBusinessSettings(),
    getPaymentAccounts(),
    // Set once this quotation has been converted (Spec 4.3).
    quotation.converted_booking_id
      ? supabase
          .from("bookings")
          .select("id, booking_number")
          .eq("id", quotation.converted_booking_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const lines = items ?? [];
  const today = todayInManila();
  const status = effectiveStatus(
    quotation.status,
    quotation.valid_until,
    today,
  );

  const totals = documentTotals({
    lines,
    within_free_delivery_area: quotation.within_free_delivery_area,
    delivery_fee_centavos: quotation.delivery_fee_centavos,
    discount_centavos: quotation.discount_centavos,
    downpayment_percent: quotation.downpayment_percent,
  });

  const customer = quotation.customers;
  const daysLeft = daysUntilExpiry(quotation.valid_until, today);
  const editable = canManage && canEditQuotation(quotation.status);
  // Shown to staff, never to the customer: the PDF still renders, but
  // it will go out with cash as the only way to pay.
  const channelsWarning = canManage
    ? missingChannelsWarning(paymentAccounts)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="space-y-2">
        <Link
          href="/quotations"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← All quotations
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tabular text-2xl font-bold tracking-tight text-ink-900">
                {quotation.quotation_number}
              </h1>
              <Badge tone={QUOTATION_STATUS_TONES[status]}>
                {QUOTATION_STATUS_LABELS[status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              For{" "}
              {customer ? (
                <Link
                  href={`/customers/${customer.id}`}
                  className="font-medium text-brand-700 underline underline-offset-2"
                >
                  {customer.name}
                </Link>
              ) : (
                "an unknown customer"
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* A real file, because staff send it on Messenger. */}
            <a
              href={`/quotations/${quotation.id}/pdf`}
              className={buttonClasses("primary")}
            >
              Download PDF
            </a>
            {editable && (
              <Link
                href={`/quotations/${quotation.id}/edit`}
                className={buttonClasses("secondary")}
              >
                Edit
              </Link>
            )}
          </div>
        </div>
      </header>

      {status === "sent" && daysLeft >= 0 && daysLeft <= 2 && (
        <Banner tone="warning">
          {daysLeft === 0
            ? "This quotation expires today."
            : `This quotation expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.`}
        </Banner>
      )}

      {channelsWarning && <Banner tone="warning">{channelsWarning}</Banner>}

      {status === "expired" && (
        <Banner tone="warning">
          Valid until {formatCalendarDate(quotation.valid_until)}. Re-send it to
          give the customer a fresh window.
        </Banner>
      )}

      {status === "accepted" && (
        <Banner tone="success">
          Accepted — convert it to a booking to reserve the items.
        </Banner>
      )}

      {booking && (
        <p className="text-sm text-ink-600">
          Converted to{" "}
          <Link
            href={`/bookings/${booking.id}`}
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {booking.booking_number}
          </Link>
        </p>
      )}

      {canManage && (
        <StatusActions quotationId={quotation.id} status={status} />
      )}

      {canManage && !booking && canConvertToBooking(status) && (
        <ConvertToBookingButton quotationId={quotation.id} />
      )}

      {/* ── Items ────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Items" description={`${lines.length} lines.`} />
        {lines.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {lines.map((line) => (
              <li key={line.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium text-ink-900">{line.description}</p>
                  <p className="tabular font-bold text-ink-900">
                    {formatPeso(lineTotal(line))}
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-ink-600">
                  {line.quantity} × {formatPeso(line.unit_price_centavos)}
                  {line.line_discount_centavos > 0 &&
                    ` · less ${formatPeso(line.line_discount_centavos)}`}
                </p>
                {line.component_summary && (
                  <p className="mt-0.5 text-xs text-ink-500">
                    Includes: {line.component_summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-ink-500 sm:px-6">
            No items on this quotation.
          </p>
        )}

        <CardBody className="border-t border-ink-200 bg-ink-50/60">
          <dl className="space-y-1.5 text-sm">
            <Money label="Subtotal" value={totals.subtotal_centavos} />
            {totals.discount_centavos > 0 && (
              <Money
                label="Discount"
                value={totals.discount_centavos}
                negative
              />
            )}
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-600">
                {deliveryFeeLabel(
                  quotation.within_free_delivery_area,
                  business?.free_delivery_area ?? "",
                )}
              </dt>
              <dd className="tabular font-semibold text-ink-900">
                {quotation.within_free_delivery_area
                  ? "FREE"
                  : formatPeso(totals.delivery_fee_centavos)}
              </dd>
            </div>

            <div className="flex items-baseline justify-between border-t border-ink-200 pt-2">
              <dt className="text-base font-bold text-ink-900">Total</dt>
              <dd className="tabular text-xl font-bold text-brand-700">
                {formatPeso(totals.total_centavos)}
              </dd>
            </div>
            <Money
              label={`${quotation.downpayment_percent}% downpayment to confirm`}
              value={totals.downpayment_centavos}
            />
          </dl>
        </CardBody>
      </Card>

      {/* ── Details ──────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Details" />
        <DetailList>
          <Detail
            label="Quotation date"
            value={formatCalendarDate(quotation.issue_date)}
          />
          <Detail
            label="Valid until"
            value={formatCalendarDate(quotation.valid_until)}
          />
          <Detail
            label="Event date"
            value={
              quotation.event_date
                ? formatCalendarDate(quotation.event_date)
                : null
            }
          />
          <Detail label="Occasion" value={quotation.occasion || null} />
          <Detail
            label="Delivery address"
            value={quotation.event_address || null}
          />
          <Detail label="Customer" value={customer?.name ?? null} />
          <Detail
            label="Contact number"
            value={customer?.phone ?? null}
            href={customer?.phone ? `tel:${customer.phone}` : undefined}
          />
          <Detail
            label="Delivery fee reason"
            value={quotation.delivery_fee_override_reason || null}
          />
          <Detail label="Notes" value={quotation.notes || null} />
          <Detail
            label="Internal notes"
            value={quotation.internal_notes || null}
          />
          <Detail
            label="Sent"
            value={quotation.sent_at ? formatDateTime(quotation.sent_at) : null}
          />
          <Detail
            label="Answered"
            value={
              quotation.decided_at ? formatDateTime(quotation.decided_at) : null
            }
          />
          <Detail label="Created" value={formatDateTime(quotation.created_at)} />
        </DetailList>
      </Card>
    </div>
  );
}

function Money({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular font-semibold text-ink-900">
        {negative ? "−" : ""}
        {formatPeso(value)}
      </dd>
    </div>
  );
}
