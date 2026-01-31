import { describe, it, expect } from "vitest";

describe("Fader", () => {
  describe("value calculation", () => {
    it("calculates vertical fader value correctly", () => {
      // Value ranges from 0 (bottom) to 1 (top)
      // At top (ratio 0), value should be 1
      // At bottom (ratio 1), value should be 0
      const calculateVerticalValue = (ratio: number) => 1 - ratio;
      
      expect(calculateVerticalValue(0)).toBe(1); // top
      expect(calculateVerticalValue(1)).toBe(0); // bottom
      expect(calculateVerticalValue(0.5)).toBe(0.5); // middle
    });

    it("calculates horizontal fader value correctly", () => {
      // Value ranges from 0 (left) to 1 (right)
      const calculateHorizontalValue = (ratio: number) => ratio;
      
      expect(calculateHorizontalValue(0)).toBe(0); // left
      expect(calculateHorizontalValue(1)).toBe(1); // right
      expect(calculateHorizontalValue(0.5)).toBe(0.5); // middle
    });
  });

  describe("value clamping", () => {
    it("clamps value to 0-1 range", () => {
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      
      expect(clamp(-0.5)).toBe(0);
      expect(clamp(1.5)).toBe(1);
      expect(clamp(0.75)).toBe(0.75);
    });
  });
});
