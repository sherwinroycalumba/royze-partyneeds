import type { ReactNode } from "react";

import { getBusinessSettings, requireUser } from "@/lib/auth/dal";
import { canAny, ROLE_LABELS } from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { AppShell } from "@/components/shell/app-shell";

/**
 * Layout for every authenticated screen. `requireUser` runs here, so no
 * page inside this group renders for a signed-out, deactivated, or
 * password-change-pending user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireUser();
  const settings = await getBusinessSettings();

  // The nav shows only what this user is actually allowed to open.
  const items = NAV_ITEMS.filter((item) =>
    canAny(profile, item.permissions),
  );

  return (
    <AppShell
      items={[...items]}
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
