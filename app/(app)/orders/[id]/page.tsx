import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { canVoid, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/lib/orders/status";
import { orderTotals } from "@/lib/orders/totals";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
} from "@/lib/payments/methods";
import { summarisePayments } from "@/lib/payments/totals";
import { lineTotal } from "@/lib/documents/totals";
import { formatCalendarDate, formatDateTime } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { VoidOrderButton } from "../void-button";

export const metadata: Metadata = { title: "Sale" };

export default async function OrderPage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requirePermission("quotations.view");

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*, customers(id, name, phone), order_items(*), payments(*)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const lines = order.order_items ?? [];
  const totals = orderTotals({
    lines,
    discount_centavos: order.discount_centavos,
  });
  const summary = summarisePayments(order.payments ?? [], totals.total_centavos);
  const isOwner = profile.role === "owner";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="space-y-2">
        <Link
          href="/orders"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← All sales
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="tabular text-2xl font-bold tracking-tight text-ink-900">
            {order.order_number}
          </h1>
          <Badge tone={ORDER_STATUS_TONES[order.status]}>
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </div>

        <p className="text-sm text-ink-600">
          {formatCalendarDate(order.sold_on)} ·{" "}
          {order.customers ? (
            <Link
              href={`/customers/${order.customers.id}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {order.customers.name}
            </Link>
          ) : (
            order.customer_label
          )}
        </p>
      </header>

      {order.status === "voided" && (
        <Banner tone="error">
          Voided {order.voided_at ? formatDateTime(order.voided_at) : ""} —{" "}
          {order.voided_reason}. The stock went back on the shelf.
        </Banner>
      )}

      <Card>
        <CardHeader title="Items" description={`${lines.length} lines.`} />
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
            </li>
          ))}
        </ul>

        <CardBody className="border-t border-ink-200 bg-ink-50/60">
          <dl className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatPeso(totals.subtotal_centavos)} />
            {totals.discount_centavos > 0 && (
              <Row
                label="Discount"
                value={`−${formatPeso(totals.discount_centavos)}`}
              />
            )}
            <div className="flex items-baseline justify-between border-t border-ink-200 pt-2">
              <dt className="text-base font-bold text-ink-900">Total</dt>
              <dd className="tabular text-xl font-bold text-brand-700">
                {formatPeso(totals.total_centavos)}
              </dd>
            </div>
            <Row
              label="Verified payments"
              value={formatPeso(summary.verified_centavos)}
            />
            {summary.pending_centavos > 0 && (
              <Row
                label="Pending verification"
                value={formatPeso(summary.pending_centavos)}
              />
            )}
            <Row
              label="Balance due"
              value={formatPeso(summary.balance_centavos)}
            />
          </dl>
        </CardBody>
      </Card>

      {summary.has_pending && (
        <Banner tone="warning">
          This sale was paid by e-wallet or transfer and is waiting on the owner
          to verify it against the account.
        </Banner>
      )}

      <Card>
        <CardHeader title="Payment" />
        {(order.payments ?? []).length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {(order.payments ?? []).map((payment) => (
              <li key={payment.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular font-semibold text-ink-900">
                    {formatPeso(payment.amount_centavos)}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink-600">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                    </span>
                    <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>
                      {PAYMENT_STATUS_LABELS[payment.status]}
                    </Badge>
                  </div>
                </div>
                {payment.reference_number && (
                  <p className="tabular mt-0.5 text-xs text-ink-500">
                    Ref {payment.reference_number}
                  </p>
                )}
                {payment.rejected_reason && (
                  <p className="mt-0.5 text-xs text-danger-600">
                    {payment.rejected_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-500">No payment recorded.</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Details" />
        <DetailList>
          <Detail label="Sale number" value={order.order_number} />
          <Detail label="Sold on" value={formatCalendarDate(order.sold_on)} />
          <Detail label="Customer" value={order.customer_label} />
          <Detail
            label="Contact"
            value={order.customers?.phone ?? null}
            href={
              order.customers?.phone ? `tel:${order.customers.phone}` : undefined
            }
          />
          <Detail label="Notes" value={order.notes || null} />
          <Detail label="Recorded" value={formatDateTime(order.created_at)} />
        </DetailList>
      </Card>

      {isOwner && canVoid(order.status) && (
        <VoidOrderButton orderId={order.id} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular font-semibold text-ink-900">{value}</dd>
    </div>
  );
}
