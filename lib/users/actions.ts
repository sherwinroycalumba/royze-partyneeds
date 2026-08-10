"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { adminResetPassword } from "@/lib/auth/admin-password";
import { validatePassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/audit";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/supabase/database.types";

export type UserFormState = {
  error?: string;
  success?: string;
  /** Shown once after creation or reset so the owner can pass it on. */
  temporaryPassword?: string;
};

function isRole(value: string): value is UserRole {
  return (ALL_ROLES as string[]).includes(value);
}

/**
 * Generates a readable temporary password. Ambiguous characters are
 * left out because the owner reads these out over Messenger.
 */
function generateTemporaryPassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyz";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pool = letters + uppers + digits;

  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);

  // Guarantee the letter+digit rule from validatePassword.
  const chars = [
    uppers[bytes[0] % uppers.length],
    letters[bytes[1] % letters.length],
    digits[bytes[2] % digits.length],
  ];
  for (let index = 3; index < bytes.length; index += 1) {
    chars.push(pool[bytes[index] % pool.length]);
  }

  return chars.join("");
}

/** Refuses to leave the business without a way back in. */
async function wouldRemoveLastOwner(targetUserId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "owner")
    .eq("is_active", true);

  const activeOwners = data ?? [];
  return (
    activeOwners.length <= 1 &&
    activeOwners.some((owner) => owner.id === targetUserId)
  );
}

export async function createUserAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const owner = await requireOwner();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const roleValue = String(formData.get("role") ?? "");
  const catalogManager = formData.get("catalog_manager") === "on";

  if (!email || !fullName) {
    return { error: "Name and email are required." };
  }

  if (!isRole(roleValue)) {
    return { error: "Choose a valid role." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const invalid = validatePassword(temporaryPassword);
  if (invalid) {
    // Defensive: the generator is built to satisfy the policy.
    return { error: "Could not generate a valid temporary password." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    // No mailer is configured for the MVP; the owner hands over the
    // temporary password directly, so confirm the address up front.
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: roleValue,
      // Only Booking Staff use this flag; ignore it for other roles.
      catalog_manager: roleValue === "booking_staff" ? catalogManager : false,
      must_change_password: true,
    },
  });

  if (error || !data.user) {
    const message = error?.message ?? "Could not create the account.";
    return {
      error: message.toLowerCase().includes("already")
        ? "An account with that email already exists."
        : message,
    };
  }

  // The on-insert trigger created the profile from metadata; fill in the
  // fields that only the app knows about.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phone || null,
      role: roleValue,
      catalog_manager: roleValue === "booking_staff" ? catalogManager : false,
      created_by: owner.id,
    })
    .eq("id", data.user.id);

  if (profileError) {
    return { error: `Account created, but profile update failed: ${profileError.message}` };
  }

  await logAudit({
    action: "user.create",
    entityType: "profile",
    entityId: data.user.id,
    summary: `Created ${ROLE_LABELS[roleValue]} account for ${fullName}`,
    details: { email, role: roleValue, catalog_manager: catalogManager },
  });

  revalidatePath("/users");

  return {
    success: `Account created for ${fullName}.`,
    temporaryPassword,
  };
}

export async function updateUserAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireOwner();

  const userId = String(formData.get("user_id") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const roleValue = String(formData.get("role") ?? "");
  const catalogManager = formData.get("catalog_manager") === "on";

  if (!userId || !fullName) {
    return { error: "Name is required." };
  }

  if (!isRole(roleValue)) {
    return { error: "Choose a valid role." };
  }

  if (roleValue !== "owner" && (await wouldRemoveLastOwner(userId))) {
    return {
      error:
        "This is the only active owner. Promote another owner before changing this role.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phone || null,
      role: roleValue,
      catalog_manager: roleValue === "booking_staff" ? catalogManager : false,
    })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  await logAudit({
    action: "user.update",
    entityType: "profile",
    entityId: userId,
    summary: `Updated ${fullName} (${ROLE_LABELS[roleValue]})`,
    details: { role: roleValue, catalog_manager: catalogManager },
  });

  revalidatePath("/users");
  return { success: `${fullName} updated.` };
}

export async function setUserActiveAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const owner = await requireOwner();

  const userId = String(formData.get("user_id") ?? "");
  const activate = formData.get("activate") === "true";

  if (!userId) {
    return { error: "Missing user." };
  }

  if (!activate) {
    if (userId === owner.id) {
      return { error: "You cannot deactivate your own account." };
    }
    if (await wouldRemoveLastOwner(userId)) {
      return {
        error:
          "This is the only active owner. Promote another owner before deactivating this account.",
      };
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ is_active: activate })
    .eq("id", userId)
    .select("full_name")
    .single();

  if (error) {
    return { error: error.message };
  }

  const name = data?.full_name ?? "User";

  await logAudit({
    action: activate ? "user.activate" : "user.deactivate",
    entityType: "profile",
    entityId: userId,
    summary: `${activate ? "Reactivated" : "Deactivated"} ${name}`,
  });

  revalidatePath("/users");
  return {
    success: `${name} ${activate ? "reactivated" : "deactivated"}.`,
  };
}

export async function resetUserPasswordAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireOwner();

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) {
    return { error: "Missing user." };
  }

  const temporaryPassword = generateTemporaryPassword();

  try {
    await adminResetPassword(userId, temporaryPassword);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not reset password.",
    };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();

  const name = data?.full_name ?? "User";

  await logAudit({
    action: "user.password_reset",
    entityType: "profile",
    entityId: userId,
    summary: `Reset password for ${name}`,
  });

  revalidatePath("/users");

  return {
    success: `Password reset for ${name}. They must change it at next sign-in.`,
    temporaryPassword,
  };
}
