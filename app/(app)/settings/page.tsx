import { redirect } from "next/navigation";

import { SETTINGS_SECTIONS } from "@/lib/nav";

/**
 * Settings has no landing page of its own — it opens on its first
 * section, which keeps the sidebar's Settings link useful.
 */
export default function SettingsIndexPage() {
  redirect(SETTINGS_SECTIONS[0].href);
}
