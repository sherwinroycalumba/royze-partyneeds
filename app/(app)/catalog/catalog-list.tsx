"use client";

import type { CatalogItem } from "@/lib/supabase/database.types";
import { itemTypeLabel } from "@/lib/catalog/items";
import { Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";
import { ItemRow } from "./catalog-manager";

/** Catalog list with inline search (Spec 4.2). */
export function CatalogList({
  items,
  archived,
  canManage,
  canSeeCost,
}: {
  items: CatalogItem[];
  archived: boolean;
  canManage: boolean;
  canSeeCost: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(items, query, (item) => [
    item.name,
    item.category,
    item.description,
    // Lets staff type "rental" or "sale" to narrow by type.
    itemTypeLabel(item),
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="catalog-search"
        label="Search the catalog"
        placeholder="Search name, category, or description"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={items.length}
        noun="items"
      />

      <Card>
        <CardHeader
          title={archived ? "Archived items" : "Items"}
          description={`${items.length} loaded.${
            canManage
              ? " Items are archived, never deleted, so past bookings keep their prices."
              : ""
          }`}
        />
        {visible.length > 0 ? (
          <ul>
            {visible.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                canManage={canManage}
                canSeeCost={canSeeCost}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {items.length === 0
              ? archived
                ? "No archived items."
                : "The catalog is empty. Add your first item above."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
