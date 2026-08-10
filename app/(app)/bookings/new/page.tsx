import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { Banner } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { loadBookingBuilderData } from "../builder-data";
import { BookingBuilder } from "../booking-builder";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage() {
  const profile = await requirePermission("bookings.manage");
  const { customers, options, drivers, defaults } =
    await loadBookingBuilderData();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          New booking
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Saved as an enquiry. Reserving the items is the next step, and it is
          what starts holding stock.
        </p>
      </header>

      {customers.length === 0 ? (
        <Banner tone="warning">
          <span className="block">
            There are no active customers yet, and a booking has to be for
            someone.
          </span>
          <Link
            href="/customers"
            className={`${buttonClasses("secondary", "sm")} mt-2`}
          >
            Add a customer first
          </Link>
        </Banner>
      ) : (
        <BookingBuilder
          mode="create"
          customers={customers}
          options={options}
          drivers={drivers}
          defaults={defaults}
          isOwner={profile.role === "owner"}
        />
      )}
    </div>
  );
}
