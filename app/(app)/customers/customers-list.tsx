"use client";

import Link from "next/link";

import type { Customer } from "@/lib/supabase/database.types";
import { formatDate } from "@/lib/date";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

/** Customer directory with inline search (Spec 4.1 / 5). */
export function CustomersList({
  customers,
  archived,
  truncated,
}: {
  customers: Customer[];
  archived: boolean;
  /** True when the query hit its row cap and more exist server-side. */
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(customers, query, (customer) => [
    customer.name,
    customer.phone,
    customer.alt_phone,
    customer.facebook_name,
    customer.address,
    customer.landmark,
    customer.email,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="customer-search"
        label="Search customers"
        placeholder="Search name, number, Facebook name, or address"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={customers.length}
        noun="customers"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the first {customers.length} customers by name. Narrow the
          list with the status filter if the one you want is missing.
        </p>
      )}

      <Card>
        <CardHeader
          title={archived ? "Archived customers" : "Customers"}
          description={`${customers.length} loaded.`}
        />
        {visible.length > 0 ? (
          <ul>
            {visible.map((customer) => (
              <li
                key={customer.id}
                className="border-b border-ink-200 last:border-b-0"
              >
                <Link
                  href={`/customers/${customer.id}`}
                  className="block px-4 py-4 transition-colors hover:bg-ink-50 sm:px-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900">{customer.name}</p>
                    {!customer.is_active && <Badge tone="danger">Archived</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
                    {customer.phone && (
                      <span className="tabular">{customer.phone}</span>
                    )}
                    {customer.facebook_name && (
                      <span>FB: {customer.facebook_name}</span>
                    )}
                  </div>
                  {customer.address && (
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {customer.address}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-ink-400">
                    Added {formatDate(customer.created_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {customers.length === 0
              ? archived
                ? "No archived customers."
                : "No customers yet."
              : `No customer matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
