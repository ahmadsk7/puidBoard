import { describe, it, expect } from "vitest";
import { getLatencyColor, generateRoomCode } from "./TopBar";

describe("TopBar", () => {
  describe("getLatencyColor", () => {
    it("returns green for < 100ms", () => {
      expect(getLatencyColor(0)).toBe("green");
      expect(getLatencyColor(99)).toBe("green");
    });
    it("returns yellow for 100-199ms", () => {
      expect(getLatencyColor(100)).toBe("yellow");
      expect(getLatencyColor(199)).toBe("yellow");
    });
    it("returns red for >= 200ms", () => {
      expect(getLatencyColor(200)).toBe("red");
      expect(getLatencyColor(500)).toBe("red");
    });
  });

  describe("generateRoomCode", () => {
    it("returns 6 character code", () => {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });
    it("returns different codes on multiple calls", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) codes.add(generateRoomCode());
      expect(codes.size).toBeGreaterThan(1);
    });
  });
});
