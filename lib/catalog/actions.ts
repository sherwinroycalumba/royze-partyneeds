"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { diffChanges, logAudit } from "@/lib/audit";
import {
  checkbox,
  pesoCentavos,
  text,
  wholeNumber,
  type FormState,
} from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { getPublicUrl, uploadFile, UploadError } from "@/lib/storage";
import { validateCatalogItem, type CatalogItemDraft } from "./items";
import { priceChanges } from "./price-history";
import {
  isComponentKind,
  isOccasion,
  validatePackage,
  type ComponentDraft,
  type PackageDraft,
} from "./packages";
import type { CatalogItem, Profile } from "@/lib/supabase/database.types";

export type CatalogState = FormState;

/**
 * Catalog writes (Spec 4.2).
 *
 * Every export re-checks `catalog.manage` — the nav hiding a button is
 * a convenience, not a boundary, and a Server Action export is a
 * client-callable endpoint.
 */

/**
 * Reads the item form into a validated draft, or returns the problem.
 *
 * `costProvided` is false when a catalog manager who is not the Owner
 * submitted the form: cost price is not rendered for them (Spec 4.2),
 * and an absent field must not be read as ₱0.00 and wipe the value.
 */
function readItemDraft(
  formData: FormData,
): { draft: CatalogItemDraft; costProvided: boolean } | { error: string } {
  const isRental = checkbox(formData, "is_rental");
  const isSale = checkbox(formData, "is_sale");

  const money = {
    rental_price_centavos: pesoCentavos(formData, "rental_price"),
    replacement_value_centavos: pesoCentavos(formData, "replacement_value"),
    sale_price_centavos: pesoCentavos(formData, "sale_price"),
    cost_price_centavos: pesoCentavos(formData, "cost_price"),
  };

  if (Object.values(money).some((value) => value === null)) {
    return { error: "Enter prices as plain amounts, e.g. 1,250.00." };
  }

  const counts = {
    quantity_owned: wholeNumber(formData, "quantity_owned"),
    stock_quantity: wholeNumber(formData, "stock_quantity"),
    low_stock_threshold: wholeNumber(formData, "low_stock_threshold"),
  };

  if (Object.values(counts).some((value) => value === null)) {
    return { error: "Quantities must be whole numbers of 0 or more." };
  }

  const draft: CatalogItemDraft = {
    name: text(formData, "name"),
    category: text(formData, "category"),
    description: text(formData, "description"),
    is_rental: isRental,
    is_sale: isSale,
    // Sides the item does not have stay at zero rather than carrying
    // stale numbers from a previous configuration.
    rental_price_centavos: isRental ? money.rental_price_centavos! : 0,
    replacement_value_centavos: isRental ? money.replacement_value_centavos! : 0,
    quantity_owned: isRental ? counts.quantity_owned! : 0,
    sale_price_centavos: isSale ? money.sale_price_centavos! : 0,
    cost_price_centavos: isSale ? money.cost_price_centavos! : 0,
    stock_quantity: isSale ? counts.stock_quantity! : 0,
    low_stock_threshold: isSale ? counts.low_stock_threshold! : 0,
  };

  const invalid = validateCatalogItem(draft);
  if (invalid) return { error: invalid };

  return { draft, costProvided: formData.has("cost_price") };
}

/** Uploads the optional photo, returning its public URL. */
async function readPhotoUrl(
  formData: FormData,
  prefix: string,
): Promise<{ url?: string } | { error: string }> {
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return {};

  try {
    const path = await uploadFile("catalog", prefix, photo);
    return { url: await getPublicUrl("catalog", path) };
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }
}

/** Appends the price movements of an edit to the price-history log. */
async function logPriceChanges(
  actor: Profile,
  entityType: "catalog_item" | "backdrop_package",
  entityId: string,
  entityName: string,
  before: Record<string, number>,
  after: Record<string, number>,
): Promise<void> {
  const changes = priceChanges(before, after);
  if (changes.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.from("price_history").insert(
    changes.map((change) => ({
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      field: change.field,
      old_value_centavos: change.from,
      new_value_centavos: change.to,
      changed_by: actor.id,
      changed_by_name: actor.full_name || actor.email,
    })),
  );

  // Like the audit trail: a failed log must not undo a saved price.
  if (error) {
    console.error("[price-history] failed to write", entityId, error.message);
  }
}

function revalidateCatalog(): void {
  revalidatePath("/catalog");
  revalidatePath("/packages");
  revalidatePath("/dashboard");
}

// ── Catalog items ─────────────────────────────────────────────
export async function createCatalogItemAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const actor = await requirePermission("catalog.manage");

  const parsed = readItemDraft(formData);
  if ("error" in parsed) return parsed;

  const photo = await readPhotoUrl(formData, "items");
  if ("error" in photo) return photo;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .insert({
      ...parsed.draft,
      photo_url: photo.url ?? null,
      created_by: actor.id,
    })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "catalog.item.create",
    entityType: "catalog_item",
    entityId: data.id,
    summary: `Added catalog item ${data.name}`,
    details: { ...parsed.draft },
  });

  revalidateCatalog();
  return { success: `${data.name} added to the catalog.` };
}

export async function updateCatalogItemAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const actor = await requirePermission("catalog.manage");

  const itemId = text(formData, "item_id");
  if (!itemId) return { error: "Missing item." };

  const parsed = readItemDraft(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("catalog_items")
    .select("*")
    .eq("id", itemId)
    .single();

  if (loadError || !before) {
    return { error: "That item no longer exists." };
  }

  const photo = await readPhotoUrl(formData, `items/${itemId}`);
  if ("error" in photo) return photo;

  const patch: Partial<CatalogItem> = { ...parsed.draft };
  if (photo.url) patch.photo_url = photo.url;
  // Keep the Owner's cost price when the editor could not see it.
  if (!parsed.costProvided && parsed.draft.is_sale) {
    patch.cost_price_centavos = before.cost_price_centavos;
  }

  const { error } = await supabase
    .from("catalog_items")
    .update(patch)
    .eq("id", itemId);

  if (error) return { error: error.message };

  await logPriceChanges(
    actor,
    "catalog_item",
    itemId,
    parsed.draft.name,
    before as unknown as Record<string, number>,
    patch as unknown as Record<string, number>,
  );

  await logAudit({
    action: "catalog.item.update",
    entityType: "catalog_item",
    entityId: itemId,
    summary: `Updated catalog item ${parsed.draft.name}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    ),
  });

  revalidateCatalog();
  return { success: `${parsed.draft.name} saved.` };
}

/**
 * Archives or restores an item. Never deletes: past bookings and
 * quotations still point at it.
 */
export async function setCatalogItemActiveAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requirePermission("catalog.manage");

  const itemId = text(formData, "item_id");
  const activate = text(formData, "activate") === "true";
  if (!itemId) return { error: "Missing item." };

  const supabase = await createClient();

  if (!activate) {
    // An archived item would silently vanish from the packages that
    // still list it, so block the archive and name them instead.
    const { data: used } = await supabase
      .from("backdrop_package_components")
      .select("package_id, backdrop_packages!inner(name, is_active)")
      .eq("catalog_item_id", itemId)
      .eq("backdrop_packages.is_active", true);

    if (used && used.length > 0) {
      const names = used.map((row) => row.backdrop_packages.name).join(", ");
      return {
        error: `Still used by these active packages: ${names}. Remove it from them first.`,
      };
    }
  }

  const { data, error } = await supabase
    .from("catalog_items")
    .update({ is_active: activate })
    .eq("id", itemId)
    .select("name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: activate ? "catalog.item.restore" : "catalog.item.archive",
    entityType: "catalog_item",
    entityId: itemId,
    summary: `${activate ? "Restored" : "Archived"} catalog item ${data.name}`,
  });

  revalidateCatalog();
  return {
    success: `${data.name} ${activate ? "restored" : "archived"}.`,
  };
}

/** Quick stock correction from the catalog list (Spec 4.6). */
export async function adjustStockAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requirePermission("catalog.manage");

  const itemId = text(formData, "item_id");
  const newStock = wholeNumber(formData, "stock_quantity");

  if (!itemId) return { error: "Missing item." };
  if (newStock === null) {
    return { error: "Stock must be a whole number of 0 or more." };
  }

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("catalog_items")
    .select("name, stock_quantity, is_sale")
    .eq("id", itemId)
    .single();

  if (loadError || !before) return { error: "That item no longer exists." };
  if (!before.is_sale) {
    return { error: "Only sale items carry stock." };
  }

  const { error } = await supabase
    .from("catalog_items")
    .update({ stock_quantity: newStock })
    .eq("id", itemId);

  if (error) return { error: error.message };

  await logAudit({
    action: "catalog.item.stock_adjust",
    entityType: "catalog_item",
    entityId: itemId,
    summary: `Set ${before.name} stock to ${newStock} (was ${before.stock_quantity})`,
    details: { from: before.stock_quantity, to: newStock },
  });

  revalidateCatalog();
  return { success: `${before.name} stock set to ${newStock}.` };
}

// ── Backdrop packages ─────────────────────────────────────────
function readPackageDraft(
  formData: FormData,
): { draft: PackageDraft; components: ComponentDraft[] } | { error: string } {
  const price = pesoCentavos(formData, "package_price");
  if (price === null) {
    return { error: "Enter the package price as a plain amount, e.g. 4,500.00." };
  }

  const setupMinutes = wholeNumber(formData, "setup_minutes");
  if (setupMinutes === null) {
    return { error: "Setup time must be a whole number of minutes." };
  }

  const draft: PackageDraft = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    occasion_tags: formData
      .getAll("occasion")
      .map((value) => String(value))
      .filter(isOccasion),
    package_price_centavos: price,
    setup_minutes: setupMinutes,
    teardown_notes: text(formData, "teardown_notes"),
  };

  // Repeatable rows post as parallel arrays, one entry per row.
  const itemIds = formData.getAll("component_item").map((v) => String(v));
  const quantities = formData.getAll("component_quantity").map((v) => String(v));
  const kinds = formData.getAll("component_kind").map((v) => String(v));
  const consumes = formData.getAll("component_consumes").map((v) => String(v));

  const components: ComponentDraft[] = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    const catalogItemId = itemIds[index];
    // Skip untouched blank rows so an empty row never blocks a save.
    if (!catalogItemId) continue;

    const rawQuantity = quantities[index] ?? "1";
    if (!/^\d+$/.test(rawQuantity)) {
      return { error: `Row ${index + 1}: quantity must be a whole number.` };
    }

    const kind = kinds[index] ?? "other";
    components.push({
      catalog_item_id: catalogItemId,
      quantity: Number.parseInt(rawQuantity, 10),
      kind: isComponentKind(kind) ? kind : "other",
      // Paired hidden inputs, so the index still lines up when a
      // checkbox is left unchecked.
      consumes_stock: consumes[index] === "true",
    });
  }

  const invalid = validatePackage(draft, components);
  if (invalid) return { error: invalid };

  return { draft, components };
}

/** Replaces a package's component rows with the submitted set. */
async function replaceComponents(
  packageId: string,
  components: readonly ComponentDraft[],
): Promise<string | null> {
  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("backdrop_package_components")
    .delete()
    .eq("package_id", packageId);

  if (clearError) return clearError.message;

  const { error } = await supabase.from("backdrop_package_components").insert(
    components.map((component, index) => ({
      package_id: packageId,
      catalog_item_id: component.catalog_item_id,
      quantity: component.quantity,
      kind: component.kind,
      consumes_stock: component.consumes_stock,
      sort_order: index,
    })),
  );

  return error?.message ?? null;
}

export async function createPackageAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const actor = await requirePermission("catalog.manage");

  const parsed = readPackageDraft(formData);
  if ("error" in parsed) return parsed;

  const photo = await readPhotoUrl(formData, "packages");
  if ("error" in photo) return photo;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("backdrop_packages")
    .insert({
      ...parsed.draft,
      photo_url: photo.url ?? null,
      created_by: actor.id,
    })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  const componentError = await replaceComponents(data.id, parsed.components);
  if (componentError) {
    return {
      error: `Package saved, but its components did not: ${componentError}`,
    };
  }

  await logAudit({
    action: "catalog.package.create",
    entityType: "backdrop_package",
    entityId: data.id,
    summary: `Added backdrop package ${data.name} at ${formatPeso(parsed.draft.package_price_centavos)}`,
    details: {
      ...parsed.draft,
      component_count: parsed.components.length,
    },
  });

  revalidateCatalog();
  return { success: `${data.name} added.` };
}

export async function updatePackageAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const actor = await requirePermission("catalog.manage");

  const packageId = text(formData, "package_id");
  if (!packageId) return { error: "Missing package." };

  const parsed = readPackageDraft(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("backdrop_packages")
    .select("*")
    .eq("id", packageId)
    .single();

  if (loadError || !before) return { error: "That package no longer exists." };

  const photo = await readPhotoUrl(formData, `packages/${packageId}`);
  if ("error" in photo) return photo;

  const patch = {
    ...parsed.draft,
    ...(photo.url ? { photo_url: photo.url } : {}),
  };

  const { error } = await supabase
    .from("backdrop_packages")
    .update(patch)
    .eq("id", packageId);

  if (error) return { error: error.message };

  const componentError = await replaceComponents(packageId, parsed.components);
  if (componentError) {
    return {
      error: `Package saved, but its components did not: ${componentError}`,
    };
  }

  await logPriceChanges(
    actor,
    "backdrop_package",
    packageId,
    parsed.draft.name,
    { package_price_centavos: before.package_price_centavos },
    { package_price_centavos: parsed.draft.package_price_centavos },
  );

  await logAudit({
    action: "catalog.package.update",
    entityType: "backdrop_package",
    entityId: packageId,
    summary: `Updated backdrop package ${parsed.draft.name}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    ),
  });

  revalidateCatalog();
  return { success: `${parsed.draft.name} saved.` };
}

export async function setPackageActiveAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requirePermission("catalog.manage");

  const packageId = text(formData, "package_id");
  const activate = text(formData, "activate") === "true";
  if (!packageId) return { error: "Missing package." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("backdrop_packages")
    .update({ is_active: activate })
    .eq("id", packageId)
    .select("name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: activate ? "catalog.package.restore" : "catalog.package.archive",
    entityType: "backdrop_package",
    entityId: packageId,
    summary: `${activate ? "Restored" : "Archived"} backdrop package ${data.name}`,
  });

  revalidateCatalog();
  return { success: `${data.name} ${activate ? "restored" : "archived"}.` };
}
