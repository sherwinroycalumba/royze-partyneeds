import type { ReactNode } from "react";

import { getBusinessSettings, requireOwner } from "@/lib/auth/dal";
import { SETTINGS_SECTIONS } from "@/lib/nav";
import { Banner } from "@/components/ui/card";
import type { BusinessSettings } from "@/lib/supabase/database.types";

/**
 * Shared frame for every Settings sub-page.
 *
 * Each section is its own route (Spec 4.12 lists seven of them, which
 * is far too much for one scroll), so this centralises the Owner gate,
 * the settings lookup, and the missing-row guard rather than repeating
 * them seven times.
 */
export async function SettingsShell({
  section,
  children,
}: {
  /** Matches an entry in `SETTINGS_SECTIONS`. */
  section: string;
  children: (settings: BusinessSettings) => ReactNode;
}) {
  await requireOwner();
  const settings = await getBusinessSettings();

  const meta = SETTINGS_SECTIONS.find((entry) => entry.href.endsWith(section));

  if (!settings) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Banner tone="error">
          Business settings row is missing. Run the database migrations in{" "}
          <code>supabase/migrations/</code>, which seed it.
        </Banner>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Settings
        </p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
          {meta?.label ?? "Settings"}
        </h1>
        {meta?.description && (
          <p className="mt-1 text-sm text-ink-600">{meta.description}</p>
        )}
      </header>

      {children(settings)}
    </div>
  );
}
