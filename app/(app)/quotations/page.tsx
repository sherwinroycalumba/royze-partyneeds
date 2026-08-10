import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { todayInManila } from "@/lib/date";
import {
  effectiveStatus,
  isQuotationStatus,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
} from "@/lib/quotations/status";
import { documentTotals } from "@/lib/documents/totals";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { QuotationsList, type QuotationRow } from "./quotations-list";

export const metadata: Metadata = { title: "Quotations" };

/** How many rows the inline search filters over. */
const ROW_CAP = 500;

export default async function QuotationsPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await requirePermission("quotations.view");
  const { status = "all" } = await searchParams;

  const canManage = can(profile, "quotations.manage");
  const today = todayInManila();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotations")
    .select(
      "*, customers(name, phone), quotation_items(quantity, unit_price_centavos, line_discount_centavos)",
    )
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);

  // Expiry is derived, not stored, so the filter has to run over the
  // computed status — otherwise "Expired" would match nothing and
  // "Sent" would list quotations that lapsed last week.
  const rows: QuotationRow[] = (data ?? []).map((quotation) => {
    const totals = documentTotals({
      lines: quotation.quotation_items ?? [],
      within_free_delivery_area: quotation.within_free_delivery_area,
      delivery_fee_centavos: quotation.delivery_fee_centavos,
      discount_centavos: quotation.discount_centavos,
      downpayment_percent: quotation.downpayment_percent,
    });

    return {
      id: quotation.id,
      quotation_number: quotation.quotation_number,
      customer_name: quotation.customers?.name ?? "—",
      customer_phone: quotation.customers?.phone ?? null,
      status: effectiveStatus(quotation.status, quotation.valid_until, today),
      issue_date: quotation.issue_date,
      valid_until: quotation.valid_until,
      event_date: quotation.event_date,
      occasion: quotation.occasion,
      total_centavos: totals.total_centavos,
      item_count: quotation.quotation_items?.length ?? 0,
    };
  });

  const filtered = isQuotationStatus(status)
    ? rows.filter((row) => row.status === status)
    : rows;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Quotations
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Price a customer&rsquo;s event, send them a PDF, and turn the ones
            they accept into bookings.
          </p>
        </div>

        {canManage && (
          <Link href="/quotations/new" className={buttonClasses("primary")}>
            + New quotation
          </Link>
        )}
      </header>

      <form action="/quotations" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="quotation-status" className="sr-only">
            Status
          </label>
          <select
            id="quotation-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="all">All quotations</option>
            {QUOTATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {QUOTATION_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load quotations: {error.message}</Banner>
      )}

      <QuotationsList
        quotations={filtered}
        today={today}
        statusFilter={isQuotationStatus(status) ? status : null}
        truncated={rows.length === ROW_CAP}
      />
    </div>
  );
}
