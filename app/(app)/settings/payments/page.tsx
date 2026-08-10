import type { Metadata } from "next";

import { getPaymentAccounts } from "@/lib/auth/dal";
import { SettingsShell } from "../settings-shell";
import { PaymentAccountsForm } from "../settings-forms";

export const metadata: Metadata = { title: "Payment Channels" };

export default async function PaymentChannelsSettingsPage() {
  // The Owner gate lives in SettingsShell; this read is behind the same
  // RLS policy, which only exposes the accounts to signed-in staff.
  const accounts = await getPaymentAccounts();

  /**
   * The editor seeds its row state from these accounts, and a
   * `useState` initialiser only runs on mount — so after a save the
   * form would happily keep showing stale rows while the database said
   * something else. Keying on what was actually saved remounts the
   * editor whenever the server data changes, making the saved record
   * the single source of truth.
   *
   * `updated_at` is maintained by a trigger, so an edited row changes
   * the key; adding or removing one changes the id list.
   */
  const savedSignature = accounts
    .map((account) => `${account.id}:${account.updated_at}`)
    .join("|");

  return (
    <SettingsShell section="/payments">
      {(settings) => (
        <PaymentAccountsForm
          key={`${savedSignature}#${settings.updated_at}`}
          accounts={accounts}
          cashNote={settings.cash_payment_note}
        />
      )}
    </SettingsShell>
  );
}
