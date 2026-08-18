"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser Supabase client. Used only for interactive auth calls that
 * must run client-side; all data reads and writes go through Server
 * Components and Server Actions so authorization stays server-side.
 */
export function createClient() {
  return createBrowserClient<Database>(
    supabaseUrl(),
    supabasePublishableKey(),
  );
}
