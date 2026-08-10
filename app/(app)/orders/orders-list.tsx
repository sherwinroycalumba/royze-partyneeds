"use client";

import Link from "next/link";

import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/lib/orders/status";
import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type OrderRow = {
  id: string;
  order_number: string;
  customer_label: string;
  status: OrderStatus;
  sold_on: string;
  total_centavos: number;
  item_count: number;
  voided_reason: string;
};

export function OrdersList({
  orders,
  takings,
  truncated,
}: {
  orders: OrderRow[];
  takings: number;
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(orders, query, (order) => [
    order.order_number,
    order.customer_label,
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <p className="text-sm text-ink-600">Completed sales in this view</p>
          <p className="tabular text-2xl font-bold text-success-700">
            {formatPeso(takings)}
          </p>
        </CardBody>
      </Card>

      <ListSearch
        id="order-search"
        label="Search sales"
        placeholder="Search sale number or customer"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={orders.length}
        noun="sales"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the most recent {orders.length}. Narrow the date range to see
          more.
        </p>
      )}

      <Card>
        <CardHeader title="Sales" description={`${orders.length} shown.`} />

        {visible.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {visible.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="block px-4 py-3 transition-colors hover:bg-ink-50 sm:px-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900">
                        {order.customer_label}
                      </span>
                      {order.status === "voided" && (
                        <Badge tone={ORDER_STATUS_TONES[order.status]}>
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>
                      )}
                    </div>
                    <span
                      className={`tabular font-bold ${
                        order.status === "voided"
                          ? "text-ink-400 line-through"
                          : "text-ink-900"
                      }`}
                    >
                      {formatPeso(order.total_centavos)}
                    </span>
                  </div>

                  <p className="mt-0.5 text-sm text-ink-600">
                    <span className="tabular">{order.order_number}</span> ·{" "}
                    {formatCalendarDate(order.sold_on)} · {order.item_count}{" "}
                    {order.item_count === 1 ? "item" : "items"}
                  </p>

                  {order.status === "voided" && order.voided_reason && (
                    <p className="mt-0.5 text-xs text-danger-600">
                      {order.voided_reason}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {orders.length === 0
              ? "No sales in this range."
              : `No sale matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
