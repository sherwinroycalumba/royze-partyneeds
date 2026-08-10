import type { Metadata } from "next";

import { getPaymentAccounts } from "@/lib/auth/dal";
import { SettingsShell } from "../settings-shell";
import { PaymentAccountsForm } from "../settings-forms";

export const metadata: Metadata = { title: "Payment Channels" };

export default async function PaymentChannelsSettingsPage() {
  // The Owner gate lives in SettingsShell; this read is behind the same
  // RLS policy, which only exposes the accounts to signed-in staff.
  const accounts = await getPaymentAccounts();

  return (
    <SettingsShell section="/payments">
      {() => <PaymentAccountsForm accounts={accounts} />}
    </SettingsShell>
  );
}
