import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { BOOKING_STATUS_LABELS, canEditItems } from "@/lib/bookings/status";
import { instantToManilaLocal } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { loadBookingBuilderData } from "../../builder-data";
import { BookingBuilder } from "../../booking-builder";

export const metadata: Metadata = { title: "Edit booking" };

export default async function EditBookingPage({
  params,
}: {
  // Next 16: params is async.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requirePermission("bookings.manage");

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (!booking) notFound();

  const [{ data: items }, builder] = await Promise.all([
    supabase
      .from("booking_items")
      .select("*")
      .eq("booking_id", id)
      .order("sort_order", { ascending: true }),
    loadBookingBuilderData(),
  ]);

  if (!canEditItems(booking.status)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Banner tone="warning">
          {booking.booking_number} is{" "}
          {BOOKING_STATUS_LABELS[booking.status].toLowerCase()} — its items have
          already gone out, so they are fixed.
        </Banner>
        <Link
          href={`/bookings/${booking.id}`}
          className={buttonClasses("secondary")}
        >
          Back to the booking
        </Link>
      </div>
    );
  }

  const local = (value: string | null) =>
    value ? instantToManilaLocal(value) : "";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <Link
          href={`/bookings/${booking.id}`}
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          ← {booking.booking_number}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">
          Edit booking
        </h1>
      </header>

      <BookingBuilder
        mode="edit"
        bookingId={booking.id}
        customers={builder.customers}
        options={builder.options}
        drivers={builder.drivers}
        defaults={builder.defaults}
        isOwner={profile.role === "owner"}
        initial={{
          customer_id: booking.customer_id,
          event_date: booking.event_date,
          event_start_time: booking.event_start_time,
          event_end_time: booking.event_end_time,
          delivery_local: local(booking.delivery_at),
          pickup_local: local(booking.pickup_at),
          setup_local: local(booking.setup_at),
          teardown_local: local(booking.teardown_at),
          event_address: booking.event_address,
          landmark: booking.landmark,
          contact_person_name: booking.contact_person_name,
          contact_person_phone: booking.contact_person_phone,
          occasion: booking.occasion,
          theme_motif: booking.theme_motif,
          celebrant_name: booking.celebrant_name,
          reference_photo_urls: booking.reference_photo_urls,
          within_free_delivery_area: booking.within_free_delivery_area,
          delivery_fee_centavos: booking.delivery_fee_centavos,
          delivery_fee_override_reason: booking.delivery_fee_override_reason,
          discount_centavos: booking.discount_centavos,
          downpayment_percent: booking.downpayment_percent,
          assigned_delivery_staff: booking.assigned_delivery_staff,
          notes: booking.notes,
          internal_notes: booking.internal_notes,
        }}
        initialItems={items ?? []}
      />
    </div>
  );
}
