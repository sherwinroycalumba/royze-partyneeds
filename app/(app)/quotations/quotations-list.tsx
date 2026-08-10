"use client";

import Link from "next/link";

import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import {
  daysUntilExpiry,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
} from "@/lib/quotations/status";
import type { QuotationStatus } from "@/lib/supabase/database.types";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

/** One row of the quotation list, with its total already worked out. */
export type QuotationRow = {
  id: string;
  quotation_number: string;
  customer_name: string;
  customer_phone: string | null;
  /** The computed status — a lapsed "sent" quotation reads as expired. */
  status: QuotationStatus;
  issue_date: string;
  valid_until: string;
  event_date: string | null;
  occasion: string;
  total_centavos: number;
  item_count: number;
};

export function QuotationsList({
  quotations,
  today,
  statusFilter,
  truncated,
}: {
  quotations: QuotationRow[];
  today: string;
  statusFilter: QuotationStatus | null;
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(quotations, query, (quotation) => [
    quotation.quotation_number,
    quotation.customer_name,
    quotation.customer_phone,
    quotation.occasion,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="quotation-search"
        label="Search quotations"
        placeholder="Search quotation number, customer, or occasion"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={quotations.length}
        noun="quotations"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the most recent {quotations.length} quotations. Narrow the
          list with the status filter if the one you want is missing.
        </p>
      )}

      <Card>
        <CardHeader
          title={
            statusFilter
              ? `${QUOTATION_STATUS_LABELS[statusFilter]} quotations`
              : "All quotations"
          }
          description={`${quotations.length} loaded.`}
        />

        {visible.length > 0 ? (
          <ul>
            {visible.map((quotation) => (
              <li
                key={quotation.id}
                className="border-b border-ink-200 last:border-b-0"
              >
                <Link
                  href={`/quotations/${quotation.id}`}
                  className="block px-4 py-4 transition-colors hover:bg-ink-50 sm:px-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink-900">
                        {quotation.customer_name}
                      </p>
                      <Badge tone={QUOTATION_STATUS_TONES[quotation.status]}>
                        {QUOTATION_STATUS_LABELS[quotation.status]}
                      </Badge>
                    </div>
                    <p className="tabular font-bold text-ink-900">
                      {formatPeso(quotation.total_centavos)}
                    </p>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
                    <span className="tabular font-medium">
                      {quotation.quotation_number}
                    </span>
                    <span>
                      {quotation.item_count}{" "}
                      {quotation.item_count === 1 ? "item" : "items"}
                    </span>
                    {quotation.occasion && <span>{quotation.occasion}</span>}
                  </div>

                  <p className="mt-0.5 text-xs text-ink-500">
                    <ValidityNote quotation={quotation} today={today} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {quotations.length === 0
              ? statusFilter
                ? `No ${QUOTATION_STATUS_LABELS[statusFilter].toLowerCase()} quotations.`
                : "No quotations yet. Create one to price a customer’s event."
              : `No quotation matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * The one date that matters for this row: how long a live quotation has
 * left, or when a finished one was issued.
 */
function ValidityNote({
  quotation,
  today,
}: {
  quotation: QuotationRow;
  today: string;
}) {
  if (quotation.status === "sent") {
    const days = daysUntilExpiry(quotation.valid_until, today);
    if (days === 0) return <>Expires today</>;
    return (
      <>
        {days} {days === 1 ? "day" : "days"} left · valid until{" "}
        {formatCalendarDate(quotation.valid_until)}
      </>
    );
  }

  if (quotation.status === "expired") {
    return <>Expired {formatCalendarDate(quotation.valid_until)}</>;
  }

  return <>Quoted {formatCalendarDate(quotation.issue_date)}</>;
}
