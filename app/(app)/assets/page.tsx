import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import {
  assetBreakdown,
  daysOverdue,
  isOvercommitted,
  overdueReturns,
  type OutItem,
} from "@/lib/assets/status";
import { holdsStock } from "@/lib/bookings/status";
import { formatCalendarDate, manilaCalendarDate, todayInManila } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { Banner, Card, CardHeader } from "@/components/ui/card";
import { AssetManager, type AssetRow } from "./asset-manager";

export const metadata: Metadata = { title: "Equipment" };

export default async function AssetsPage() {
  const profile = await requirePermission("catalog.view");
  const today = todayInManila();

  const supabase = await createClient();

  const [{ data: items }, { data: activeBookings }] = await Promise.all([
    supabase
      .from("catalog_items")
      .select("*")
      .eq("is_active", true)
      .eq("is_rental", true)
      .order("name", { ascending: true }),
    // Everything currently holding stock, with its lines, so reserved
    // and out-on-rental can be told apart.
    supabase
      .from("bookings")
      .select(
        "id, booking_number, status, pickup_at, reserved_to, customers(name), booking_items(catalog_item_id, quantity, reserves_stock)",
      )
      .in("status", ["reserved", "confirmed", "out_for_delivery", "delivered"]),
  ]);

  // "Out on rental" is with the customer now; "reserved" is promised
  // but still in the yard.
  const reserved = new Map<string, number>();
  const outOnRental = new Map<string, number>();

  for (const booking of activeBookings ?? []) {
    if (!holdsStock(booking.status)) continue;
    const isOut =
      booking.status === "out_for_delivery" || booking.status === "delivered";
    const target = isOut ? outOnRental : reserved;

    for (const line of booking.booking_items ?? []) {
      if (!line.reserves_stock || !line.catalog_item_id) continue;
      target.set(
        line.catalog_item_id,
        (target.get(line.catalog_item_id) ?? 0) + line.quantity,
      );
    }
  }

  const assets: AssetRow[] = (items ?? []).map((item) => {
    const counts = {
      quantity_owned: item.quantity_owned,
      damaged_quantity: item.damaged_quantity,
      under_repair_quantity: item.under_repair_quantity,
      written_off_quantity: item.written_off_quantity,
    };
    const activity = {
      reserved: reserved.get(item.id) ?? 0,
      out_on_rental: outOnRental.get(item.id) ?? 0,
    };

    return {
      ...assetBreakdown(counts, activity),
      id: item.id,
      name: item.name,
      category: item.category,
      replacement_value_centavos: item.replacement_value_centavos,
      overcommitted: isOvercommitted(counts, activity),
    };
  });

  // What is out and when it is due back (Spec 4.9).
  const out: OutItem[] = (activeBookings ?? [])
    .filter(
      (booking) =>
        booking.status === "out_for_delivery" || booking.status === "delivered",
    )
    .map((booking) => ({
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name: booking.customers?.name ?? "—",
      due_back: booking.pickup_at
        ? manilaCalendarDate(booking.pickup_at)
        : booking.reserved_to,
      status: booking.status,
    }));

  const overdue = overdueReturns(out, today);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Equipment
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          What the business owns, where it is right now, and what is broken.
        </p>
      </header>

      {overdue.length > 0 && (
        <Card>
          <CardHeader
            title="Overdue returns"
            description="These items should already be back."
          />
          <ul className="divide-y divide-ink-200">
            {overdue.map((booking) => (
              <li key={booking.booking_id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link
                    href={`/bookings/${booking.booking_id}`}
                    className="font-semibold text-brand-700 underline underline-offset-2"
                  >
                    {booking.customer_name}
                  </Link>
                  <span className="text-sm font-semibold text-danger-600">
                    {daysOverdue(booking.due_back!, today)} days late
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-ink-600">
                  <span className="tabular">{booking.booking_number}</span> · due
                  back {formatCalendarDate(booking.due_back!)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {out.length > 0 && overdue.length === 0 && (
        <Banner tone="info">
          {out.length} {out.length === 1 ? "booking is" : "bookings are"} out
          with customers, none overdue.
        </Banner>
      )}

      <AssetManager assets={assets} isOwner={profile.role === "owner"} />
    </div>
  );
}
