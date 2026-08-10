import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { BusinessProfileForm } from "../settings-forms";

export const metadata: Metadata = { title: "Business Profile" };

export default function BusinessProfileSettingsPage() {
  return (
    <SettingsShell section="/business">
      {(settings) => <BusinessProfileForm settings={settings} />}
    </SettingsShell>
  );
}
