"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { FormState } from "@/lib/forms";
import { requireUserAllowingPasswordChange } from "./dal";
import { validatePassword } from "./password";

/**
 * Server actions only.
 *
 * Every export of a `"use server"` module becomes an endpoint the client
 * can invoke with arbitrary arguments, so nothing lands here unless it
 * authorizes itself. Constants and pure helpers live in ./password.ts;
 * privileged admin helpers live in ./admin-password.ts.
 */

export async function signInAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // Deliberately vague: never reveal whether the email exists.
    return { error: "Incorrect email or password." };
  }

  // A deactivated account must not hold a usable session, even if the
  // password is still correct (Spec 3).
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active, must_change_password")
    .eq("id", data.user.id)
    .single();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact the owner." };
  }

  if (profile.must_change_password) {
    redirect("/change-password");
  }

  // Only follow same-origin relative paths — an open redirect here would
  // let a crafted link bounce a signed-in user to an external site.
  const destination =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePasswordAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await requireUserAllowingPasswordChange();

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  const invalid = validatePassword(password);
  if (invalid) {
    return { error: invalid };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  // Clear the forced-change flag through the SECURITY DEFINER function,
  // which touches only that one column.
  const { error: rpcError } = await supabase.rpc("complete_password_change");

  if (rpcError) {
    // The password did change; surface the mismatch rather than looping
    // the user back through this screen silently.
    return {
      error:
        "Password updated, but the account flag could not be cleared. Please sign in again.",
    };
  }

  await logAudit({
    action: "user.password_change",
    entityType: "profile",
    entityId: profile.id,
    summary: `${profile.full_name || profile.email} changed their password`,
  });

  redirect("/dashboard");
}
