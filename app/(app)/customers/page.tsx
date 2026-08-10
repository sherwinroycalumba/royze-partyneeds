import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { Banner } from "@/components/ui/card";
import { CreateCustomerPanel } from "./customers-manager";
import { CustomersList } from "./customers-list";

export const metadata: Metadata = { title: "Customers" };

/** How many rows the inline search filters over. */
const ROW_CAP = 500;

export default async function CustomersPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await requirePermission("customers.view");
  const { status = "active" } = await searchParams;

  const canManage = can(profile, "customers.manage");

  const supabase = await createClient();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("is_active", status !== "archived")
    .order("name", { ascending: true })
    .limit(ROW_CAP);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Customers
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          One record per customer, so their bookings, payments, and any damage
          incidents all hang together.
        </p>
      </header>

      {canManage && <CreateCustomerPanel />}

      {/* Active vs archived changes which rows are loaded, so it stays a
          server round trip; the text search filters what came back. */}
      <form action="/customers" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="customer-status" className="sr-only">
            Status
          </label>
          <select
            id="customer-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="active">Active customers</option>
            <option value="archived">Archived customers</option>
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load customers: {error.message}</Banner>
      )}

      <CustomersList
        customers={customers ?? []}
        archived={status === "archived"}
        truncated={(customers?.length ?? 0) === ROW_CAP}
      />
    </div>
  );
}
