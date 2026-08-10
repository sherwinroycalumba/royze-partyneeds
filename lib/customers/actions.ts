"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { diffChanges, logAudit } from "@/lib/audit";
import { nullableText, text, type FormState } from "@/lib/forms";
import {
  findPhoneDuplicates,
  normalizePhone,
  phoneMatchKey,
  validateCustomer,
} from "./matching";
import type { Customer } from "@/lib/supabase/database.types";

/**
 * Customer records (Spec 4.1).
 *
 * Duplicate phone numbers are surfaced, never blocked: the action
 * returns the matching customers so the form can offer them as links
 * and let staff decide.
 */
export type CustomerState = FormState & {
  /** Existing customers reachable on the same number. */
  duplicates?: { id: string; name: string; phone: string }[];
  /** Set after a successful create, so the form can link to the profile. */
  customerId?: string;
};

type CustomerFields = Omit<
  Customer,
  "id" | "phone_digits" | "is_active" | "created_by" | "created_at" | "updated_at"
>;

function readCustomer(formData: FormData): CustomerFields {
  return {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    alt_phone: nullableText(formData, "alt_phone"),
    facebook_name: nullableText(formData, "facebook_name"),
    facebook_url: nullableText(formData, "facebook_url"),
    address: text(formData, "address"),
    landmark: nullableText(formData, "landmark"),
    email: nullableText(formData, "email"),
    notes: text(formData, "notes"),
  };
}

/**
 * Customers reachable on the same handset.
 *
 * The suffix `like` is only a coarse shortlist — it would also match a
 * seven-digit landline against the tail of a mobile number. The tested
 * `findPhoneDuplicates` then decides, so one rule governs both the
 * warning and its unit tests.
 */
async function findDuplicates(
  phone: string,
  excludeId?: string,
): Promise<{ id: string; name: string; phone: string }[]> {
  const key = phoneMatchKey(phone);
  if (!key) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, phone")
    .like("phone_digits", `%${key}`)
    .limit(20);

  return findPhoneDuplicates(phone, data ?? [], excludeId).slice(0, 5);
}

export async function createCustomerAction(
  _prev: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const actor = await requirePermission("customers.manage");

  const fields = readCustomer(formData);
  const invalid = validateCustomer(fields);
  if (invalid) return { error: invalid };

  // Staff confirm a flagged duplicate by resubmitting; the checkbox
  // rides along in the form so the second submit goes through.
  const acknowledged = text(formData, "duplicate_ack") === "true";
  if (!acknowledged) {
    const duplicates = await findDuplicates(fields.phone);
    if (duplicates.length > 0) {
      return {
        error: `${duplicates.length === 1 ? "A customer" : "Customers"} already registered on that number. Open the existing record, or save anyway.`,
        duplicates,
      };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({ ...fields, created_by: actor.id })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "customer.create",
    entityType: "customer",
    entityId: data.id,
    summary: `Added customer ${data.name}`,
    details: { phone: normalizePhone(fields.phone) },
  });

  revalidatePath("/customers");
  return { success: `${data.name} added.`, customerId: data.id };
}

export async function updateCustomerAction(
  _prev: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  await requirePermission("customers.manage");

  const customerId = text(formData, "customer_id");
  if (!customerId) return { error: "Missing customer." };

  const fields = readCustomer(formData);
  const invalid = validateCustomer(fields);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data: before, error: loadError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (loadError || !before) return { error: "That customer no longer exists." };

  const { error } = await supabase
    .from("customers")
    .update(fields)
    .eq("id", customerId);

  if (error) return { error: error.message };

  await logAudit({
    action: "customer.update",
    entityType: "customer",
    entityId: customerId,
    summary: `Updated customer ${fields.name}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      fields as unknown as Record<string, unknown>,
    ),
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { success: "Saved." };
}

/** Archives or restores a customer; history keeps pointing at them. */
export async function setCustomerActiveAction(
  _prev: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  await requirePermission("customers.manage");

  const customerId = text(formData, "customer_id");
  const activate = text(formData, "activate") === "true";
  if (!customerId) return { error: "Missing customer." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ is_active: activate })
    .eq("id", customerId)
    .select("name")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: activate ? "customer.restore" : "customer.archive",
    entityType: "customer",
    entityId: customerId,
    summary: `${activate ? "Restored" : "Archived"} customer ${data.name}`,
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { success: `${data.name} ${activate ? "restored" : "archived"}.` };
}
