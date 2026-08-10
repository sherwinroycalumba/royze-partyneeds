import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { todayInManila } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/card";
import { PointOfSale, type SaleItem } from "./pos";

export const metadata: Metadata = { title: "New sale" };

export default async function NewOrderPage() {
  await requirePermission("orders.manage");

  const supabase = await createClient();

  // Only sale items — a monoblock chair is rented, not sold over the
  // counter, and offering it here would only slow the search down.
  const [{ data: items }, { data: customers }] = await Promise.all([
    supabase
      .from("catalog_items")
      .select("id, name, category, sale_price_centavos, stock_quantity, low_stock_threshold")
      .eq("is_active", true)
      .eq("is_sale", true)
      .order("name", { ascending: true }),
    supabase
      .from("customers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const saleItems: SaleItem[] = (items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    sale_price_centavos: item.sale_price_centavos,
    stock_quantity: item.stock_quantity,
    low_stock_threshold: item.low_stock_threshold,
  }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          New sale
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Tap an item, pick how it was paid, done. Stock comes off straight
          away.
        </p>
      </header>

      {saleItems.length === 0 ? (
        <Banner tone="warning">
          Nothing in the catalog is marked as a sale item yet, so there is
          nothing to sell. Mark items as “for sale” under Price Catalog.
        </Banner>
      ) : (
        <PointOfSale
          items={saleItems}
          customers={customers ?? []}
          today={todayInManila()}
        />
      )}
    </div>
  );
}
