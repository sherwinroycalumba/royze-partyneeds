"use client";

import Link from "next/link";

import type { Supplier } from "@/lib/supabase/database.types";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

/** Supplier directory with inline search (Spec 4.8). */
export function SuppliersList({ suppliers }: { suppliers: Supplier[] }) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(suppliers, query, (supplier) => [
    supplier.name,
    supplier.contact_person,
    supplier.phone,
    supplier.supplies,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="supplier-search"
        label="Search suppliers"
        placeholder="Search name, contact, number, or what they supply"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={suppliers.length}
        noun="suppliers"
      />

      <Card>
        <CardHeader
          title="Directory"
          description={`${suppliers.length} total.`}
        />
        {visible.length > 0 ? (
          <ul>
            {visible.map((supplier) => (
              <li
                key={supplier.id}
                className="border-b border-ink-200 last:border-b-0"
              >
                <Link
                  href={`/suppliers/${supplier.id}`}
                  className="block px-4 py-4 transition-colors hover:bg-ink-50 sm:px-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900">{supplier.name}</p>
                    {!supplier.is_active && <Badge tone="danger">Archived</Badge>}
                  </div>
                  {supplier.supplies && (
                    <p className="mt-0.5 text-sm text-ink-600">
                      {supplier.supplies}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                    {supplier.contact_person && (
                      <span>{supplier.contact_person}</span>
                    )}
                    {supplier.phone && (
                      <span className="tabular">{supplier.phone}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {suppliers.length === 0
              ? "No suppliers yet."
              : `No supplier matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
