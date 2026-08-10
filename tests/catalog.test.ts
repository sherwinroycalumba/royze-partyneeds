import { describe, expect, it } from "vitest";

import {
  itemTypeLabel,
  stockStatus,
  validateCatalogItem,
  type CatalogItemDraft,
} from "@/lib/catalog/items";
import { priceChanges } from "@/lib/catalog/price-history";
import {
  componentSummary,
  componentsSubtotal,
  packageSavings,
  validatePackage,
  type ComponentDraft,
  type PackageDraft,
} from "@/lib/catalog/packages";

function itemDraft(overrides: Partial<CatalogItemDraft> = {}): CatalogItemDraft {
  return {
    name: "3x3m Tent",
    category: "Tents",
    description: "",
    is_rental: true,
    is_sale: false,
    rental_price_centavos: 150_000,
    replacement_value_centavos: 800_000,
    quantity_owned: 4,
    sale_price_centavos: 0,
    cost_price_centavos: 0,
    stock_quantity: 0,
    low_stock_threshold: 0,
    ...overrides,
  };
}

describe("validateCatalogItem", () => {
  it("accepts a well-formed rental item", () => {
    expect(validateCatalogItem(itemDraft())).toBeNull();
  });

  it("requires a name", () => {
    expect(validateCatalogItem(itemDraft({ name: "   " }))).toMatch(/name/i);
  });

  it("requires the item to be a rental, a sale item, or both (Spec 4.2)", () => {
    const neither = itemDraft({ is_rental: false, is_sale: false });
    expect(validateCatalogItem(neither)).toMatch(/rental item, a sale item/i);
  });

  it("accepts an item that is both rented and sold", () => {
    const both = itemDraft({
      name: "Table Cover",
      is_sale: true,
      sale_price_centavos: 25_000,
    });
    expect(validateCatalogItem(both)).toBeNull();
  });

  it("rejects fractional centavos — money is integers only (Spec 5)", () => {
    const drifted = itemDraft({ rental_price_centavos: 150_000.5 });
    expect(validateCatalogItem(drifted)).toMatch(/prices/i);
  });

  it("rejects negative prices", () => {
    expect(validateCatalogItem(itemDraft({ rental_price_centavos: -1 }))).toMatch(
      /prices/i,
    );
  });

  it("insists a rental item owns at least one unit", () => {
    expect(validateCatalogItem(itemDraft({ quantity_owned: 0 }))).toMatch(
      /quantity owned/i,
    );
  });

  it("insists a rental item carries a replacement value (Spec 4.5)", () => {
    // The agreement charges damaged and lost items at this value, so a
    // zero here would silently waive every damage charge.
    expect(
      validateCatalogItem(itemDraft({ replacement_value_centavos: 0 })),
    ).toMatch(/replacement value/i);
  });

  it("insists a sale item is priced above zero", () => {
    const free = itemDraft({
      is_rental: false,
      is_sale: true,
      rental_price_centavos: 0,
      replacement_value_centavos: 0,
      quantity_owned: 0,
      sale_price_centavos: 0,
    });
    expect(validateCatalogItem(free)).toMatch(/unit price/i);
  });

  it("rejects fractional quantities", () => {
    expect(validateCatalogItem(itemDraft({ quantity_owned: 2.5 }))).toMatch(
      /quantities/i,
    );
  });
});

describe("itemTypeLabel", () => {
  it("names each combination", () => {
    expect(itemTypeLabel({ is_rental: true, is_sale: false })).toBe("Rental");
    expect(itemTypeLabel({ is_rental: false, is_sale: true })).toBe("Sale");
    expect(itemTypeLabel({ is_rental: true, is_sale: true })).toBe(
      "Rental & Sale",
    );
  });
});

describe("stockStatus", () => {
  it("ignores rental-only items", () => {
    expect(
      stockStatus({ is_sale: false, stock_quantity: 0, low_stock_threshold: 5 }),
    ).toBe("not_stocked");
  });

  it("flags an empty shelf", () => {
    expect(
      stockStatus({ is_sale: true, stock_quantity: 0, low_stock_threshold: 5 }),
    ).toBe("out");
  });

  it("flags stock at or below the threshold", () => {
    expect(
      stockStatus({ is_sale: true, stock_quantity: 5, low_stock_threshold: 5 }),
    ).toBe("low");
    expect(
      stockStatus({ is_sale: true, stock_quantity: 4, low_stock_threshold: 5 }),
    ).toBe("low");
  });

  it("stays quiet above the threshold", () => {
    expect(
      stockStatus({ is_sale: true, stock_quantity: 6, low_stock_threshold: 5 }),
    ).toBe("ok");
  });

  it("treats a zero threshold as alerting turned off", () => {
    expect(
      stockStatus({ is_sale: true, stock_quantity: 1, low_stock_threshold: 0 }),
    ).toBe("ok");
  });
});

describe("priceChanges (Spec 4.2 price history)", () => {
  it("reports only the money fields that moved", () => {
    const changes = priceChanges(
      { rental_price_centavos: 150_000, sale_price_centavos: 25_000 },
      { rental_price_centavos: 175_000, sale_price_centavos: 25_000 },
    );

    expect(changes).toEqual([
      {
        field: "rental_price_centavos",
        label: "Rental price",
        from: 150_000,
        to: 175_000,
      },
    ]);
  });

  it("is empty when only non-price fields changed", () => {
    expect(
      priceChanges(
        { rental_price_centavos: 150_000 },
        { rental_price_centavos: 150_000 },
      ),
    ).toEqual([]);
  });

  it("skips fields the record does not carry", () => {
    // A catalog item has no package price, and vice versa.
    expect(
      priceChanges(
        { package_price_centavos: 450_000 },
        { package_price_centavos: 500_000, rental_price_centavos: 1 },
      ),
    ).toEqual([
      {
        field: "package_price_centavos",
        label: "Package price",
        from: 450_000,
        to: 500_000,
      },
    ]);
  });
});

describe("package pricing", () => {
  const components = [
    { name: "Arch Frame", quantity: 1, unit_centavos: 100_000 },
    { name: "Balloons", quantity: 100, unit_centavos: 1_500 },
    { name: "Fairy Lights", quantity: 2, unit_centavos: 25_000 },
  ];

  it("totals the components exactly", () => {
    // 1,000.00 + 1,500.00 + 500.00 = 3,000.00
    expect(componentsSubtotal(components)).toBe(300_000);
  });

  it("reports what the bundle saves against the parts", () => {
    expect(packageSavings(250_000, 300_000)).toBe(50_000);
  });

  it("reports a negative saving when the bundle costs more", () => {
    // Legitimate: the package price also covers setup and teardown.
    expect(packageSavings(350_000, 300_000)).toBe(-50_000);
  });

  it("summarises components for the customer-facing line (Spec 4.4)", () => {
    expect(componentSummary(components)).toBe(
      "1 × Arch Frame, 100 × Balloons, 2 × Fairy Lights",
    );
  });

  it("truncates a long component list", () => {
    expect(componentSummary(components, 2)).toBe(
      "1 × Arch Frame, 100 × Balloons, +1 more",
    );
  });

  it("summarises an empty list as empty", () => {
    expect(componentSummary([])).toBe("");
  });
});

describe("validatePackage", () => {
  function packageDraft(overrides: Partial<PackageDraft> = {}): PackageDraft {
    return {
      name: "Birthday Arch Package",
      description: "",
      occasion_tags: ["birthday"],
      package_price_centavos: 450_000,
      setup_minutes: 90,
      teardown_notes: "",
      ...overrides,
    };
  }

  const components: ComponentDraft[] = [
    {
      catalog_item_id: "item-1",
      quantity: 1,
      kind: "structure",
      consumes_stock: false,
    },
  ];

  it("accepts a well-formed package", () => {
    expect(validatePackage(packageDraft(), components)).toBeNull();
  });

  it("requires a name", () => {
    expect(validatePackage(packageDraft({ name: "" }), components)).toMatch(
      /name/i,
    );
  });

  it("requires a price above zero", () => {
    expect(
      validatePackage(packageDraft({ package_price_centavos: 0 }), components),
    ).toMatch(/package price/i);
  });

  it("rejects an unrecognised occasion", () => {
    expect(
      validatePackage(packageDraft({ occasion_tags: ["fiesta"] }), components),
    ).toMatch(/not a recognised occasion/i);
  });

  it("requires at least one component to reserve", () => {
    expect(validatePackage(packageDraft(), [])).toMatch(/at least one/i);
  });

  it("rejects the same item listed twice", () => {
    // Two rows for one arch would double-reserve it (Spec 4.4).
    expect(validatePackage(packageDraft(), [...components, ...components])).toMatch(
      /listed twice/i,
    );
  });

  it("rejects a zero component quantity", () => {
    const zero: ComponentDraft[] = [{ ...components[0], quantity: 0 }];
    expect(validatePackage(packageDraft(), zero)).toMatch(/quantities/i);
  });
});
