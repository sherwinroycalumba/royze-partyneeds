"use server";

import { revalidatePath } from "next/cache";

import { getBusinessSettings, requireOwner } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { diffChanges, logAudit } from "@/lib/audit";
import { nullableText, text } from "@/lib/forms";
import { parsePesoInput } from "@/lib/money";
import {
  findDuplicateAccount,
  isPaymentChannel,
  needsBankName,
  validatePaymentAccount,
  type PaymentAccountDraft,
} from "./payment-accounts";
import { getPublicUrl, uploadFile, UploadError } from "@/lib/storage";
import type {
  AgreementClause,
  BusinessSettings,
  DeliveryFeeArea,
} from "@/lib/supabase/database.types";

export type SettingsState = { error?: string; success?: string };

/**
 * Applies a settings patch as the Owner, records the diff in the audit
 * trail, and refreshes the pages that render these values.
 */
async function applyUpdate(
  patch: Partial<BusinessSettings>,
  auditSummary: string,
): Promise<SettingsState> {
  const owner = await requireOwner();
  const before = await getBusinessSettings();

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_settings")
    .update({ ...patch, updated_by: owner.id })
    .eq("id", true);

  if (error) {
    return { error: error.message };
  }

  await logAudit({
    action: "settings.update",
    entityType: "business_settings",
    entityId: "singleton",
    summary: auditSummary,
    details: before
      ? diffChanges(before as unknown as Record<string, unknown>, patch)
      : {},
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");

  return { success: "Saved." };
}

export async function updateBusinessProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireOwner();

  const businessName = text(formData, "business_name");
  if (!businessName) {
    return { error: "Business name is required." };
  }

  // Accepts "0917 123 4567, 0918 765 4321" and stores an array.
  const contactNumbers = text(formData, "contact_numbers")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const patch: Partial<BusinessSettings> = {
    business_name: businessName,
    address: text(formData, "address"),
    contact_numbers: contactNumbers,
    email: nullableText(formData, "email"),
    facebook_page: nullableText(formData, "facebook_page"),
    tin: nullableText(formData, "tin"),
  };

  // Logo is optional on every save; only replace it when a new file
  // actually came through.
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try {
      const path = await uploadFile("branding", "logo", logo);
      patch.logo_url = await getPublicUrl("branding", path);
    } catch (error) {
      if (error instanceof UploadError) {
        return { error: error.message };
      }
      throw error;
    }
  }

  return applyUpdate(patch, "Updated business profile");
}

/**
 * Saves the whole payment-account list in one submit (Spec 4.12).
 *
 * Add, edit, and delete all arrive together: rows the form no longer
 * carries are removed, existing rows are updated in place so their ids
 * stay stable, and blank rows are new inserts.
 */
export async function savePaymentAccountsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();

  // Repeatable rows post as parallel arrays, one entry per row.
  const ids = formData.getAll("account_id").map((v) => String(v));
  const channels = formData.getAll("account_channel").map((v) => String(v));
  const bankNames = formData.getAll("account_bank_name").map((v) => String(v));
  const names = formData.getAll("account_name").map((v) => String(v));
  const numbers = formData.getAll("account_number").map((v) => String(v));
  const actives = formData.getAll("account_active").map((v) => String(v));

  const rows: (PaymentAccountDraft & { id: string })[] = [];
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index] ?? "";
    const accountNumber = (numbers[index] ?? "").trim();
    const accountName = (names[index] ?? "").trim();
    const bankName = (bankNames[index] ?? "").trim();

    // Skip a row the owner added but never filled in.
    if (!accountNumber && !accountName && !bankName) continue;

    if (!isPaymentChannel(channel)) {
      return { error: `Row ${index + 1}: choose a payment channel.` };
    }

    const draft: PaymentAccountDraft = {
      channel,
      // An e-wallet keeps no bank name, whatever a stale field held.
      bank_name: needsBankName(channel) ? bankName : "",
      account_name: accountName,
      account_number: accountNumber,
      is_active: actives[index] === "true",
    };

    const invalid = validatePaymentAccount(draft, index);
    if (invalid) return { error: invalid };

    rows.push({ ...draft, id: ids[index] ?? "" });
  }

  const duplicate = findDuplicateAccount(rows);
  if (duplicate) return { error: duplicate };

  const supabase = await createClient();

  // The CASH box wording lives on business_settings, but it belongs to
  // this screen — "how to pay" is one idea, not two (Spec 4.12).
  const { error: noteError } = await supabase
    .from("business_settings")
    .update({ cash_payment_note: text(formData, "cash_payment_note") })
    .eq("id", true);

  if (noteError) return { error: noteError.message };
  const { data: existing } = await supabase
    .from("payment_accounts")
    .select("id");

  const keptIds = new Set(rows.map((row) => row.id).filter(Boolean));
  const removedIds = (existing ?? [])
    .map((row) => row.id)
    .filter((id) => !keptIds.has(id));

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("payment_accounts")
      .delete()
      .in("id", removedIds);
    if (error) return { error: error.message };
  }

  for (const [index, row] of rows.entries()) {
    const values = {
      channel: row.channel,
      bank_name: row.bank_name,
      account_name: row.account_name,
      account_number: row.account_number,
      is_active: row.is_active,
      sort_order: index,
    };

    const { error } = row.id
      ? await supabase.from("payment_accounts").update(values).eq("id", row.id)
      : await supabase
          .from("payment_accounts")
          .insert({ ...values, created_by: owner.id });

    if (error) return { error: error.message };
  }

  const activeCount = rows.filter((row) => row.is_active).length;

  await logAudit({
    action: "settings.payment_accounts.update",
    entityType: "payment_accounts",
    summary: `Updated payment accounts (${rows.length} on file, ${activeCount} active, ${removedIds.length} removed)`,
    details: {
      accounts: rows.map((row) => ({
        channel: row.channel,
        bank_name: row.bank_name,
        account_name: row.account_name,
        // Deliberately not the full number in the audit trail.
        account_number_last4: row.account_number.slice(-4),
        is_active: row.is_active,
      })),
    },
  });

  revalidatePath("/settings/payments");
  revalidatePath("/", "layout");

  return {
    success: `Saved. ${activeCount} active ${activeCount === 1 ? "account" : "accounts"} will print on documents.`,
  };
}

export async function updateDefaultsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireOwner();

  const downpayment = Number(text(formData, "downpayment_percent"));
  const validity = Number(text(formData, "quotation_validity_days"));

  if (!Number.isFinite(downpayment) || downpayment < 0 || downpayment > 100) {
    return { error: "Downpayment percentage must be between 0 and 100." };
  }

  if (!Number.isInteger(validity) || validity < 1) {
    return { error: "Quotation validity must be at least 1 day." };
  }

  return applyUpdate(
    {
      downpayment_percent: downpayment,
      quotation_validity_days: validity,
    },
    `Set downpayment to ${downpayment}% and quotation validity to ${validity} days`,
  );
}

export async function updateDeliverySettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireOwner();

  const freeArea = text(formData, "free_delivery_area");
  if (!freeArea) {
    return { error: "Free delivery area name is required." };
  }

  // Paired arrays from the repeatable rows in the form.
  const areas = formData.getAll("fee_area").map((v) => String(v).trim());
  const fees = formData.getAll("fee_amount").map((v) => String(v).trim());

  const table: DeliveryFeeArea[] = [];
  for (let index = 0; index < areas.length; index += 1) {
    const area = areas[index];
    const rawFee = fees[index] ?? "";

    // Skip fully blank rows so an empty row never blocks the save.
    if (!area && !rawFee) continue;

    if (!area) {
      return { error: `Row ${index + 1}: area name is required.` };
    }

    const centavos = parsePesoInput(rawFee);
    if (centavos === null || centavos < 0) {
      return { error: `Row ${index + 1}: enter a valid fee for "${area}".` };
    }

    table.push({ area, fee_centavos: centavos });
  }

  return applyUpdate(
    { free_delivery_area: freeArea, delivery_fee_table: table },
    `Updated delivery settings (free area: ${freeArea}, ${table.length} fee rows)`,
  );
}

export async function updateAgreementClausesAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireOwner();

  const headings = formData.getAll("clause_heading").map((v) => String(v).trim());
  const bodies = formData.getAll("clause_body").map((v) => String(v).trim());

  const clauses: AgreementClause[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const body = bodies[index] ?? "";

    if (!heading && !body) continue;

    if (!heading) {
      return { error: `Clause ${index + 1}: heading is required.` };
    }
    if (!body) {
      return { error: `Clause ${index + 1}: "${heading}" needs body text.` };
    }

    clauses.push({ heading, body });
  }

  return applyUpdate(
    { agreement_clauses: clauses },
    `Updated rental agreement template (${clauses.length} clauses)`,
  );
}

export async function updateExpenseCategoriesAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireOwner();

  const categories = formData
    .getAll("category")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (categories.length === 0) {
    return { error: "Keep at least one expense category." };
  }

  const unique = Array.from(new Set(categories));
  if (unique.length !== categories.length) {
    return { error: "Expense categories must be unique." };
  }

  return applyUpdate(
    { expense_categories: unique },
    `Updated expense categories (${unique.length})`,
  );
}
