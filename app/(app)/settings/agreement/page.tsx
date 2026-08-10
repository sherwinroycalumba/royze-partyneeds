import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { AgreementClausesForm } from "../settings-forms";

export const metadata: Metadata = { title: "Agreement Template" };

export default function AgreementTemplateSettingsPage() {
  return (
    <SettingsShell section="/agreement">
      {(settings) => <AgreementClausesForm settings={settings} />}
    </SettingsShell>
  );
}
