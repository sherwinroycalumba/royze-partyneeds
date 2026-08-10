"use server";

import { revalidatePath } from "next/cache";

import { requireOwner, requirePermission, requireUser } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { diffChanges, logAudit } from "@/lib/audit";
import { todayInManila } from "@/lib/date";
import {
  checkbox,
  nullableText,
  pesoCentavos,
  text,
  type FormState,
} from "@/lib/forms";
import { formatPeso } from "@/lib/money";
import { isPaymentMethod } from "@/lib/payments/methods";
import { uploadFile, UploadError } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Expense } from "@/lib/supabase/database.types";
import { validateExpense } from "./validation";

export type ExpenseState = FormState;

/**
 * Expenses and payables (Spec 4.8).
 *
 * The Owner records and pays; the Bookkeeper categorises and nothing
 * else. That split is the app-level half of the RLS policy, which can
 * only say "may update" and not "may update this column".
 */

function revalidateExpenses(): void {
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/suppliers");
}

function readDraft(formData: FormData) {
  const amount = pesoCentavos(formData, "amount");
  if (amount === null) {
    return { error: "Enter the amount as a plain number, e.g. 1,500.00." };
  }

  const isPaid = checkbox(formData, "is_paid");
  const method = text(formData, "method");

  const draft = {
    expense_date: text(formData, "expense_date") || todayInManila(),
    payee: text(formData, "payee"),
    category: text(formData, "category"),
    amount_centavos: amount,
    is_paid: isPaid,
    // A payable carries a due date; a paid one carries the day it went
    // out. Keeping the other blank stops a stale value confusing the
    // payables queue later.
    due_date: isPaid ? null : nullableText(formData, "due_date"),
    paid_on: isPaid
      ? nullableText(formData, "paid_on") || todayInManila()
      : null,
  };

  const invalid = validateExpense(draft);
  if (invalid) return { error: invalid };

  return {
    draft,
    record: {
      ...draft,
      supplier_id: nullableText(formData, "supplier_id"),
      method: isPaymentMethod(method) ? method : null,
      reference_number: text(formData, "reference_number"),
      notes: text(formData, "notes"),
    },
  };
}

/** Uploads the optional receipt into the private documents bucket. */
async function readReceipt(
  formData: FormData,
  prefix: string,
): Promise<{ path?: string } | { error: string }> {
  const receipt = formData.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) return {};

  try {
    return { path: await uploadFile("documents", prefix, receipt) };
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }
}

export async function createExpenseAction(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const actor = await requirePermission("expenses.manage");

  const parsed = readDraft(formData);
  if ("error" in parsed) return parsed;

  const receipt = await readReceipt(formData, "expenses");
  if ("error" in receipt) return receipt;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      ...parsed.record,
      receipt_path: receipt.path ?? null,
      recorded_by: actor.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "expense.create",
    entityType: "expense",
    entityId: data.id,
    summary: `${formatPeso(parsed.record.amount_centavos)} to ${parsed.record.payee}${parsed.record.is_paid ? "" : " (unpaid)"}`,
    details: { ...parsed.record },
  });

  revalidateExpenses();
  return {
    success: parsed.record.is_paid
      ? `${formatPeso(parsed.record.amount_centavos)} recorded.`
      : `${formatPeso(parsed.record.amount_centavos)} recorded as a payable due ${parsed.record.due_date}.`,
  };
}

export async function updateExpenseAction(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  await requirePermission("expenses.manage");

  const expenseId = text(formData, "expense_id");
  if (!expenseId) return { error: "Missing expense." };

  const parsed = readDraft(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", expenseId)
    .single();

  if (!before) return { error: "That expense no longer exists." };

  const receipt = await readReceipt(formData, `expenses/${expenseId}`);
  if ("error" in receipt) return receipt;

  const patch: Partial<Expense> = { ...parsed.record };
  if (receipt.path) patch.receipt_path = receipt.path;

  const { error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", expenseId);

  if (error) return { error: error.message };

  await logAudit({
    action: "expense.update",
    entityType: "expense",
    entityId: expenseId,
    summary: `Updated expense to ${parsed.record.payee}`,
    details: diffChanges(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    ),
  });

  revalidateExpenses();
  return { success: "Expense saved." };
}

/**
 * The Bookkeeper's one write (Spec 3): putting an expense in the right
 * category for the BIR filing report. Deliberately its own action so
 * they cannot reach the amount, the payee, or whether it was paid.
 */
export async function categoriseExpenseAction(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const actor = await requireUser();
  if (!can(actor, "expenses.categorize") && !can(actor, "expenses.manage")) {
    return { error: "You cannot categorise expenses." };
  }

  const expenseId = text(formData, "expense_id");
  const category = text(formData, "category");

  if (!expenseId) return { error: "Missing expense." };
  if (!category) return { error: "Choose a category." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .update({ category })
    .eq("id", expenseId)
    .select("payee, amount_centavos")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    action: "expense.categorise",
    entityType: "expense",
    entityId: expenseId,
    summary: `${formatPeso(data.amount_centavos)} to ${data.payee} categorised as ${category}`,
    details: { category },
  });

  revalidateExpenses();
  return { success: `Categorised as ${category}.` };
}

/** Settles a payable, or reopens one paid by mistake (Spec 4.8). */
export async function setExpensePaidAction(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  await requireOwner();

  const expenseId = text(formData, "expense_id");
  const paid = text(formData, "is_paid") === "true";
  if (!expenseId) return { error: "Missing expense." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("expenses")
    .select("*")
    .eq("id", expenseId)
    .single();

  if (!before) return { error: "That expense no longer exists." };

  // Reopening needs a due date back, or the row would violate the
  // constraint that keeps payables chaseable.
  const dueDate =
    nullableText(formData, "due_date") ?? before.due_date ?? todayInManila();

  const patch = paid
    ? {
        is_paid: true,
        paid_on: nullableText(formData, "paid_on") || todayInManila(),
        due_date: null,
      }
    : { is_paid: false, paid_on: null, due_date: dueDate };

  const { error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", expenseId);

  if (error) return { error: error.message };

  await logAudit({
    action: paid ? "expense.paid" : "expense.reopened",
    entityType: "expense",
    entityId: expenseId,
    summary: `${formatPeso(before.amount_centavos)} to ${before.payee} marked ${paid ? "paid" : "unpaid"}`,
    details: patch,
  });

  revalidateExpenses();
  return {
    success: paid
      ? `Marked paid.`
      : `Reopened as a payable due ${patch.due_date}.`,
  };
}
