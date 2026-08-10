/**
 * Customer matching and validation (Spec 4.1).
 *
 * Duplicate detection is a *warning*, never a block: families and
 * barkadas genuinely share one number, and staff booking from a phone
 * must never be stopped mid-flow. The warning simply offers the
 * existing customer as a link.
 */

/** Digits only — mirrors the generated `phone_digits` column. */
export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * The comparison key for duplicate detection: the last 10 digits.
 *
 * PH mobile numbers reach the same handset as `09171234567`,
 * `+639171234567`, and `639171234567`; all three end in the same ten
 * digits. Shorter numbers (landlines) are compared whole.
 */
export function phoneMatchKey(input: string): string {
  const digits = normalizePhone(input);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function samePhone(a: string, b: string): boolean {
  const left = phoneMatchKey(a);
  const right = phoneMatchKey(b);
  // Two blank numbers are not a match — plenty of walk-ins have none.
  if (!left || !right) return false;
  return left === right;
}

/** Existing customers whose number reaches the same handset. */
export function findPhoneDuplicates<T extends { id: string; phone: string }>(
  phone: string,
  customers: readonly T[],
  excludeId?: string,
): T[] {
  if (!phoneMatchKey(phone)) return [];

  return customers.filter(
    (customer) => customer.id !== excludeId && samePhone(customer.phone, phone),
  );
}

export type CustomerDraft = {
  name: string;
  phone: string;
  email: string | null;
};

export function validateCustomer(draft: CustomerDraft): string | null {
  if (!draft.name.trim()) {
    return "Customer name is required.";
  }

  // A number is how staff reach the customer on the event day, so it is
  // required even though the schema tolerates a blank one for imports.
  if (!normalizePhone(draft.phone)) {
    return "A contact number is required.";
  }

  if (normalizePhone(draft.phone).length < 7) {
    return "That contact number looks too short.";
  }

  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) {
    return "Enter a valid email address, or leave it blank.";
  }

  return null;
}

export function validateSupplier(draft: {
  name: string;
  email: string | null;
}): string | null {
  if (!draft.name.trim()) {
    return "Supplier name is required.";
  }

  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) {
    return "Enter a valid email address, or leave it blank.";
  }

  return null;
}
