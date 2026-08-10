import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { DefaultsForm } from "../settings-forms";

export const metadata: Metadata = { title: "Booking Defaults" };

export default function BookingDefaultsSettingsPage() {
  return (
    <SettingsShell section="/defaults">
      {(settings) => <DefaultsForm settings={settings} />}
    </SettingsShell>
  );
}
