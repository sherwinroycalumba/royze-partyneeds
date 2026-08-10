import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { ExpenseCategoriesForm } from "../settings-forms";

export const metadata: Metadata = { title: "Expense Categories" };

export default function ExpenseCategoriesSettingsPage() {
  return (
    <SettingsShell section="/expenses">
      {(settings) => (
        // Keyed on updated_at so a save re-seeds the editor from
        // what was actually stored — a useState initialiser only
        // runs on mount, and would otherwise keep stale rows.
        <ExpenseCategoriesForm key={settings.updated_at} settings={settings} />
      )}
    </SettingsShell>
  );
}
