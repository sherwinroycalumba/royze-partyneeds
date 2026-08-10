"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  setPaymentStatusAction,
  type PaymentState,
} from "@/lib/payments/actions";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
} from "@/lib/payments/methods";
import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type {
  PaymentMethod,
  PaymentStatus,
} from "@/lib/supabase/database.types";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type LedgerRow = {
  id: string;
  booking_id: string | null;
  booking_number: string;
  customer_name: string;
  paid_on: string;
  amount_centavos: number;
  method: PaymentMethod;
  reference_number: string;
  status: PaymentStatus;
  rejected_reason: string;
  notes: string;
};

/**
 * The payments ledger and the Owner's verification queue (Spec 4.7).
 *
 * Verified and pending totals are shown apart, never summed: one is
 * money the business has, the other is a claim that money moved.
 */
export function PaymentsLedger({
  payments,
  verifiedTotal,
  pendingTotal,
  isOwner,
  truncated,
}: {
  payments: LedgerRow[];
  verifiedTotal: number;
  pendingTotal: number;
  isOwner: boolean;
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(payments, query, (payment) => [
    payment.booking_number,
    payment.customer_name,
    payment.reference_number,
    payment.notes,
  ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">Verified in this view</p>
            <p className="tabular text-2xl font-bold text-success-700">
              {formatPeso(verifiedTotal)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">Waiting on verification</p>
            <p className="tabular text-2xl font-bold text-warning-700">
              {formatPeso(pendingTotal)}
            </p>
          </CardBody>
        </Card>
      </div>

      <ListSearch
        id="payment-search"
        label="Search payments"
        placeholder="Search booking, customer, or reference number"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={payments.length}
        noun="payments"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the most recent {payments.length}. Narrow the date range to
          see more.
        </p>
      )}

      <Card>
        <CardHeader title="Payments" description={`${payments.length} shown.`} />

        {visible.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {visible.map((payment) => (
              <LedgerRowView
                key={payment.id}
                payment={payment}
                isOwner={isOwner}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {payments.length === 0
              ? "No payments match these filters."
              : `No payment matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}

function LedgerRowView({
  payment,
  isOwner,
}: {
  payment: LedgerRow;
  isOwner: boolean;
}) {
  const [state, formAction] = useActionState<PaymentState, FormData>(
    setPaymentStatusAction,
    {},
  );
  const [rejecting, setRejecting] = useState(false);

  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular font-bold text-ink-900">
            {formatPeso(payment.amount_centavos)}
          </span>
          <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>
            {PAYMENT_STATUS_LABELS[payment.status]}
          </Badge>
          <span className="text-sm text-ink-600">
            {PAYMENT_METHOD_LABELS[payment.method]}
          </span>
        </div>
        <span className="text-sm text-ink-500">
          {formatCalendarDate(payment.paid_on)}
        </span>
      </div>

      <p className="mt-0.5 text-sm text-ink-600">
        {payment.booking_id ? (
          <Link
            href={`/bookings/${payment.booking_id}`}
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {payment.booking_number}
          </Link>
        ) : (
          payment.booking_number
        )}{" "}
        · {payment.customer_name}
      </p>

      {payment.reference_number && (
        <p className="tabular mt-0.5 text-xs text-ink-500">
          Ref {payment.reference_number}
        </p>
      )}
      {payment.status === "rejected" && payment.rejected_reason && (
        <p className="mt-0.5 text-xs text-danger-600">
          Rejected — {payment.rejected_reason}
        </p>
      )}

      {state.error && (
        <p className="mt-1 text-xs font-medium text-danger-600">{state.error}</p>
      )}

      {isOwner && payment.status === "pending" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={formAction}>
            <input type="hidden" name="payment_id" value={payment.id} />
            <input type="hidden" name="status" value="verified" />
            <SubmitButton size="sm" pendingLabel="Verifying…">
              Verify
            </SubmitButton>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRejecting((open) => !open)}
          >
            Reject
          </Button>
        </div>
      )}

      {rejecting && (
        <form action={formAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payment_id" value={payment.id} />
          <input type="hidden" name="status" value="rejected" />
          <TextInput
            name="rejected_reason"
            placeholder="Why is it being rejected?"
            required
            className="max-w-xs"
          />
          <SubmitButton variant="danger" size="sm" pendingLabel="Rejecting…">
            Reject
          </SubmitButton>
        </form>
      )}
    </li>
  );
}
