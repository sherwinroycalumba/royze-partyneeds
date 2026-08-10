"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/dal";
import { logAudit } from "@/lib/audit";
import { pesoCentavos, text, wholeNumber, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import {
  applyAssetMove,
  ASSET_MOVE_LABELS,
  isAssetMove,
  validateAssetMove,
} from "./status";

export type AssetState = FormState;

/**
 * Moving broken equipment between states (Spec 4.9), which closes the
 * gap Milestone 4 left: damaged stock came out of availability on
 * return and had no route back.
 *
 * Owner only. Every move changes what the availability engine believes
 * the business owns, so each one is audited with its before and after.
 */
export async function moveAssetAction(
  _prev: AssetState,
  formData: FormData,
): Promise<AssetState> {
  await requireOwner();

  const itemId = text(formData, "item_id");
  const move = text(formData, "move");
  const quantity = wholeNumber(formData, "quantity");

  if (!itemId) return { error: "Missing item." };
  if (!isAssetMove(move)) return { error: "Unknown move." };
  if (quantity === null || quantity < 1) {
    return { error: "Enter a whole number of 1 or more." };
  }

  const supabase = await createClient();
  const { data: item, error: loadError } = await supabase
    .from("catalog_items")
    .select(
      "id, name, quantity_owned, damaged_quantity, under_repair_quantity, written_off_quantity",
    )
    .eq("id", itemId)
    .single();

  if (loadError || !item) return { error: "That item no longer exists." };

  const before = {
    quantity_owned: item.quantity_owned,
    damaged_quantity: item.damaged_quantity,
    under_repair_quantity: item.under_repair_quantity,
    written_off_quantity: item.written_off_quantity,
  };

  const invalid = validateAssetMove(before, move, quantity);
  if (invalid) return { error: `${item.name}: ${invalid}` };

  const after = applyAssetMove(before, move, quantity);

  const { error } = await supabase
    .from("catalog_items")
    .update(after)
    .eq("id", itemId);

  if (error) return { error: error.message };

  await logAudit({
    action: `asset.${move}`,
    entityType: "catalog_item",
    entityId: itemId,
    summary: `${item.name}: ${quantity} ${ASSET_MOVE_LABELS[move].toLowerCase()}`,
    details: { move, quantity, before, after },
  });

  revalidatePath("/assets");
  revalidatePath("/catalog");
  revalidatePath("/dashboard");

  return {
    success: `${item.name}: ${quantity} ${ASSET_MOVE_LABELS[move].toLowerCase()}.`,
  };
}

/** Records what an item cost and when it was bought (Spec 4.9). */
export async function setAcquisitionAction(
  _prev: AssetState,
  formData: FormData,
): Promise<AssetState> {
  await requireOwner();

  const itemId = text(formData, "item_id");
  if (!itemId) return { error: "Missing item." };

  // Money, so it goes through the centavo parser like every other
  // amount — not wholeNumber, which would read "1,500.00" as junk.
  const cost = pesoCentavos(formData, "acquisition_cost");
  if (cost === null) {
    return { error: "Enter the cost as a plain amount, e.g. 1,500.00." };
  }

  const acquiredOn = text(formData, "acquired_on");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .update({
      acquisition_cost_centavos: cost,
      acquired_on: acquiredOn || null,
    })
    .eq("id", itemId)
    .select("name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "asset.acquisition",
    entityType: "catalog_item",
    entityId: itemId,
    summary: `Recorded acquisition details for ${data.name}`,
    details: { acquisition_cost_centavos: cost, acquired_on: acquiredOn },
  });

  revalidatePath("/assets");
  return { success: `${data.name} updated.` };
}
