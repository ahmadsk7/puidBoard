import { describe, it, expect } from "vitest";

describe("FX module", () => {
  describe("Echo FX", () => {
    const MIN_DELAY = 0.05;
    const MAX_DELAY = 0.5;

    const paramToDelayTime = (param: number): number => {
      return MIN_DELAY + param * (MAX_DELAY - MIN_DELAY);
    };

    it("maps param 0 to min delay (50ms)", () => {
      expect(paramToDelayTime(0)).toBeCloseTo(0.05);
    });

    it("maps param 1 to max delay (500ms)", () => {
      expect(paramToDelayTime(1)).toBeCloseTo(0.5);
    });

    it("maps param 0.5 to middle delay (275ms)", () => {
      expect(paramToDelayTime(0.5)).toBeCloseTo(0.275);
    });
  });

  describe("Filter FX", () => {
    const MIN_FREQ = 200;
    const MAX_FREQ = 15000;

    const paramToFrequency = (param: number): number => {
      const minLog = Math.log(MIN_FREQ);
      const maxLog = Math.log(MAX_FREQ);
      return Math.exp(minLog + param * (maxLog - minLog));
    };

    it("maps param 0 to min freq (200Hz)", () => {
      expect(paramToFrequency(0)).toBeCloseTo(200);
    });

    it("maps param 1 to max freq (15kHz)", () => {
      expect(paramToFrequency(1)).toBeCloseTo(15000);
    });

    it("maps param 0.5 to ~1.7kHz (exponential)", () => {
      // Exponential midpoint
      const expected = Math.sqrt(MIN_FREQ * MAX_FREQ);
      expect(paramToFrequency(0.5)).toBeCloseTo(expected, 0);
    });
  });

  describe("Reverb FX", () => {
    const BASE_FEEDBACK = 0.5;

    const paramToFeedback = (param: number): number => {
      return BASE_FEEDBACK + param * 0.35;
    };

    it("maps param 0 to base feedback (0.5)", () => {
      expect(paramToFeedback(0)).toBeCloseTo(0.5);
    });

    it("maps param 1 to max feedback (0.85)", () => {
      expect(paramToFeedback(1)).toBeCloseTo(0.85);
    });
  });

  describe("Wet/Dry mixing", () => {
    const calculateWetDry = (value: number): [number, number] => {
      const wet = Math.max(0, Math.min(1, value));
      const dry = 1 - wet;
      return [wet, dry];
    };

    it("value 0 = full dry", () => {
      const [wet, dry] = calculateWetDry(0);
      expect(wet).toBe(0);
      expect(dry).toBe(1);
    });

    it("value 1 = full wet", () => {
      const [wet, dry] = calculateWetDry(1);
      expect(wet).toBe(1);
      expect(dry).toBe(0);
    });

    it("value 0.5 = 50/50", () => {
      const [wet, dry] = calculateWetDry(0.5);
      expect(wet).toBe(0.5);
      expect(dry).toBe(0.5);
    });

    it("clamps values below 0", () => {
      const [wet, dry] = calculateWetDry(-0.5);
      expect(wet).toBe(0);
      expect(dry).toBe(1);
    });

    it("clamps values above 1", () => {
      const [wet, dry] = calculateWetDry(1.5);
      expect(wet).toBe(1);
      expect(dry).toBe(0);
    });
  });

  describe("FX types", () => {
    const FX_TYPES = ["none", "echo", "reverb", "filter"];

    it("has 4 FX types", () => {
      expect(FX_TYPES).toHaveLength(4);
    });

    it("includes none for bypass", () => {
      expect(FX_TYPES).toContain("none");
    });

    it("includes all effect types", () => {
      expect(FX_TYPES).toContain("echo");
      expect(FX_TYPES).toContain("reverb");
      expect(FX_TYPES).toContain("filter");
    });
  });
});
