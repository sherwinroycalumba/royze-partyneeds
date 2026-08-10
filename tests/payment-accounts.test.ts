import { describe, expect, it } from "vitest";

import {
  accountsByChannel,
  activeAccounts,
  describeAccount,
  findDuplicateAccount,
  missingChannelsWarning,
  needsBankName,
  validatePaymentAccount,
  type PaymentAccountDraft,
} from "@/lib/settings/payment-accounts";
import type { PaymentAccount } from "@/lib/supabase/database.types";

function draft(
  overrides: Partial<PaymentAccountDraft> = {},
): PaymentAccountDraft {
  return {
    channel: "gcash",
    bank_name: "",
    account_name: "Royze Party Needs",
    account_number: "0917 123 4567",
    is_active: true,
    ...overrides,
  };
}

function account(overrides: Partial<PaymentAccount> = {}): PaymentAccount {
  return {
    id: "a",
    channel: "gcash",
    bank_name: "",
    account_name: "Royze Party Needs",
    account_number: "0917 123 4567",
    is_active: true,
    sort_order: 0,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("needsBankName", () => {
  it("is true only for bank transfers", () => {
    expect(needsBankName("bank_transfer")).toBe(true);
    expect(needsBankName("gcash")).toBe(false);
    expect(needsBankName("maya")).toBe(false);
  });
});

describe("validatePaymentAccount", () => {
  it("accepts a well-formed e-wallet account", () => {
    expect(validatePaymentAccount(draft())).toBeNull();
  });

  it("accepts a well-formed bank account", () => {
    expect(
      validatePaymentAccount(
        draft({
          channel: "bank_transfer",
          bank_name: "BPI",
          account_number: "1234-5678-90",
        }),
      ),
    ).toBeNull();
  });

  it("requires an account number", () => {
    expect(validatePaymentAccount(draft({ account_number: "  " }))).toMatch(
      /number is required/i,
    );
  });

  it("requires an account name — customers check it before sending", () => {
    expect(validatePaymentAccount(draft({ account_name: "" }))).toMatch(
      /account name is required/i,
    );
  });

  it("requires a bank name for bank transfers only", () => {
    expect(
      validatePaymentAccount(draft({ channel: "bank_transfer", bank_name: "" })),
    ).toMatch(/bank name/i);

    // An e-wallet with no bank name is perfectly normal.
    expect(validatePaymentAccount(draft({ bank_name: "" }))).toBeNull();
  });

  it("rejects an unrecognised channel", () => {
    const bogus = draft({
      channel: "paypal" as PaymentAccountDraft["channel"],
    });
    expect(validatePaymentAccount(bogus)).toMatch(/payment channel/i);
  });

  it("labels the row when given a position", () => {
    expect(validatePaymentAccount(draft({ account_number: "" }), 2)).toMatch(
      /^Row 3:/,
    );
  });
});

describe("findDuplicateAccount", () => {
  it("accepts several distinct accounts on the same channel", () => {
    expect(
      findDuplicateAccount([
        draft({ account_number: "0917 123 4567" }),
        draft({ account_number: "0918 765 4321" }),
      ]),
    ).toBeNull();
  });

  it("catches the same number written differently", () => {
    // Both print identically on a quotation.
    expect(
      findDuplicateAccount([
        draft({ account_number: "0917 123 4567" }),
        draft({ account_number: "0917-123-4567" }),
      ]),
    ).toMatch(/listed twice/i);
  });

  it("allows the same number across different channels", () => {
    // One mobile number really can hold both a GCash and a Maya wallet.
    expect(
      findDuplicateAccount([
        draft({ channel: "gcash" }),
        draft({ channel: "maya" }),
      ]),
    ).toBeNull();
  });

  it("separates identical account numbers at different banks", () => {
    expect(
      findDuplicateAccount([
        draft({ channel: "bank_transfer", bank_name: "BPI", account_number: "123" }),
        draft({ channel: "bank_transfer", bank_name: "BDO", account_number: "123" }),
      ]),
    ).toBeNull();
  });
});

describe("activeAccounts (what prints on documents)", () => {
  it("drops inactive accounts", () => {
    const rows = [
      account({ id: "a", is_active: true }),
      account({ id: "b", is_active: false }),
    ];
    expect(activeAccounts(rows).map((row) => row.id)).toEqual(["a"]);
  });

  it("orders by sort_order, then by name", () => {
    const rows = [
      account({ id: "c", sort_order: 2 }),
      account({ id: "a", sort_order: 0 }),
      account({ id: "b", sort_order: 1 }),
    ];
    expect(activeAccounts(rows).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when every account is inactive", () => {
    expect(activeAccounts([account({ is_active: false })])).toEqual([]);
  });
});

describe("accountsByChannel", () => {
  it("groups active accounts and omits empty channels", () => {
    const groups = accountsByChannel([
      account({ id: "a", channel: "gcash" }),
      account({ id: "b", channel: "gcash", account_number: "0918 000 1111" }),
      account({
        id: "c",
        channel: "bank_transfer",
        bank_name: "BPI",
        account_number: "1234",
      }),
      account({ id: "d", channel: "maya", is_active: false }),
    ]);

    expect(groups.map((group) => group.channel)).toEqual([
      "gcash",
      "bank_transfer",
    ]);
    expect(groups[0].accounts).toHaveLength(2);
    expect(groups[0].label).toBe("GCash");
  });

  it("is empty when nothing is active", () => {
    expect(accountsByChannel([account({ is_active: false })])).toEqual([]);
  });
});

describe("describeAccount", () => {
  it("leads with the bank for a transfer", () => {
    expect(
      describeAccount(
        account({
          channel: "bank_transfer",
          bank_name: "BPI",
          account_name: "Royze Party Needs",
          account_number: "1234-5678-90",
        }),
      ),
    ).toBe("BPI — Royze Party Needs · 1234-5678-90");
  });

  it("leads with the channel for an e-wallet", () => {
    expect(describeAccount(account())).toBe(
      "GCash — Royze Party Needs · 0917 123 4567",
    );
  });

  it("omits the dash when no account name is on file", () => {
    expect(describeAccount(account({ account_name: "" }))).toBe(
      "GCash · 0917 123 4567",
    );
  });
});

// ── Warning staff before a document goes out ──────────────────
describe("missingChannelsWarning", () => {
  it("says nothing when an active account exists", () => {
    expect(missingChannelsWarning([account({ is_active: true })])).toBeNull();
  });

  it("warns when nothing is configured at all", () => {
    // This is the state that once shipped quotations with no GCash
    // details on them, silently.
    expect(missingChannelsWarning([])).toMatch(/cash only/);
  });

  it("distinguishes 'none set up' from 'all switched off'", () => {
    expect(missingChannelsWarning([])).toMatch(/No payment channels are set up/);
    expect(
      missingChannelsWarning([account({ is_active: false })]),
    ).toMatch(/switched off/);
  });
});
