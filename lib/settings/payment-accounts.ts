import type {
  PaymentAccount,
  PaymentChannel,
} from "@/lib/supabase/database.types";

/**
 * Payment account rules (Spec 4.12).
 *
 * Dependency-free so the server action, the PDF renderer, and the tests
 * all agree on what a usable account looks like.
 */

export const PAYMENT_CHANNELS: readonly PaymentChannel[] = [
  "gcash",
  "maya",
  "bank_transfer",
];

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  gcash: "GCash",
  maya: "Maya",
  bank_transfer: "Bank Transfer",
};

export function isPaymentChannel(value: string): value is PaymentChannel {
  return (PAYMENT_CHANNELS as readonly string[]).includes(value);
}

/** Bank transfers carry a bank name; e-wallets do not. */
export function needsBankName(channel: PaymentChannel): boolean {
  return channel === "bank_transfer";
}

export type PaymentAccountDraft = {
  channel: PaymentChannel;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_active: boolean;
};

export function validatePaymentAccount(
  draft: PaymentAccountDraft,
  position?: number,
): string | null {
  const where = position === undefined ? "" : `Row ${position + 1}: `;

  if (!isPaymentChannel(draft.channel)) {
    return `${where}choose a payment channel.`;
  }

  if (!draft.account_number.trim()) {
    return `${where}an account or mobile number is required.`;
  }

  if (!draft.account_name.trim()) {
    return `${where}the account name is required — customers check it before sending money.`;
  }

  if (needsBankName(draft.channel) && !draft.bank_name.trim()) {
    return `${where}bank transfers need the bank name.`;
  }

  return null;
}

/** Rejects two accounts that would print identically on a document. */
export function findDuplicateAccount(
  drafts: readonly PaymentAccountDraft[],
): string | null {
  const seen = new Set<string>();

  for (const draft of drafts) {
    const key = [
      draft.channel,
      draft.bank_name.trim().toLowerCase(),
      draft.account_number.replace(/\D/g, ""),
    ].join("|");

    if (seen.has(key)) {
      return `${PAYMENT_CHANNEL_LABELS[draft.channel]} ${draft.account_number} is listed twice.`;
    }
    seen.add(key);
  }

  return null;
}

/**
 * The accounts a customer-facing document should print, in display
 * order (Spec 4.3 / 4.5). Inactive accounts are never included.
 */
export function activeAccounts(
  accounts: readonly PaymentAccount[],
): PaymentAccount[] {
  return accounts
    .filter((account) => account.is_active)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.account_name.localeCompare(b.account_name);
    });
}

/** Groups the active accounts by channel for the PDF payment block. */
export function accountsByChannel(
  accounts: readonly PaymentAccount[],
): { channel: PaymentChannel; label: string; accounts: PaymentAccount[] }[] {
  const active = activeAccounts(accounts);

  return PAYMENT_CHANNELS.map((channel) => ({
    channel,
    label: PAYMENT_CHANNEL_LABELS[channel],
    accounts: active.filter((account) => account.channel === channel),
  })).filter((group) => group.accounts.length > 0);
}

/**
 * The warning staff need before sending a document out, or null when
 * there is nothing to warn about (Spec 4.3 / 4.5).
 *
 * With no active account on file the PDF still renders — cash-only is
 * a legitimate way to run a business — but it goes to the customer
 * without a GCash or bank detail on it, and whoever is about to press
 * Send should know that before they do, not after.
 */
export function missingChannelsWarning(
  accounts: readonly PaymentAccount[],
): string | null {
  if (activeAccounts(accounts).length > 0) return null;

  return accounts.length === 0
    ? "No payment channels are set up, so documents will print with cash only. Add your GCash, Maya, or bank details under Settings → Payment Channels."
    : "Every payment account is switched off, so documents will print with cash only. Re-activate one under Settings → Payment Channels.";
}

/**
 * One-line rendering for a document or a list row:
 *   "BPI — Royze Party Needs · 1234-5678-90"
 *   "GCash — Royze Owner · 0917 123 4567"
 */
export function describeAccount(account: PaymentAccount): string {
  const heading = needsBankName(account.channel)
    ? account.bank_name
    : PAYMENT_CHANNEL_LABELS[account.channel];

  const name = account.account_name.trim();
  return `${heading}${name ? ` — ${name}` : ""} · ${account.account_number}`;
}
