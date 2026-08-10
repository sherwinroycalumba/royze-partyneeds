import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { AgreementClausesForm } from "../settings-forms";

export const metadata: Metadata = { title: "Agreement Template" };

export default function AgreementTemplateSettingsPage() {
  return (
    <SettingsShell section="/agreement">
      {(settings) => (
        // Keyed on updated_at so a save re-seeds the editor from
        // what was actually stored — a useState initialiser only
        // runs on mount, and would otherwise keep stale rows.
        <AgreementClausesForm key={settings.updated_at} settings={settings} />
      )}
    </SettingsShell>
  );
}
