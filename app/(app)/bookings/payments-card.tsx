"use client";

import { useActionState, useState } from "react";

import {
  recordPaymentAction,
  setPaymentStatusAction,
  type PaymentState,
} from "@/lib/payments/actions";
import {
  expectsReference,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
} from "@/lib/payments/methods";
import { paidPercent, type PaymentSummary } from "@/lib/payments/totals";
import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type {
  PaymentMethod,
  PaymentStatus,
} from "@/lib/supabase/database.types";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export type PaymentRow = {
  id: string;
  paid_on: string;
  amount_centavos: number;
  method: PaymentMethod;
  reference_number: string;
  status: PaymentStatus;
  rejected_reason: string;
  notes: string;
};

/**
 * Payments against a booking (Spec 4.7).
 *
 * The distinction the layout has to make obvious: verified money is
 * money the business has; pending money is a claim. Only the first
 * counts toward confirming the booking, so pending amounts are shown
 * separately rather than folded into the total paid.
 */
export function PaymentsCard({
  bookingId,
  payments,
  summary,
  totalCentavos,
  downpaymentCentavos,
  canRecord,
  isOwner,
}: {
  bookingId: string;
  payments: PaymentRow[];
  summary: PaymentSummary;
  totalCentavos: number;
  downpaymentCentavos: number;
  canRecord: boolean;
  isOwner: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [state, formAction] = useActionState<PaymentState, FormData>(
    recordPaymentAction,
    {},
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");

  const percent = paidPercent(summary.verified_centavos, totalCentavos);

  return (
    <Card>
      <CardHeader
        title="Payments"
        description={`${formatPeso(summary.verified_centavos)} verified of ${formatPeso(totalCentavos)} — ${percent}%.`}
      />

      <CardBody className="space-y-3">
        {state.error && <Banner tone="error">{state.error}</Banner>}
        {state.success && <Banner tone="success">{state.success}</Banner>}

        {/* Progress against the downpayment, which is the number that
            actually gates the booking. */}
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-ink-200"
            role="img"
            aria-label={`${percent}% of the booking is paid and verified`}
          >
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${percent}%` }}
            />
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <Row
              label="Verified"
              value={formatPeso(summary.verified_centavos)}
            />
            {summary.pending_centavos > 0 && (
              <Row
                label="Pending verification"
                value={formatPeso(summary.pending_centavos)}
                muted
              />
            )}
            <Row
              label="Downpayment needed"
              value={formatPeso(downpaymentCentavos)}
            />
            <Row
              label="Balance due"
              value={formatPeso(summary.balance_centavos)}
            />
          </dl>
        </div>

        {summary.has_pending && (
          <Banner tone="warning">
            {formatPeso(summary.pending_centavos)} is waiting on the owner to
            verify it, and does not count toward confirming this booking yet.
          </Banner>
        )}

        {payments.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {payments.map((payment) => (
              <PaymentRowView
                key={payment.id}
                payment={payment}
                isOwner={isOwner}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-500">Nothing paid yet.</p>
        )}
      </CardBody>

      {canRecord && !recording && (
        <CardFooter>
          <Button type="button" onClick={() => setRecording(true)}>
            + Record payment
          </Button>
        </CardFooter>
      )}

      {canRecord && recording && (
        <form action={formAction} className="border-t border-ink-200">
          <input type="hidden" name="booking_id" value={bookingId} />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="amount" required>
                <TextInput
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              </Field>

              <Field label="Date paid" htmlFor="paid_on" required>
                <TextInput id="paid_on" name="paid_on" type="date" required />
              </Field>
            </div>

            <Field
              label="How was it paid"
              htmlFor="method"
              hint={
                method === "cash"
                  ? "Cash is verified as soon as it is recorded."
                  : "Waits for the owner to check the account before it counts."
              }
              required
            >
              <Select
                id="method"
                name="method"
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as PaymentMethod)
                }
              >
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_METHOD_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            {expectsReference(method) && (
              <>
                <Field
                  label="Reference number"
                  htmlFor="reference_number"
                  hint="What the owner checks against the account."
                  required
                >
                  <TextInput
                    id="reference_number"
                    name="reference_number"
                    required
                  />
                </Field>

                <Field
                  label="Screenshot"
                  htmlFor="screenshot"
                  hint="Optional. Kept private."
                >
                  <input
                    id="screenshot"
                    name="screenshot"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink-800"
                  />
                </Field>
              </>
            )}

            <Field label="Notes" htmlFor="notes">
              <TextArea id="notes" name="notes" rows={2} />
            </Field>
          </CardBody>
          <CardFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRecording(false)}
            >
              Cancel
            </Button>
            <SubmitButton pendingLabel="Recording…">
              Record payment
            </SubmitButton>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={muted ? "text-ink-500" : "text-ink-600"}>{label}</dt>
      <dd
        className={`tabular font-semibold ${muted ? "text-ink-500" : "text-ink-900"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function PaymentRowView({
  payment,
  isOwner,
}: {
  payment: PaymentRow;
  isOwner: boolean;
}) {
  const [state, formAction] = useActionState<PaymentState, FormData>(
    setPaymentStatusAction,
    {},
  );
  const [rejecting, setRejecting] = useState(false);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular font-semibold text-ink-900">
            {formatPeso(payment.amount_centavos)}
          </span>
          <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>
            {PAYMENT_STATUS_LABELS[payment.status]}
          </Badge>
        </div>
        <span className="text-sm text-ink-600">
          {PAYMENT_METHOD_LABELS[payment.method]} ·{" "}
          {formatCalendarDate(payment.paid_on)}
        </span>
      </div>

      {payment.reference_number && (
        <p className="tabular mt-0.5 text-xs text-ink-500">
          Ref {payment.reference_number}
        </p>
      )}
      {payment.notes && (
        <p className="mt-0.5 text-xs text-ink-500">{payment.notes}</p>
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
