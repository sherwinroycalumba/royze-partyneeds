import { multiplyCentavos, sumCentavos } from "@/lib/money";
import type { ComponentKind } from "@/lib/supabase/database.types";

/**
 * Backdrop package rules (Spec 4.2).
 *
 * A package is priced as a bundle, so its price is stored independently
 * of its components. The component list still matters: rental parts get
 * reserved against inventory for the event dates and consumables
 * decrement sale stock when the booking is confirmed.
 */

export const OCCASIONS = [
  "birthday",
  "wedding",
  "anniversary",
  "christening",
  "gender_reveal",
  "other",
] as const;

export type Occasion = (typeof OCCASIONS)[number];

export const OCCASION_LABELS: Record<Occasion, string> = {
  birthday: "Birthday",
  wedding: "Wedding",
  anniversary: "Anniversary",
  christening: "Christening",
  gender_reveal: "Gender Reveal",
  other: "Other",
};

export const COMPONENT_KINDS: readonly ComponentKind[] = [
  "structure",
  "cloth",
  "lights",
  "consumable",
  "other",
];

export const COMPONENT_KIND_LABELS: Record<ComponentKind, string> = {
  structure: "Backdrop structure",
  cloth: "Cloth & draping",
  lights: "Lights",
  consumable: "Consumable",
  other: "Other",
};

export function isOccasion(value: string): value is Occasion {
  return (OCCASIONS as readonly string[]).includes(value);
}

export function isComponentKind(value: string): value is ComponentKind {
  return (COMPONENT_KINDS as readonly string[]).includes(value);
}

/** A component paired with the catalog prices it points at. */
export type PricedComponent = {
  name: string;
  quantity: number;
  kind: ComponentKind;
  consumes_stock: boolean;
  /** The item's own price — rental price for reservables, sale price
   *  for consumables — used only to show what the bundle is worth. */
  unit_centavos: number;
};

/** What the same items would cost bought or rented individually. */
export function componentsSubtotal(
  components: readonly Pick<PricedComponent, "quantity" | "unit_centavos">[],
): number {
  return sumCentavos(
    components.map((component) =>
      multiplyCentavos(component.unit_centavos, component.quantity),
    ),
  );
}

/**
 * How much the bundle price saves the customer against buying the
 * components separately. Negative when the package is priced above its
 * parts — legitimate, since the price also covers setup and teardown.
 */
export function packageSavings(
  packagePriceCentavos: number,
  componentsSubtotalCentavos: number,
): number {
  return componentsSubtotalCentavos - packagePriceCentavos;
}

/**
 * One-line component summary printed under the single package line on
 * quotations and agreements (Spec 4.4).
 */
export function componentSummary(
  components: readonly Pick<PricedComponent, "name" | "quantity">[],
  limit = 4,
): string {
  if (components.length === 0) return "";

  const shown = components
    .slice(0, limit)
    .map((component) => `${component.quantity} × ${component.name}`);

  const remaining = components.length - shown.length;
  if (remaining > 0) {
    shown.push(`+${remaining} more`);
  }

  return shown.join(", ");
}

export type PackageDraft = {
  name: string;
  description: string;
  occasion_tags: string[];
  package_price_centavos: number;
  setup_minutes: number;
  teardown_notes: string;
};

export type ComponentDraft = {
  catalog_item_id: string;
  quantity: number;
  kind: ComponentKind;
  consumes_stock: boolean;
};

export function validatePackage(
  draft: PackageDraft,
  components: readonly ComponentDraft[],
): string | null {
  if (!draft.name.trim()) {
    return "Package name is required.";
  }

  if (
    !Number.isInteger(draft.package_price_centavos) ||
    draft.package_price_centavos < 1
  ) {
    return "Set a package price above ₱0.00.";
  }

  if (!Number.isInteger(draft.setup_minutes) || draft.setup_minutes < 0) {
    return "Setup time must be a whole number of minutes.";
  }

  for (const tag of draft.occasion_tags) {
    if (!isOccasion(tag)) {
      return `"${tag}" is not a recognised occasion.`;
    }
  }

  if (components.length === 0) {
    return "Add at least one component — the package has to reserve something.";
  }

  const seen = new Set<string>();
  for (const component of components) {
    if (!component.catalog_item_id) {
      return "Every component row needs a catalog item.";
    }
    if (seen.has(component.catalog_item_id)) {
      return "The same item is listed twice — combine the rows and raise the quantity.";
    }
    seen.add(component.catalog_item_id);

    if (!Number.isInteger(component.quantity) || component.quantity < 1) {
      return "Component quantities must be whole numbers of 1 or more.";
    }
  }

  return null;
}
