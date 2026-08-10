import "server-only";

import { getBusinessSettings } from "@/lib/auth/dal";
import { loadPickerOptions, type PickerOption } from "@/lib/catalog/picker";
import { todayInManila } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import type { Customer, Profile } from "@/lib/supabase/database.types";

/** Defaults and lists the booking builder renders from. */
export type BookingBuilderDefaults = {
  event_date: string;
  downpayment_percent: number;
  free_delivery_area: string;
  suggestedFees: { area: string; fee_centavos: number }[];
};

export type BookingBuilderData = {
  customers: Customer[];
  options: PickerOption[];
  /** Who can be sent out with the van (Spec 4.4). */
  drivers: Pick<Profile, "id" | "full_name" | "email">[];
  defaults: BookingBuilderDefaults;
};

export async function loadBookingBuilderData(): Promise<BookingBuilderData> {
  const supabase = await createClient();
  const settings = await getBusinessSettings();

  const [{ data: customers }, { data: drivers }, options] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      // The owner drives too when the shop is busy.
      .in("role", ["delivery_staff", "owner"])
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    loadPickerOptions(),
  ]);

  return {
    customers: customers ?? [],
    options,
    drivers: drivers ?? [],
    defaults: {
      event_date: todayInManila(),
      downpayment_percent: settings?.downpayment_percent ?? 50,
      free_delivery_area: settings?.free_delivery_area ?? "",
      suggestedFees: settings?.delivery_fee_table ?? [],
    },
  };
}
