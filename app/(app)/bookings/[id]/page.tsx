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
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  canEditItems,
  canRecordReturn,
  confirmationBlockers,
} from "@/lib/bookings/status";
import { RETURN_CONDITION_LABELS } from "@/lib/bookings/returns";
import { deliveryFeeLabel, documentTotals, lineTotal } from "@/lib/documents/totals";
import { formatCalendarDate, formatDateTime } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import { summarisePayments } from "@/lib/payments/totals";
import { createClient } from "@/lib/supabase/server";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { buttonClasses } from "@/components/ui/button";
import { BookingStatusActions, ReturnForm, type ReturnLine } from "../booking-actions";
import { AgreementCard } from "../agreement-card";
import { PaymentsCard, type PaymentRow } from "../payments-card";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requirePermission("bookings.view");

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "*, customers(id, name, phone, address), quotations(id, quotation_number)",
    )
    .eq("id", id)
    .single();

  if (!booking) notFound();

  const [
    { data: items },
    business,
    paymentAccounts,
    { data: agreement },
    { data: payments },
  ] = await Promise.all([
      supabase
        .from("booking_items")
        .select("*, catalog_items(replacement_value_centavos)")
        .eq("booking_id", id)
        .order("sort_order", { ascending: true }),
      getBusinessSettings(),
      getPaymentAccounts(),
      supabase
        .from("rental_agreements")
        .select("*")
        .eq("booking_id", id)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("*")
        .eq("booking_id", id)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

  const lines = items ?? [];
  const priced = lines.filter((line) => !line.is_component);
  const components = lines.filter((line) => line.is_component);

  const totals = documentTotals({
    lines: priced,
    within_free_delivery_area: booking.within_free_delivery_area,
    delivery_fee_centavos: booking.delivery_fee_centavos,
    discount_centavos: booking.discount_centavos,
    downpayment_percent: booking.downpayment_percent,
  });

  // Verified payments only — a pending GCash claim counts toward
  // nothing until the Owner has seen it in the account (Spec 4.7).
  const summary = summarisePayments(payments ?? [], totals.total_centavos);
  const blockers = confirmationBlockers({
    agreement_signed: booking.agreement_signed,
    verified_paid_centavos: summary.verified_centavos,
    total_centavos: totals.total_centavos,
    downpayment_percent: booking.downpayment_percent,
  });

  const canManage = can(profile, "bookings.manage");
  // Staff-only: the agreement PDF prints the payment channels, so an
  // empty list means it goes to the client cash-only.
  const channelsWarning = can(profile, "bookings.manage")
    ? missingChannelsWarning(paymentAccounts)
    : null;
  const canDeliver = can(profile, "delivery.update");
  const customer = booking.customers;

  const returnLines: ReturnLine[] = priced
    .filter((line) => line.line_type !== "damage_charge")
    .map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      replacement_value_centavos:
        line.catalog_items?.replacement_value_centavos ?? 0,
      return_condition: line.return_condition,
      return_notes: line.return_notes,
      damaged_quantity: line.damaged_quantity,
      lost_quantity: line.lost_quantity,
    }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="space-y-2">
        <Link
          href="/bookings"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← All bookings
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tabular text-2xl font-bold tracking-tight text-ink-900">
                {booking.booking_number}
              </h1>
              <Badge tone={BOOKING_STATUS_TONES[booking.status]}>
                {BOOKING_STATUS_LABELS[booking.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {formatCalendarDate(booking.event_date)}
              {booking.occasion ? ` · ${booking.occasion}` : ""} · for{" "}
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

          {canManage && canEditItems(booking.status) && (
            <Link
              href={`/bookings/${booking.id}/edit`}
              className={buttonClasses("secondary")}
            >
              Edit
            </Link>
          )}
        </div>
      </header>

      {booking.status === "cancelled" && booking.cancellation_reason && (
        <Banner tone="error">
          Cancelled — {booking.cancellation_reason}
        </Banner>
      )}

      {channelsWarning && <Banner tone="warning">{channelsWarning}</Banner>}

      {booking.confirmation_override_reason && (
        <Banner tone="warning">
          Confirmed by owner override — {booking.confirmation_override_reason}
        </Banner>
      )}

      {booking.availability_override_reason && (
        <Banner tone="warning">
          Booked past available stock — {booking.availability_override_reason}
        </Banner>
      )}

      {booking.quotations && (
        <p className="text-sm text-ink-600">
          Converted from{" "}
          <Link
            href={`/quotations/${booking.quotations.id}`}
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {booking.quotations.quotation_number}
          </Link>
        </p>
      )}

      {(canManage || canDeliver) && (
        <BookingStatusActions
          bookingId={booking.id}
          status={booking.status}
          isOwner={profile.role === "owner"}
          confirmationBlockers={blockers}
        />
      )}

      {/* ── Items ────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Items" description={`${priced.length} lines.`} />
        {priced.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {priced.map((line) => {
              const parts = components.filter(
                (component) => component.parent_item_id === line.id,
              );

              return (
                <li key={line.id} className="px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="font-medium text-ink-900">
                      {line.description}
                      {line.line_type === "damage_charge" && (
                        <span className="ml-2">
                          <Badge tone="danger">Damage charge</Badge>
                        </span>
                      )}
                    </p>
                    <p className="tabular font-bold text-ink-900">
                      {formatPeso(lineTotal(line))}
                    </p>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {line.quantity} × {formatPeso(line.unit_price_centavos)}
                    {line.line_discount_centavos > 0 &&
                      ` · less ${formatPeso(line.line_discount_centavos)}`}
                  </p>

                  {parts.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-l-2 border-brand-200 pl-3">
                      {parts.map((part) => (
                        <li key={part.id} className="text-xs text-ink-500">
                          {part.quantity} × {part.description}
                          {part.consumes_stock ? " (used up)" : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  {line.return_condition !== "pending" && (
                    <p className="mt-1 text-xs text-ink-500">
                      Returned: {RETURN_CONDITION_LABELS[line.return_condition]}
                      {line.damaged_quantity > 0 &&
                        ` · ${line.damaged_quantity} damaged`}
                      {line.lost_quantity > 0 && ` · ${line.lost_quantity} lost`}
                      {line.return_notes && ` — ${line.return_notes}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-ink-500 sm:px-6">
            No items on this booking.
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
                  booking.within_free_delivery_area,
                  business?.free_delivery_area ?? "",
                )}
              </dt>
              <dd className="tabular font-semibold text-ink-900">
                {booking.within_free_delivery_area
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
              label={`${booking.downpayment_percent}% downpayment to confirm`}
              value={totals.downpayment_centavos}
            />
            <Money
              label="Verified payments"
              value={summary.verified_centavos}
            />
            <Money label="Balance due" value={summary.balance_centavos} />
          </dl>
        </CardBody>
      </Card>

      {/* ── Return sheet ─────────────────────────────────────── */}
      {canDeliver && canRecordReturn(booking.status) && returnLines.length > 0 && (
        <ReturnForm bookingId={booking.id} lines={returnLines} />
      )}

      {/* ── Agreement and payments (Spec 4.5, 4.7) ──────────── */}
      <AgreementCard
        bookingId={booking.id}
        agreement={
          agreement
            ? {
                id: agreement.id,
                agreement_number: agreement.agreement_number,
                status: agreement.status,
                sent_at: agreement.sent_at,
                signed_at: agreement.signed_at,
                signed_by_name: agreement.signed_by_name,
                has_signed_copy: Boolean(agreement.signed_copy_path),
              }
            : null
        }
        canManage={canManage}
      />

      <PaymentsCard
        bookingId={booking.id}
        payments={(payments ?? []) as PaymentRow[]}
        summary={summary}
        totalCentavos={totals.total_centavos}
        downpaymentCentavos={totals.downpayment_centavos}
        canRecord={can(profile, "payments.record")}
        isOwner={profile.role === "owner"}
      />

      {/* ── Details ──────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Schedule and delivery" />
        <DetailList>
          <Detail
            label="Event date"
            value={formatCalendarDate(booking.event_date)}
          />
          <Detail
            label="Event time"
            value={
              booking.event_start_time
                ? `${booking.event_start_time}${booking.event_end_time ? ` – ${booking.event_end_time}` : ""}`
                : null
            }
          />
          <Detail
            label="Delivery"
            value={
              booking.delivery_at ? formatDateTime(booking.delivery_at) : null
            }
          />
          <Detail
            label="Pickup / return"
            value={booking.pickup_at ? formatDateTime(booking.pickup_at) : null}
          />
          <Detail
            label="Backdrop setup"
            value={booking.setup_at ? formatDateTime(booking.setup_at) : null}
          />
          <Detail
            label="Teardown"
            value={
              booking.teardown_at ? formatDateTime(booking.teardown_at) : null
            }
          />
          <Detail
            label="Stock held"
            value={`${formatCalendarDate(booking.reserved_from)} – ${formatCalendarDate(booking.reserved_to)}`}
          />
          <Detail label="Address" value={booking.event_address || null} />
          <Detail label="Landmark" value={booking.landmark || null} />
          <Detail
            label="Contact on site"
            value={booking.contact_person_name || null}
          />
          <Detail
            label="Their number"
            value={booking.contact_person_phone || null}
            href={
              booking.contact_person_phone
                ? `tel:${booking.contact_person_phone}`
                : undefined
            }
          />
          <Detail
            label="Customer number"
            value={customer?.phone ?? null}
            href={customer?.phone ? `tel:${customer.phone}` : undefined}
          />
        </DetailList>
      </Card>

      {(booking.theme_motif ||
        booking.celebrant_name ||
        booking.reference_photo_urls.length > 0) && (
        <Card>
          <CardHeader
            title="Backdrop brief"
            description="What the styling crew needs before they load the van."
          />
          <DetailList>
            <Detail label="Theme / motif" value={booking.theme_motif || null} />
            <Detail label="Celebrant" value={booking.celebrant_name || null} />
          </DetailList>
          {booking.reference_photo_urls.length > 0 && (
            <CardBody className="space-y-1 border-t border-ink-200">
              <p className="text-sm font-medium text-ink-700">
                Reference photos
              </p>
              {booking.reference_photo_urls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-medium text-brand-700 underline underline-offset-2"
                >
                  {url}
                </a>
              ))}
            </CardBody>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Notes and history" />
        <DetailList>
          <Detail label="Notes" value={booking.notes || null} />
          <Detail
            label="Internal notes"
            value={canManage ? booking.internal_notes || null : null}
          />
          <Detail
            label="Delivery fee reason"
            value={booking.delivery_fee_override_reason || null}
          />
          <Detail
            label="Reserved"
            value={
              booking.reserved_at ? formatDateTime(booking.reserved_at) : null
            }
          />
          <Detail
            label="Confirmed"
            value={
              booking.confirmed_at ? formatDateTime(booking.confirmed_at) : null
            }
          />
          <Detail
            label="Delivered"
            value={
              booking.delivered_at ? formatDateTime(booking.delivered_at) : null
            }
          />
          <Detail
            label="Items back"
            value={
              booking.returned_at ? formatDateTime(booking.returned_at) : null
            }
          />
          <Detail label="Created" value={formatDateTime(booking.created_at)} />
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
