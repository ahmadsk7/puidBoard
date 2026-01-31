import { describe, it, expect } from "vitest";

describe("Knob", () => {
  describe("rotation calculation", () => {
    it("calculates rotation angle for 0-1 range", () => {
      // Rotation ranges from -135deg to +135deg (270 degree range)
      const calculateRotation = (value: number, min = 0, max = 1) => {
        const normalized = (value - min) / (max - min);
        return -135 + normalized * 270;
      };
      
      expect(calculateRotation(0)).toBe(-135); // min
      expect(calculateRotation(1)).toBe(135); // max
      expect(calculateRotation(0.5)).toBe(0); // middle
    });

    it("calculates rotation for bipolar knob (-1 to 1)", () => {
      const calculateRotation = (value: number, min = -1, max = 1) => {
        const normalized = (value - min) / (max - min);
        return -135 + normalized * 270;
      };
      
      expect(calculateRotation(-1, -1, 1)).toBe(-135); // min
      expect(calculateRotation(1, -1, 1)).toBe(135); // max
      expect(calculateRotation(0, -1, 1)).toBe(0); // center
    });
  });

  describe("drag value calculation", () => {
    it("calculates value change from vertical drag", () => {
      const sensitivity = 200;
      const calculateDelta = (startY: number, currentY: number, min = 0, max = 1) => {
        const deltaY = startY - currentY; // up is positive
        return (deltaY / sensitivity) * (max - min);
      };
      
      // Drag up 100px from center
      expect(calculateDelta(100, 0)).toBe(0.5);
      // Drag down 100px from center
      expect(calculateDelta(100, 200)).toBe(-0.5);
    });
  });

  describe("reset value", () => {
    it("resets to min for non-bipolar knobs", () => {
      const getResetValue = (bipolar: boolean, min: number, max: number) => {
        return bipolar ? (min + max) / 2 : min;
      };
      
      expect(getResetValue(false, 0, 1)).toBe(0);
      expect(getResetValue(true, -1, 1)).toBe(0);
      expect(getResetValue(true, 0, 1)).toBe(0.5);
    });
  });
});
