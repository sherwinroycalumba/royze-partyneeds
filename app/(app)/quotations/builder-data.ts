import "server-only";

import { getBusinessSettings } from "@/lib/auth/dal";
import { componentSummary } from "@/lib/catalog/packages";
import { todayInManila } from "@/lib/date";
import { defaultValidUntil } from "@/lib/quotations/status";
import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/lib/supabase/database.types";
import type { BuilderDefaults, PickerOption } from "./quotation-builder";

/**
 * Everything the quotation builder needs to render: the customer list,
 * the catalog and packages it can quote from, and the defaults that
 * come out of Settings.
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

  const [{ data: customers }, { data: items }, { data: packages }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      // Archived items stay quotable on existing records but must not
      // be offered on new ones (Spec 4.2).
      supabase
        .from("catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("backdrop_packages")
        .select(
          "*, backdrop_package_components(quantity, sort_order, catalog_items(name))",
        )
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);

  const options: PickerOption[] = [];

  for (const item of items ?? []) {
    // An item that is both rented and sold appears twice, because the
    // two sides carry different prices (Spec 4.2).
    if (item.is_rental) {
      options.push({
        key: `item:${item.id}`,
        id: item.id,
        kind: "item",
        line_type: "rental",
        label: item.name,
        group: item.category ? `Rental — ${item.category}` : "Rental",
        unit_price_centavos: item.rental_price_centavos,
        component_summary: "",
      });
    }

    if (item.is_sale) {
      options.push({
        // Distinct from the rental entry, or picking one would select
        // the other in the dropdown.
        key: `item:${item.id}:sale`,
        id: item.id,
        kind: "item",
        line_type: "sale",
        label: item.name,
        group: item.category ? `For sale — ${item.category}` : "For sale",
        unit_price_centavos: item.sale_price_centavos,
        component_summary: "",
      });
    }
  }

  for (const backdrop of packages ?? []) {
    const components = [...(backdrop.backdrop_package_components ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((component) => ({
        name: component.catalog_items?.name ?? "",
        quantity: component.quantity,
      }))
      .filter((component) => component.name);

    options.push({
      key: `package:${backdrop.id}`,
      id: backdrop.id,
      kind: "package",
      line_type: "package",
      label: backdrop.name,
      group: "Backdrop packages",
      unit_price_centavos: backdrop.package_price_centavos,
      // Printed as one priced line with its parts summarised (Spec 4.4).
      component_summary: componentSummary(components),
    });
  }

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
