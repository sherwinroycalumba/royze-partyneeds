import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { DeliverySettingsForm } from "../settings-forms";

export const metadata: Metadata = { title: "Delivery Fees" };

export default function DeliverySettingsPage() {
  return (
    <SettingsShell section="/delivery">
      {(settings) => (
        // Keyed on updated_at so a save re-seeds the editor from
        // what was actually stored — a useState initialiser only
        // runs on mount, and would otherwise keep stale rows.
        <DeliverySettingsForm key={settings.updated_at} settings={settings} />
      )}
    </SettingsShell>
  );
}
