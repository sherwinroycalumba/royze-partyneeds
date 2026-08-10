import { describe, expect, it } from "vitest";

import {
  findPhoneDuplicates,
  normalizePhone,
  phoneMatchKey,
  samePhone,
  validateCustomer,
  validateSupplier,
} from "@/lib/customers/matching";

describe("normalizePhone", () => {
  it("strips spaces, dashes, and plus signs", () => {
    expect(normalizePhone("+63 917-123 4567")).toBe("639171234567");
    expect(normalizePhone("0917 123 4567")).toBe("09171234567");
  });

  it("returns an empty string for a blank number", () => {
    expect(normalizePhone("   ")).toBe("");
  });
});

describe("phoneMatchKey", () => {
  it("compares on the last ten digits", () => {
    // The three ways staff write one PH mobile number.
    expect(phoneMatchKey("09171234567")).toBe("9171234567");
    expect(phoneMatchKey("+639171234567")).toBe("9171234567");
    expect(phoneMatchKey("639171234567")).toBe("9171234567");
  });

  it("keeps short numbers whole", () => {
    expect(phoneMatchKey("(044) 123 4567")).toBe("0441234567");
    expect(phoneMatchKey("1234567")).toBe("1234567");
  });
});

describe("samePhone", () => {
  it("matches the same handset written differently", () => {
    expect(samePhone("0917 123 4567", "+63 917 123 4567")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(samePhone("09171234567", "09181234567")).toBe(false);
  });

  it("never matches on a blank number", () => {
    // Plenty of walk-ins leave no number; they are not all one person.
    expect(samePhone("", "")).toBe(false);
    expect(samePhone("09171234567", "")).toBe(false);
  });
});

describe("findPhoneDuplicates (Spec 4.1)", () => {
  const customers = [
    { id: "a", phone: "0917 123 4567" },
    { id: "b", phone: "+639171234567" },
    { id: "c", phone: "0918 999 0000" },
  ];

  it("finds every customer on the same number", () => {
    expect(findPhoneDuplicates("09171234567", customers).map((c) => c.id)).toEqual(
      ["a", "b"],
    );
  });

  it("excludes the record being edited", () => {
    expect(
      findPhoneDuplicates("09171234567", customers, "a").map((c) => c.id),
    ).toEqual(["b"]);
  });

  it("finds nothing for an unused number", () => {
    expect(findPhoneDuplicates("09990000000", customers)).toEqual([]);
  });

  it("finds nothing when no number was given", () => {
    expect(findPhoneDuplicates("", customers)).toEqual([]);
  });
});

describe("validateCustomer", () => {
  it("accepts a complete record", () => {
    expect(
      validateCustomer({
        name: "Maria Santos",
        phone: "0917 123 4567",
        email: "maria@example.com",
      }),
    ).toBeNull();
  });

  it("requires a name", () => {
    expect(
      validateCustomer({ name: "  ", phone: "09171234567", email: null }),
    ).toMatch(/name/i);
  });

  it("requires a contact number — the driver needs it on the day", () => {
    expect(
      validateCustomer({ name: "Maria Santos", phone: "", email: null }),
    ).toMatch(/contact number/i);
  });

  it("rejects a number that is too short to dial", () => {
    expect(
      validateCustomer({ name: "Maria Santos", phone: "12345", email: null }),
    ).toMatch(/too short/i);
  });

  it("rejects a malformed email but accepts none at all", () => {
    expect(
      validateCustomer({
        name: "Maria Santos",
        phone: "09171234567",
        email: "not-an-email",
      }),
    ).toMatch(/email/i);

    expect(
      validateCustomer({
        name: "Maria Santos",
        phone: "09171234567",
        email: null,
      }),
    ).toBeNull();
  });
});

describe("validateSupplier", () => {
  it("needs only a name", () => {
    expect(validateSupplier({ name: "Divisoria Balloons", email: null })).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(validateSupplier({ name: "", email: null })).toMatch(/name/i);
  });

  it("rejects a malformed email", () => {
    expect(
      validateSupplier({ name: "Divisoria Balloons", email: "nope" }),
    ).toMatch(/email/i);
  });
});
