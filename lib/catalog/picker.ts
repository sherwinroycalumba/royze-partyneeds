import "server-only";

import { createClient } from "@/lib/supabase/server";
import { componentSummary } from "./packages";

/**
 * The catalog as a document editor offers it (Spec 4.3, 4.4).
 *
 * Quotations and bookings pick from exactly the same list, so it is
 * built once here: rental items, sale items, and backdrop packages,
 * each with the price to start from and — for a package — the summary
 * of parts that prints under its line.
 */

export type PickerOption = {
  /** Unique across both lists, e.g. "item:<uuid>" or "package:<uuid>". */
  key: string;
  id: string;
  kind: "item" | "package";
  /** Which kind of document line this becomes. */
  line_type: "rental" | "sale" | "package";
  label: string;
  group: string;
  unit_price_centavos: number;
  component_summary: string;
};

export async function loadPickerOptions(): Promise<PickerOption[]> {
  const supabase = await createClient();

  const [{ data: items }, { data: packages }] = await Promise.all([
    // Archived items stay on existing documents but must not be
    // offered on new ones (Spec 4.2).
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
      component_summary: componentSummary(components),
    });
  }

  return options;
}
