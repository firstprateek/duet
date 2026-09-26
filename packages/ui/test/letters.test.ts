import { describe, expect, it } from "vitest";
import { avatarLetters } from "../src/letters.ts";

describe("avatar letters", () => {
  it("shows one letter when our initials differ", () => {
    expect(avatarLetters("Jack", ["Jack", "Maya"])).toBe("J");
    expect(avatarLetters("maya", ["Jack", "maya"])).toBe("M");
  });

  it("shows two when we share an initial", () => {
    expect(avatarLetters("Jack", ["Jack", "Jill"])).toBe("Ja");
    expect(avatarLetters("Jill", ["Jack", "Jill"])).toBe("Ji");
  });

  it("copes with no name, or no partner yet", () => {
    expect(avatarLetters("  ", ["Jill"])).toBe("?");
    expect(avatarLetters("Jill")).toBe("J");
  });
});
