import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Request-scoped Supabase client that reads the session from cookies
 * and runs as the signed-in user, so RLS applies.
 *
 * Next 16 note: `cookies()` is async-only, so this is an async factory.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Refreshed tokens are
          // written by proxy.ts on the next request instead, so this is
          // safe to swallow.
        }
      },
    },
  });
}
