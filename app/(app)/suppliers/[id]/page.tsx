import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/date";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { EditSupplierPanel } from "../suppliers-manager";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierProfilePage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const profile = await requirePermission("suppliers.view");
  const { id } = await params;

  const supabase = await createClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!supplier) {
    notFound();
  }

  const canManage = can(profile, "suppliers.manage");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <Link
          href="/suppliers"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← All suppliers
        </Link>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            {supplier.name}
          </h1>
          {!supplier.is_active && <Badge tone="danger">Archived</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-600">
          Added {formatDate(supplier.created_at)}
        </p>
      </header>

      {canManage && <EditSupplierPanel supplier={supplier} />}

      <Card>
        <CardHeader title="Details" />
        <DetailList>
          <Detail label="What they supply" value={supplier.supplies || null} />
          <Detail label="Contact person" value={supplier.contact_person} />
          <Detail
            label="Contact number"
            value={supplier.phone || null}
            href={supplier.phone ? `tel:${supplier.phone}` : undefined}
          />
          <Detail
            label="Email"
            value={supplier.email}
            href={supplier.email ? `mailto:${supplier.email}` : undefined}
          />
          <Detail label="Address" value={supplier.address || null} />
          <Detail label="Notes" value={supplier.notes || null} />
        </DetailList>
      </Card>

      <Card>
        <CardHeader
          title="Purchase history"
          description="Expenses and restocks recorded against this supplier."
        />
        <CardBody>
          <p className="py-4 text-center text-sm text-ink-500">
            No purchases recorded yet.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
