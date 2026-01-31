import { describe, it, expect } from "vitest";
import {
  dbToLinear,
  linearToDb,
  equalPowerCrossfade,
  linearCrossfade,
  bipolarToGain,
  clamp,
} from "./params";

describe("params utilities", () => {
  describe("dbToLinear", () => {
    it("converts 0 dB to 1.0", () => {
      expect(dbToLinear(0)).toBeCloseTo(1.0);
    });

    it("converts -6 dB to ~0.5", () => {
      expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
    });

    it("converts -12 dB to ~0.25", () => {
      expect(dbToLinear(-12)).toBeCloseTo(0.251, 2);
    });

    it("converts +6 dB to ~2.0", () => {
      expect(dbToLinear(6)).toBeCloseTo(1.995, 2);
    });
  });

  describe("linearToDb", () => {
    it("converts 1.0 to 0 dB", () => {
      expect(linearToDb(1.0)).toBeCloseTo(0);
    });

    it("converts 0.5 to ~-6 dB", () => {
      expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1);
    });

    it("returns -Infinity for 0", () => {
      expect(linearToDb(0)).toBe(-Infinity);
    });
  });

  describe("equalPowerCrossfade", () => {
    it("returns [1, 0] at position 0", () => {
      const [a, b] = equalPowerCrossfade(0);
      expect(a).toBeCloseTo(1);
      expect(b).toBeCloseTo(0);
    });

    it("returns [0, 1] at position 1", () => {
      const [a, b] = equalPowerCrossfade(1);
      expect(a).toBeCloseTo(0);
      expect(b).toBeCloseTo(1);
    });

    it("returns equal values at center (0.5)", () => {
      const [a, b] = equalPowerCrossfade(0.5);
      // At center, both should be ~0.707 (sqrt(0.5))
      expect(a).toBeCloseTo(0.707, 2);
      expect(b).toBeCloseTo(0.707, 2);
    });

    it("maintains constant power (sum of squares = 1)", () => {
      for (const pos of [0, 0.25, 0.5, 0.75, 1]) {
        const [a, b] = equalPowerCrossfade(pos);
        expect(a * a + b * b).toBeCloseTo(1, 5);
      }
    });
  });

  describe("linearCrossfade", () => {
    it("returns [1, 0] at position 0", () => {
      const [a, b] = linearCrossfade(0);
      expect(a).toBe(1);
      expect(b).toBe(0);
    });

    it("returns [0, 1] at position 1", () => {
      const [a, b] = linearCrossfade(1);
      expect(a).toBe(0);
      expect(b).toBe(1);
    });

    it("returns [0.5, 0.5] at center", () => {
      const [a, b] = linearCrossfade(0.5);
      expect(a).toBe(0.5);
      expect(b).toBe(0.5);
    });
  });

  describe("bipolarToGain", () => {
    it("converts 0 to 1.0 (unity gain)", () => {
      expect(bipolarToGain(0)).toBeCloseTo(1);
    });

    it("converts -1 to -12dB", () => {
      expect(bipolarToGain(-1)).toBeCloseTo(dbToLinear(-12), 3);
    });

    it("converts +1 to +12dB", () => {
      expect(bipolarToGain(1)).toBeCloseTo(dbToLinear(12), 3);
    });
  });

  describe("clamp", () => {
    it("clamps below min", () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it("clamps above max", () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it("returns value within range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });
  });
});
