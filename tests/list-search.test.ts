import { describe, expect, it } from "vitest";

import { matchesQuery } from "@/components/ui/list-search";

describe("matchesQuery", () => {
  const supplier = [
    "Divisoria Balloon Supply",
    "Aling Nena",
    "0917 400 1122",
    "Latex balloons, foil balloons, balloon tape",
  ];

  it("matches everything when the query is blank", () => {
    expect(matchesQuery("", supplier)).toBe(true);
    expect(matchesQuery("   ", supplier)).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesQuery("DIVISORIA", supplier)).toBe(true);
  });

  it("matches a partial word", () => {
    expect(matchesQuery("ball", supplier)).toBe(true);
  });

  it("searches every field, not just the name", () => {
    expect(matchesQuery("nena", supplier)).toBe(true);
    expect(matchesQuery("foil", supplier)).toBe(true);
  });

  it("requires all terms, in any field and any order", () => {
    // "divisoria nena" spans the name and the contact person.
    expect(matchesQuery("divisoria nena", supplier)).toBe(true);
    expect(matchesQuery("divisoria absent", supplier)).toBe(false);
  });

  it("matches a phone number regardless of formatting", () => {
    // Staff type the number the way it appears on their phone.
    expect(matchesQuery("09174001122", supplier)).toBe(true);
    expect(matchesQuery("0917 400", supplier)).toBe(true);
    expect(matchesQuery("4001122", supplier)).toBe(true);
  });

  it("does not match an unrelated number", () => {
    expect(matchesQuery("09999999999", supplier)).toBe(false);
  });

  it("skips null and undefined fields", () => {
    expect(matchesQuery("maria", ["Maria Santos", null, undefined])).toBe(true);
    expect(matchesQuery("jose", ["Maria Santos", null, undefined])).toBe(false);
  });

  it("finds a name split across punctuation", () => {
    expect(matchesQuery("santos", ["Maria (Santos)"])).toBe(true);
  });

  it("returns false for an empty field list with a real query", () => {
    expect(matchesQuery("anything", [])).toBe(false);
  });
});
