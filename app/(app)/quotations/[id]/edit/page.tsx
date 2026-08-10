import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { canEditQuotation } from "@/lib/quotations/status";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { loadBuilderData } from "../../builder-data";
import { QuotationBuilder } from "../../quotation-builder";

export const metadata: Metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission("quotations.manage");

  const supabase = await createClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single();

  if (!quotation) notFound();

  const [{ data: items }, builder] = await Promise.all([
    supabase
      .from("quotation_items")
      .select("*")
      .eq("quotation_id", id)
      .order("sort_order", { ascending: true }),
    loadBuilderData(),
  ]);

  // An accepted quotation is the record of what was agreed, so the
  // server refuses to rewrite it — say so here rather than letting
  // staff fill in a form that cannot save (Spec 4.3).
  if (!canEditQuotation(quotation.status)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Banner tone="warning">
          {quotation.quotation_number} has been accepted, so its items are
          fixed. Create a new quotation for any changes.
        </Banner>
        <Link
          href={`/quotations/${quotation.id}`}
          className={buttonClasses("secondary")}
        >
          Back to the quotation
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <Link
          href={`/quotations/${quotation.id}`}
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← {quotation.quotation_number}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">
          Edit quotation
        </h1>
      </header>

      <QuotationBuilder
        mode="edit"
        quotationId={quotation.id}
        customers={builder.customers}
        options={builder.options}
        defaults={builder.defaults}
        initial={{
          customer_id: quotation.customer_id,
          issue_date: quotation.issue_date,
          valid_until: quotation.valid_until,
          event_date: quotation.event_date,
          event_address: quotation.event_address,
          occasion: quotation.occasion,
          within_free_delivery_area: quotation.within_free_delivery_area,
          delivery_fee_centavos: quotation.delivery_fee_centavos,
          delivery_fee_override_reason: quotation.delivery_fee_override_reason,
          discount_centavos: quotation.discount_centavos,
          downpayment_percent: quotation.downpayment_percent,
          notes: quotation.notes,
          internal_notes: quotation.internal_notes,
        }}
        initialItems={items ?? []}
      />
    </div>
  );
}
