"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { diffChanges, logAudit } from "@/lib/audit";
import { nullableText, text, type FormState } from "@/lib/forms";
import { validateSupplier } from "@/lib/customers/matching";
import type { Supplier } from "@/lib/supabase/database.types";

/**
 * Supplier directory (Spec 4.8). Owner-only writes — suppliers hang off
 * the expenses and payables side of the business.
 */
export type SupplierState = FormState & { supplierId?: string };

type SupplierFields = Omit<
  Supplier,
  "id" | "is_active" | "created_by" | "created_at" | "updated_at"
>;

function readSupplier(formData: FormData): SupplierFields {
  return {
    name: text(formData, "name"),
    contact_person: nullableText(formData, "contact_person"),
    phone: text(formData, "phone"),
    email: nullableText(formData, "email"),
    address: text(formData, "address"),
    supplies: text(formData, "supplies"),
    notes: text(formData, "notes"),
  };
}

export async function createSupplierAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const actor = await requirePermission("suppliers.manage");

  const fields = readSupplier(formData);
  const invalid = validateSupplier(fields);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...fields, created_by: actor.id })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "supplier.create",
    entityType: "supplier",
    entityId: data.id,
    summary: `Added supplier ${data.name}`,
  });

  revalidatePath("/suppliers");
  return { success: `${data.name} added.`, supplierId: data.id };
}

export async function updateSupplierAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  await requirePermission("suppliers.manage");

  const supplierId = text(formData, "supplier_id");
  if (!supplierId) return { error: "Missing supplier." };

  const fields = readSupplier(formData);
  const invalid = validateSupplier(fields);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", supplierId)
    .single();

  if (loadError || !before) return { error: "That supplier no longer exists." };

  const { error } = await supabase
    .from("suppliers")
    .update(fields)
    .eq("id", supplierId);

  if (error) return { error: error.message };

  await logAudit({
    action: "supplier.update",
    entityType: "supplier",
    entityId: supplierId,
    summary: `Updated supplier ${fields.name}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      fields as unknown as Record<string, unknown>,
    ),
  });

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  return { success: "Saved." };
}

export async function setSupplierActiveAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  await requirePermission("suppliers.manage");

  const supplierId = text(formData, "supplier_id");
  const activate = text(formData, "activate") === "true";
  if (!supplierId) return { error: "Missing supplier." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .update({ is_active: activate })
    .eq("id", supplierId)
    .select("name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: activate ? "supplier.restore" : "supplier.archive",
    entityType: "supplier",
    entityId: supplierId,
    summary: `${activate ? "Restored" : "Archived"} supplier ${data.name}`,
  });

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  return { success: `${data.name} ${activate ? "restored" : "archived"}.` };
}
