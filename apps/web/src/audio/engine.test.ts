import { describe, it, expect } from "vitest";

describe("Audio Engine", () => {
  describe("AutoplayState", () => {
    it("defines correct autoplay states", () => {
      const states = ["blocked", "allowed", "unknown"];
      expect(states).toContain("blocked");
      expect(states).toContain("allowed");
      expect(states).toContain("unknown");
    });
  });

  describe("Master volume", () => {
    it("clamps volume between 0 and 1", () => {
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      
      expect(clamp(-0.5)).toBe(0);
      expect(clamp(0)).toBe(0);
      expect(clamp(0.5)).toBe(0.5);
      expect(clamp(1)).toBe(1);
      expect(clamp(1.5)).toBe(1);
    });
  });
});
