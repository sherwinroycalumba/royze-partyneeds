import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { PricedComponent } from "@/lib/catalog/packages";
import { Banner } from "@/components/ui/card";
import { CreatePackagePanel } from "./package-manager";
import { PackagesList } from "./packages-list";
import type { ComponentKind } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Backdrop Packages" };

/** A package with its bill of components resolved to catalog prices. */
export type PackageWithComponents = {
  id: string;
  name: string;
  description: string;
  photo_url: string | null;
  occasion_tags: string[];
  package_price_centavos: number;
  setup_minutes: number;
  teardown_notes: string;
  is_active: boolean;
  components: (PricedComponent & {
    catalog_item_id: string;
  })[];
};

/** Bare catalog item, for the component pickers. */
export type ComponentOption = {
  id: string;
  name: string;
  is_rental: boolean;
  is_sale: boolean;
  rental_price_centavos: number;
  sale_price_centavos: number;
};

type ComponentRow = {
  catalog_item_id: string;
  quantity: number;
  kind: ComponentKind;
  consumes_stock: boolean;
  sort_order: number;
  catalog_items: {
    name: string;
    rental_price_centavos: number;
    sale_price_centavos: number;
  } | null;
};

export default async function PackagesPage() {
  const profile = await requirePermission("catalog.view");
  const canManage = can(profile, "catalog.manage");

  const supabase = await createClient();

  const [{ data: packages, error }, { data: items }] = await Promise.all([
    supabase
      .from("backdrop_packages")
      .select(
        `id, name, description, photo_url, occasion_tags, package_price_centavos,
         setup_minutes, teardown_notes, is_active,
         backdrop_package_components (
           catalog_item_id, quantity, kind, consumes_stock, sort_order,
           catalog_items ( name, rental_price_centavos, sale_price_centavos )
         )`,
      )
      .order("is_active", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("catalog_items")
      .select("id, name, is_rental, is_sale, rental_price_centavos, sale_price_centavos")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const resolved: PackageWithComponents[] = (packages ?? []).map((row) => {
    const components: ComponentRow[] = row.backdrop_package_components ?? [];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      photo_url: row.photo_url,
      occasion_tags: row.occasion_tags,
      package_price_centavos: row.package_price_centavos,
      setup_minutes: row.setup_minutes,
      teardown_notes: row.teardown_notes,
      is_active: row.is_active,
      components: [...components]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((component) => ({
          catalog_item_id: component.catalog_item_id,
          name: component.catalog_items?.name ?? "Removed item",
          quantity: component.quantity,
          kind: component.kind,
          consumes_stock: component.consumes_stock,
          // Consumables are bought and used up, so they are worth their
          // sale price; everything else is worth its rental price.
          unit_centavos: component.consumes_stock
            ? (component.catalog_items?.sale_price_centavos ?? 0)
            : (component.catalog_items?.rental_price_centavos ?? 0),
        })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Backdrop Packages
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Styled setups priced as a bundle. Rental components are reserved for
          the event dates; consumables come out of sale stock.
        </p>
      </header>

      {canManage && (
        <CreatePackagePanel options={items ?? []} />
      )}

      {error && (
        <Banner tone="error">Could not load packages: {error.message}</Banner>
      )}

      <PackagesList
        packages={resolved}
        options={items ?? []}
        canManage={canManage}
      />
    </div>
  );
}
