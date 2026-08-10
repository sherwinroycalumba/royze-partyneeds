import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/card";
import { CreateSupplierPanel } from "./suppliers-manager";
import { SuppliersList } from "./suppliers-list";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const profile = await requirePermission("suppliers.view");
  const canManage = can(profile, "suppliers.manage");

  const supabase = await createClient();
  const { data: suppliers, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Suppliers
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Where stock and equipment come from. Restocks and expenses link back
          here, so each supplier&rsquo;s purchase history builds up over time.
        </p>
      </header>

      {canManage && <CreateSupplierPanel />}

      {error && (
        <Banner tone="error">Could not load suppliers: {error.message}</Banner>
      )}

      <SuppliersList suppliers={suppliers ?? []} />
    </div>
  );
}
