import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

/**
 * Service-role client. Bypasses RLS entirely — it exists only for the
 * owner-driven admin operations that the Supabase Auth admin API
 * requires: creating staff accounts, resetting passwords, and
 * deactivating users.
 *
 * NEVER import this from a Client Component, and never call it without
 * first checking the caller is the Owner via `requireRole` in the DAL.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
