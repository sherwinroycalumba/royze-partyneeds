import type { ReactNode } from "react";

import { getBusinessSettings, requireUser } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { visibleNav } from "@/lib/nav";
import { AppShell } from "@/components/shell/app-shell";

/**
 * Layout for every authenticated screen. `requireUser` runs here, so no
 * page inside this group renders for a signed-out, deactivated, or
 * password-change-pending user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireUser();
  const settings = await getBusinessSettings();

  // The nav shows only what this user is actually allowed to open, and
  // a group whose every link is hidden disappears with it.
  const entries = visibleNav(profile);

  return (
    <AppShell
      entries={entries}
      userKey={profile.id}
      user={{
        name: profile.full_name || profile.email,
        email: profile.email,
        roleLabel: ROLE_LABELS[profile.role],
      }}
      businessName={settings?.business_name ?? "Royze Party Needs Rental"}
      logoUrl={settings?.logo_url ?? null}
    >
      {children}
    </AppShell>
  );
}
