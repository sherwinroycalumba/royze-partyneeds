import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  canRegenerate,
  canTransition,
  isAgreementStatus,
} from "@/lib/agreements/status";
import { confirmationVerdict, confirmationBlockers } from "@/lib/bookings/status";
import {
  canChangeStatus,
  expectsReference,
  initialStatus,
  isAutoVerified,
  isPaymentMethod,
  validatePayment,
  type PaymentDraft,
} from "@/lib/payments/methods";
import {
  isOverpaid,
  paidPercent,
  summarisePayments,
  type PaymentLike,
} from "@/lib/payments/totals";

function draft(overrides: Partial<PaymentDraft> = {}): PaymentDraft {
  return {
    amount_centavos: 500_000, // ₱5,000.00
    method: "gcash",
    paid_on: "2026-08-10",
    reference_number: "0012345678",
    ...overrides,
  };
}

function payment(
  amount: number,
  status: PaymentLike["status"] = "verified",
): PaymentLike {
  return { amount_centavos: amount, status };
}

// ── How money arrives (Spec 4.7) ──────────────────────────────
describe("payment methods", () => {
  it("verifies cash on sight and nothing else", () => {
    // The person recording cash is holding it; a GCash payment is a
    // claim that money moved until the owner checks the account.
    expect(isAutoVerified("cash")).toBe(true);
    expect(isAutoVerified("gcash")).toBe(false);
    expect(isAutoVerified("maya")).toBe(false);
    expect(isAutoVerified("bank_transfer")).toBe(false);
  });

  it("starts each method in the right status", () => {
    expect(initialStatus("cash")).toBe("verified");
    expect(initialStatus("gcash")).toBe("pending");
    expect(initialStatus("bank_transfer")).toBe("pending");
  });

  it("wants a reference for anything electronic", () => {
    expect(expectsReference("cash")).toBe(false);
    expect(expectsReference("maya")).toBe(true);
  });

  it("recognises its own method strings", () => {
    expect(isPaymentMethod("gcash")).toBe(true);
    expect(isPaymentMethod("cheque")).toBe(false);
  });

  it("lets the owner reject a payment they already verified", () => {
    // Owners do catch mistakes after the fact.
    expect(canChangeStatus("verified")).toBe(true);
    expect(canChangeStatus("pending")).toBe(true);
    expect(canChangeStatus("rejected")).toBe(false);
  });
});

describe("validatePayment", () => {
  it("accepts a sound payment", () => {
    expect(validatePayment(draft())).toBeNull();
  });

  it("refuses a zero or negative amount", () => {
    expect(validatePayment(draft({ amount_centavos: 0 }))).toMatch(/above ₱0/);
    expect(validatePayment(draft({ amount_centavos: -100 }))).toMatch(
      /above ₱0/,
    );
  });

  it("refuses an electronic payment with no reference", () => {
    // Without it there is nothing to check against the account, which
    // is the entire point of the verification step.
    expect(
      validatePayment(draft({ method: "gcash", reference_number: "  " })),
    ).toMatch(/reference number/);
  });

  it("does not ask cash for a reference", () => {
    expect(
      validatePayment(
        draft({ method: "cash", reference_number: "" }),
      ),
    ).toBeNull();
  });

  it("refuses a malformed date", () => {
    expect(validatePayment(draft({ paid_on: "10/08/2026" }))).toMatch(
      /calendar date/,
    );
  });
});

// ── What a booking has actually been paid ─────────────────────
describe("summarisePayments", () => {
  it("counts verified money only toward the balance", () => {
    const summary = summarisePayments(
      [payment(500_000, "verified"), payment(300_000, "pending")],
      1_000_000,
    );

    expect(summary.verified_centavos).toBe(500_000);
    expect(summary.pending_centavos).toBe(300_000);
    // The pending ₱3,000 does NOT reduce what is owed.
    expect(summary.balance_centavos).toBe(500_000);
    expect(summary.has_pending).toBe(true);
  });

  it("ignores rejected payments entirely", () => {
    const summary = summarisePayments(
      [payment(500_000, "verified"), payment(999_999, "rejected")],
      1_000_000,
    );

    expect(summary.verified_centavos).toBe(500_000);
    expect(summary.rejected_centavos).toBe(999_999);
    expect(summary.balance_centavos).toBe(500_000);
  });

  it("is all balance when nothing has been paid", () => {
    const summary = summarisePayments([], 1_000_000);
    expect(summary.verified_centavos).toBe(0);
    expect(summary.balance_centavos).toBe(1_000_000);
    expect(summary.has_pending).toBe(false);
  });

  it("shows an overpayment as a negative balance rather than hiding it", () => {
    const summary = summarisePayments([payment(1_200_000)], 1_000_000);
    expect(summary.balance_centavos).toBe(-200_000);
    expect(isOverpaid(1_200_000, 1_000_000)).toBe(true);
  });
});

describe("paidPercent", () => {
  it("reports whole percent of the total, verified money only", () => {
    expect(paidPercent(500_000, 1_000_000)).toBe(50);
    expect(paidPercent(333_333, 1_000_000)).toBe(33);
  });

  it("never exceeds 100, and copes with a zero total", () => {
    expect(paidPercent(1_500_000, 1_000_000)).toBe(100);
    expect(paidPercent(0, 0)).toBe(0);
  });
});

// ── The gate, now that payments are real (Spec 4.4) ───────────
describe("the Confirmed gate with real payments", () => {
  const total = 1_000_000; // ₱10,000.00

  it("stays shut when only pending payments cover the downpayment", () => {
    // This is the case the whole verification workflow exists for: a
    // customer says they sent ₱5,000 by GCash and the booking must
    // NOT become confirmable on their word alone.
    const summary = summarisePayments([payment(500_000, "pending")], total);

    const blockers = confirmationBlockers({
      agreement_signed: true,
      verified_paid_centavos: summary.verified_centavos,
      total_centavos: total,
      downpayment_percent: 50,
    });

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/₱0.00 of the ₱5,000.00 needed/);
  });

  it("opens once that same payment is verified", () => {
    const summary = summarisePayments([payment(500_000, "verified")], total);

    expect(
      confirmationBlockers({
        agreement_signed: true,
        verified_paid_centavos: summary.verified_centavos,
        total_centavos: total,
        downpayment_percent: 50,
      }),
    ).toEqual([]);
  });

  it("still needs the signed agreement, however much is paid", () => {
    const summary = summarisePayments([payment(1_000_000, "verified")], total);

    const verdict = confirmationVerdict({
      facts: {
        agreement_signed: false,
        verified_paid_centavos: summary.verified_centavos,
        total_centavos: total,
        downpayment_percent: 50,
      },
      isOwner: false,
      overrideReason: "",
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.error).toMatch(/agreement has not been signed/);
  });

  it("adds several verified payments together to clear the gate", () => {
    const summary = summarisePayments(
      [payment(200_000), payment(200_000), payment(100_000)],
      total,
    );

    expect(summary.verified_centavos).toBe(500_000);
    expect(
      confirmationBlockers({
        agreement_signed: true,
        verified_paid_centavos: summary.verified_centavos,
        total_centavos: total,
        downpayment_percent: 50,
      }),
    ).toEqual([]);
  });
});

// ── Agreement workflow (Spec 4.5) ─────────────────────────────
describe("agreement transitions", () => {
  it("walks Generated → Sent → Signed", () => {
    expect(canTransition("generated", "sent")).toBe(true);
    expect(canTransition("sent", "signed")).toBe(true);
  });

  it("allows signing straight from Generated", () => {
    // A customer at the shop signs the copy as it comes off the printer.
    expect(canTransition("generated", "signed")).toBe(true);
  });

  it("cannot be un-signed", () => {
    // That would reopen the Confirmed gate under a booking that may
    // already be out for delivery.
    expect(allowedTransitions("signed")).toEqual([]);
    expect(canTransition("signed", "sent")).toBe(false);
  });

  it("cannot be regenerated once signed", () => {
    expect(canRegenerate("generated")).toBe(true);
    expect(canRegenerate("sent")).toBe(true);
    expect(canRegenerate("signed")).toBe(false);
  });

  it("recognises its own status strings", () => {
    expect(isAgreementStatus("signed")).toBe(true);
    expect(isAgreementStatus("countersigned")).toBe(false);
  });
});
