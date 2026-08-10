import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import {
  isPaymentMethod,
  isPaymentStatus,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/payments/methods";
import { sumCentavos } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { PaymentsLedger, type LedgerRow } from "./payments-ledger";

export const metadata: Metadata = { title: "Payments" };

const ROW_CAP = 500;

export default async function PaymentsPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{
    status?: string;
    method?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const profile = await requirePermission("quotations.view");
  const {
    status = "pending",
    method = "all",
    from,
    to,
  } = await searchParams;

  const supabase = await createClient();

  let query = supabase
    .from("payments")
    .select("*, bookings(id, booking_number, customers(name))")
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);

  if (isPaymentStatus(status)) query = query.eq("status", status);
  if (isPaymentMethod(method)) query = query.eq("method", method);
  if (from && isCalendarDate(from)) query = query.gte("paid_on", from);
  if (to && isCalendarDate(to)) query = query.lte("paid_on", to);

  const { data, error } = await query;

  const rows: LedgerRow[] = (data ?? []).map((payment) => ({
    id: payment.id,
    booking_id: payment.bookings?.id ?? null,
    booking_number: payment.bookings?.booking_number ?? "—",
    customer_name: payment.bookings?.customers?.name ?? "—",
    paid_on: payment.paid_on,
    amount_centavos: payment.amount_centavos,
    method: payment.method,
    reference_number: payment.reference_number,
    status: payment.status,
    rejected_reason: payment.rejected_reason,
    notes: payment.notes,
  }));

  // Only verified money is money; the shown total says which is which.
  const verifiedTotal = sumCentavos(
    rows
      .filter((row) => row.status === "verified")
      .map((row) => row.amount_centavos),
  );
  const pendingTotal = sumCentavos(
    rows
      .filter((row) => row.status === "pending")
      .map((row) => row.amount_centavos),
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Payments
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Cash is verified on sight. GCash, Maya, and bank transfers wait here
          until the owner has checked the account.
        </p>
      </header>

      <form
        action="/payments"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <div>
          <label htmlFor="payment-status" className="sr-only">
            Status
          </label>
          <select
            id="payment-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="all">All statuses</option>
            {(["pending", "verified", "rejected"] as const).map((value) => (
              <option key={value} value={value}>
                {PAYMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="payment-method" className="sr-only">
            Method
          </label>
          <select
            id="payment-method"
            name="method"
            defaultValue={method}
            className={inputClasses}
          >
            <option value="all">All methods</option>
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="payment-from" className="sr-only">
            Paid from
          </label>
          <input
            id="payment-from"
            name="from"
            type="date"
            defaultValue={from ?? ""}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="payment-to" className="sr-only">
            Paid to
          </label>
          <input
            id="payment-to"
            name="to"
            type="date"
            defaultValue={to ?? todayInManila()}
            className={inputClasses}
          />
        </div>

        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load payments: {error.message}</Banner>
      )}

      <PaymentsLedger
        payments={rows}
        verifiedTotal={verifiedTotal}
        pendingTotal={pendingTotal}
        isOwner={profile.role === "owner"}
        truncated={rows.length === ROW_CAP}
      />
    </div>
  );
}
