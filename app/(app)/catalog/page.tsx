import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { stockStatus } from "@/lib/catalog/items";
import { Banner } from "@/components/ui/card";
import { CreateItemPanel } from "./catalog-manager";
import { CatalogFilters } from "./catalog-filters";
import { CatalogList } from "./catalog-list";

export const metadata: Metadata = { title: "Price Catalog" };

type Search = {
  type?: string;
  status?: string;
};

/** Spec 4.2 — rentals, sale items, and the items that are both. */
export default async function CatalogPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<Search>;
}) {
  const profile = await requirePermission("catalog.view");
  const { type = "all", status = "active" } = await searchParams;

  const canManage = can(profile, "catalog.manage");
  // Cost price is owner/bookkeeper-only (Spec 4.2).
  const canSeeCost = profile.role === "owner" || profile.role === "bookkeeper";

  const supabase = await createClient();
  let query = supabase
    .from("catalog_items")
    .select("*")
    .eq("is_active", status !== "archived")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (type === "rental") query = query.eq("is_rental", true);
  if (type === "sale") query = query.eq("is_sale", true);

  const { data: items, error } = await query;

  // Drawn from the whole loaded slice, not the inline-filtered view, so
  // the count never reads as "these are all the low items".
  const lowStock =
    status === "active" && type === "all"
      ? (items ?? []).filter((item) => {
          const state = stockStatus(item);
          return state === "low" || state === "out";
        })
      : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Price Catalog
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Rental equipment and party supplies. An item can be both — a table
          cover can be rented out and also sold.
        </p>
      </header>

      {canManage && <CreateItemPanel canSeeCost={canSeeCost} />}

      <CatalogFilters type={type} status={status} />

      {error && (
        <Banner tone="error">Could not load the catalog: {error.message}</Banner>
      )}

      {lowStock.length > 0 && (
        <Banner tone="warning">
          {lowStock.length} sale{" "}
          {lowStock.length === 1 ? "item is" : "items are"} at or below the
          low-stock threshold: {lowStock.map((item) => item.name).join(", ")}.
        </Banner>
      )}

      <CatalogList
        items={items ?? []}
        archived={status === "archived"}
        canManage={canManage}
        canSeeCost={canSeeCost}
      />
    </div>
  );
}
