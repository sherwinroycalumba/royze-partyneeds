import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { DeliverySettingsForm } from "../settings-forms";

export const metadata: Metadata = { title: "Delivery Fees" };

export default function DeliverySettingsPage() {
  return (
    <SettingsShell section="/delivery">
      {(settings) => <DeliverySettingsForm settings={settings} />}
    </SettingsShell>
  );
}
