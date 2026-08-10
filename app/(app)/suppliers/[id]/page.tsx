import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCalendarDate, formatDate } from "@/lib/date";
import { formatPeso, sumCentavos } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments/methods";
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

  // Only the Owner and Bookkeeper may see spending at all, so Booking
  // Staff get the directory entry without the money (Spec 3).
  const { data: expenses } = can(profile, "expenses.categorize")
    ? await supabase
        .from("expenses")
        .select("*")
        .eq("supplier_id", id)
        .order("expense_date", { ascending: false })
        .limit(100)
    : { data: null };

  const purchases = expenses ?? [];
  const spent = sumCentavos(
    purchases.map((expense) => expense.amount_centavos),
  );

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
          description={
            purchases.length > 0
              ? `${purchases.length} recorded · ${formatPeso(spent)} total`
              : "Expenses recorded against this supplier."
          }
        />
        {purchases.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {purchases.map((expense) => (
              <li key={expense.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-ink-900">
                    {expense.category || "Uncategorised"}
                  </span>
                  <span className="tabular font-bold text-ink-900">
                    {formatPeso(expense.amount_centavos)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-ink-600">
                  {formatCalendarDate(expense.expense_date)}
                  {expense.method
                    ? ` · ${PAYMENT_METHOD_LABELS[expense.method]}`
                    : ""}
                  {expense.is_paid ? "" : " · unpaid"}
                </p>
                {expense.notes && (
                  <p className="mt-0.5 text-xs text-ink-500">{expense.notes}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="py-4 text-center text-sm text-ink-500">
              No purchases recorded yet.
            </p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
