import type { CatalogItem } from "@/lib/supabase/database.types";

/**
 * Catalog item rules (Spec 4.2).
 *
 * Dependency-free on purpose: the server action, the seed script, and
 * the tests all validate through this one module, so a rule can never
 * be enforced in one place and forgotten in another.
 */

/** Offered as suggestions in the category box; not a closed list. */
export const CATEGORY_SUGGESTIONS = [
  "Tents",
  "Tables & Chairs",
  "Covers & Linens",
  "Sound & Karaoke",
  "Backdrop Structures",
  "Lights",
  "Balloons",
  "Party Supplies",
  "Toys & Giveaways",
  "Tableware",
] as const;

/** The shape a form is parsed into before it ever touches the database. */
export type CatalogItemDraft = {
  name: string;
  category: string;
  description: string;
  is_rental: boolean;
  is_sale: boolean;
  rental_price_centavos: number;
  replacement_value_centavos: number;
  quantity_owned: number;
  sale_price_centavos: number;
  cost_price_centavos: number;
  stock_quantity: number;
  low_stock_threshold: number;
};

const MONEY_FIELDS: readonly (keyof CatalogItemDraft)[] = [
  "rental_price_centavos",
  "replacement_value_centavos",
  "sale_price_centavos",
  "cost_price_centavos",
];

const COUNT_FIELDS: readonly (keyof CatalogItemDraft)[] = [
  "quantity_owned",
  "stock_quantity",
  "low_stock_threshold",
];

/**
 * Returns an error message, or null when the draft is valid.
 *
 * A single message rather than a field map: these forms are short and
 * staff fill them on a phone, where one clear sentence beats scattered
 * inline errors.
 */
export function validateCatalogItem(draft: CatalogItemDraft): string | null {
  if (!draft.name.trim()) {
    return "Item name is required.";
  }

  if (!draft.is_rental && !draft.is_sale) {
    return "Mark the item as a rental item, a sale item, or both.";
  }

  for (const field of MONEY_FIELDS) {
    const value = draft[field] as number;
    if (!Number.isInteger(value) || value < 0) {
      return "Prices must be valid amounts of ₱0.00 or more.";
    }
  }

  for (const field of COUNT_FIELDS) {
    const value = draft[field] as number;
    if (!Number.isInteger(value) || value < 0) {
      return "Quantities must be whole numbers of 0 or more.";
    }
  }

  if (draft.is_rental) {
    if (draft.quantity_owned < 1) {
      return "A rental item needs a quantity owned of at least 1.";
    }
    // The rental agreement charges damaged and lost items at this
    // value (Spec 4.5), so it cannot be left at zero.
    if (draft.replacement_value_centavos < 1) {
      return "Set a replacement value — damaged or lost items are charged at it.";
    }
  }

  if (draft.is_sale && draft.sale_price_centavos < 1) {
    return "A sale item needs a unit price above ₱0.00.";
  }

  return null;
}

/** "Rental", "Sale", or "Rental & Sale" — an item may be both (Spec 4.2). */
export function itemTypeLabel(item: Pick<CatalogItem, "is_rental" | "is_sale">): string {
  if (item.is_rental && item.is_sale) return "Rental & Sale";
  if (item.is_rental) return "Rental";
  return "Sale";
}

export type StockStatus = "not_stocked" | "out" | "low" | "ok";

/**
 * Stock state of a sale item, driving the dashboard's low-stock alerts
 * (Spec 4.6). A threshold of 0 means the owner does not track a floor
 * for this item, so only a true zero is worth flagging.
 */
export function stockStatus(
  item: Pick<CatalogItem, "is_sale" | "stock_quantity" | "low_stock_threshold">,
): StockStatus {
  if (!item.is_sale) return "not_stocked";
  if (item.stock_quantity <= 0) return "out";
  if (item.low_stock_threshold > 0 && item.stock_quantity <= item.low_stock_threshold) {
    return "low";
  }
  return "ok";
}

