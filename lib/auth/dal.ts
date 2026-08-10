import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type {
  BusinessSettings,
  PaymentAccount,
  Profile,
} from "@/lib/supabase/database.types";
import { can, type Permission } from "./permissions";

/**
 * Data Access Layer.
 *
 * Every authenticated page and Server Action goes through here. Nothing
 * else in the app reads the session directly, so authorization has one
 * enforcement point rather than being scattered across components.
 */

/**
 * The signed-in auth user, verified against the Auth server.
 *
 * Deliberately `getUser()` and not `getSession()`: the session cookie is
 * attacker-modifiable, so it must never be trusted for authorization.
 * `cache` dedupes the round trip within a single request.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The signed-in user's profile, or null if signed out. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data ?? null;
});

/**
 * Gate for every page inside the authenticated app.
 *
 * Sends signed-out users to the login screen, deactivated users back out
 * with a reason, and anyone still carrying a temporary password to the
 * password-change screen (Spec 3).
 */
export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.is_active) {
    // Deactivated mid-session: end the session rather than leaving a
    // usable cookie behind.
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?error=deactivated");
  }

  if (profile.must_change_password) {
    redirect("/change-password");
  }

  return profile;
}

/**
 * Like `requireUser`, but skips the must-change-password redirect so the
 * password-change screen itself does not bounce in a loop.
 */
export async function requireUserAllowingPasswordChange(): Promise<Profile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.is_active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?error=deactivated");
  }

  return profile;
}

/** Require a specific permission; renders the 403 page if missing. */
export async function requirePermission(
  permission: Permission,
): Promise<Profile> {
  const profile = await requireUser();

  if (!can(profile, permission)) {
    forbidden();
  }

  return profile;
}

/** Shorthand for the many Owner-only surfaces (Spec 3). */
export async function requireOwner(): Promise<Profile> {
  const profile = await requireUser();

  if (profile.role !== "owner") {
    forbidden();
  }

  return profile;
}

/**
 * Permission check that returns a boolean instead of redirecting —
 * for conditionally rendering nav items and action buttons. The server
 * still re-checks on the action itself; this only hides affordances.
 */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const profile = await getCurrentProfile();
  if (!profile) return false;
  return can(profile, permission);
}

/**
 * A read that should have worked and did not — a missing table, a
 * broken policy, a database that is down.
 *
 * Deliberately distinct from "there is nothing here yet". An empty
 * list of payment accounts is a legitimate state; a *failure to read*
 * them is not, and must never quietly render as the same thing. That
 * confusion once shipped quotations with no GCash details on them.
 */
export class DataAccessError extends Error {}

/**
 * Every payment account on file, in display order (Spec 4.12).
 *
 * Returns inactive ones too — the settings screen edits them. Callers
 * rendering a customer-facing document must narrow with
 * `activeAccounts` from `lib/settings/payment-accounts`.
 *
 * Throws rather than returning `[]` when the read fails: a document
 * that silently omits where to send money is worse than one that
 * refuses to render.
 */
export const getPaymentAccounts = cache(
  async (): Promise<PaymentAccount[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payment_accounts")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      throw new DataAccessError(
        `Could not read the payment accounts: ${error.message}`,
      );
    }

    return data ?? [];
  },
);

/**
 * Business settings singleton — read on nearly every page and PDF.
 *
 * `null` means the row has not been created yet, which callers handle.
 * A failed read throws, for the same reason as above.
 */
export const getBusinessSettings = cache(
  async (): Promise<BusinessSettings | null> => {
    const supabase = await createClient();
    // maybeSingle, so "no row yet" is null rather than an error and the
    // two cases stay distinguishable.
    const { data, error } = await supabase
      .from("business_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      throw new DataAccessError(
        `Could not read the business settings: ${error.message}`,
      );
    }

    return data ?? null;
  },
);
