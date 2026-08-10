import "server-only";

import { getBusinessSettings } from "@/lib/auth/dal";
import { loadPickerOptions, type PickerOption } from "@/lib/catalog/picker";
import { todayInManila } from "@/lib/date";
import { defaultValidUntil } from "@/lib/quotations/status";
import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/lib/supabase/database.types";
import type { BuilderDefaults } from "./quotation-builder";

/**
 * Everything the quotation builder needs to render: the customer list,
 * the catalog it can quote from, and the defaults out of Settings.
 *
 * Shared by the new and edit screens so the two can never drift.
 */
export async function loadBuilderData(): Promise<{
  customers: Customer[];
  options: PickerOption[];
  defaults: BuilderDefaults;
}> {
  const supabase = await createClient();
  const settings = await getBusinessSettings();

  const [{ data: customers }, options] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    loadPickerOptions(),
  ]);

  const today = todayInManila();

  return {
    customers: customers ?? [],
    options,
    defaults: {
      issue_date: today,
      valid_until: defaultValidUntil(
        today,
        settings?.quotation_validity_days ?? 7,
      ),
      downpayment_percent: settings?.downpayment_percent ?? 50,
      free_delivery_area: settings?.free_delivery_area ?? "",
      suggestedFees: settings?.delivery_fee_table ?? [],
    },
  };
}
