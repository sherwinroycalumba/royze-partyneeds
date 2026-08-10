import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/date";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { EditCustomerPanel } from "../customers-manager";

export const metadata: Metadata = { title: "Customer" };

/**
 * Sections that fill in as later milestones land. Showing them empty is
 * deliberate: staff learn where a customer's history will live, and the
 * page does not silently change shape later.
 */
function PendingSection({
  title,
  description,
  emptyText,
}: {
  title: string;
  description: string;
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <p className="py-4 text-center text-sm text-ink-500">{emptyText}</p>
      </CardBody>
    </Card>
  );
}

export default async function CustomerProfilePage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const profile = await requirePermission("customers.view");
  const { id } = await params;

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!customer) {
    notFound();
  }

  const canManage = can(profile, "customers.manage");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <Link
          href="/customers"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← All customers
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">
              {customer.name}
            </h1>
            {!customer.is_active && <Badge tone="danger">Archived</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-600">
            Customer since {formatDate(customer.created_at)}
          </p>
        </div>
      </header>

      {canManage && <EditCustomerPanel customer={customer} />}

      <Card>
        <CardHeader title="Details" />
        <DetailList>
          <Detail
            label="Contact number"
            value={customer.phone || null}
            href={customer.phone ? `tel:${customer.phone}` : undefined}
          />
          <Detail
            label="Other number"
            value={customer.alt_phone}
            href={customer.alt_phone ? `tel:${customer.alt_phone}` : undefined}
          />
          <Detail
            label="Email"
            value={customer.email}
            href={customer.email ? `mailto:${customer.email}` : undefined}
          />
          <Detail label="Facebook name" value={customer.facebook_name} />
          <Detail
            label="Facebook profile"
            value={customer.facebook_url}
            href={customer.facebook_url ?? undefined}
          />
          <Detail label="Address" value={customer.address || null} />
          <Detail label="Landmark" value={customer.landmark} />
          <Detail label="Notes" value={customer.notes || null} />
        </DetailList>
      </Card>

      <PendingSection
        title="Bookings & quotations"
        description="Every booking, quotation, and order for this customer."
        emptyText="No bookings yet."
      />

      <PendingSection
        title="Payments & balance"
        description="Verified payments and any outstanding balance."
        emptyText="No payments recorded yet."
      />

      <PendingSection
        title="Damage & loss incidents"
        description="Items returned damaged or lost, charged at replacement value."
        emptyText="No incidents recorded."
      />
    </div>
  );
}
