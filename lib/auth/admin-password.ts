import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sets a user's password using the service-role admin API and re-arms
 * the forced-change flag.
 *
 * This function performs NO authorization check of its own, so it must
 * never live in a `"use server"` module — that would publish it as a
 * client-callable endpoint able to reset any account's password. Callers
 * are responsible for calling `requireOwner()` first.
 */
export async function adminResetPassword(
  userId: string,
  temporaryPassword: string,
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });

  if (error) {
    throw new Error(`Could not reset password: ${error.message}`);
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);

  if (profileError) {
    throw new Error(`Could not flag password change: ${profileError.message}`);
  }
}
