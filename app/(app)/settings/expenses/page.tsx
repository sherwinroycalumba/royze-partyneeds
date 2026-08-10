import type { Metadata } from "next";

import { SettingsShell } from "../settings-shell";
import { ExpenseCategoriesForm } from "../settings-forms";

export const metadata: Metadata = { title: "Expense Categories" };

export default function ExpenseCategoriesSettingsPage() {
  return (
    <SettingsShell section="/expenses">
      {(settings) => <ExpenseCategoriesForm settings={settings} />}
    </SettingsShell>
  );
}
