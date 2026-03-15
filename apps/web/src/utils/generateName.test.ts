import { describe, it, expect } from "vitest";
import { generateRandomName } from "./generateName";

describe("generateRandomName", () => {
  it("returns a non-empty string", () => {
    const name = generateRandomName();
    expect(name.length).toBeGreaterThan(0);
  });

  it("matches the AdjectiveNounNN format", () => {
    const name = generateRandomName();
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
  });

  it("is at most 32 characters", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRandomName().length).toBeLessThanOrEqual(32);
    }
  });

  it("produces varied names", () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) names.add(generateRandomName());
    expect(names.size).toBeGreaterThan(10);
  });
});
