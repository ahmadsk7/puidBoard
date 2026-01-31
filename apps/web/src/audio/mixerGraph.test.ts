import { describe, it, expect } from "vitest";
import { equalPowerCrossfade, bipolarToGain, clamp } from "./params";

describe("Mixer Graph logic", () => {
  describe("EQ gain mapping", () => {
    const EQ_MAX_DB = 12;

    const eqValueToDb = (value: number) => clamp(value, -1, 1) * EQ_MAX_DB;

    it("maps -1 to -12dB", () => {
      expect(eqValueToDb(-1)).toBe(-12);
    });

    it("maps 0 to 0dB", () => {
      expect(eqValueToDb(0)).toBe(0);
    });

    it("maps +1 to +12dB", () => {
      expect(eqValueToDb(1)).toBe(12);
    });

    it("clamps values beyond range", () => {
      expect(eqValueToDb(-2)).toBe(-12);
      expect(eqValueToDb(2)).toBe(12);
    });
  });

  describe("Crossfader routing", () => {
    it("full left (0) sends all signal to A", () => {
      const [a, b] = equalPowerCrossfade(0);
      expect(a).toBeCloseTo(1);
      expect(b).toBeCloseTo(0);
    });

    it("full right (1) sends all signal to B", () => {
      const [a, b] = equalPowerCrossfade(1);
      expect(a).toBeCloseTo(0);
      expect(b).toBeCloseTo(1);
    });

    it("center (0.5) splits signal equally", () => {
      const [a, b] = equalPowerCrossfade(0.5);
      // Equal power at center should be ~0.707
      expect(a).toBeCloseTo(b);
      expect(a).toBeCloseTo(0.707, 2);
    });
  });

  describe("Channel gain calculation", () => {
    it("converts bipolar gain to multiplier", () => {
      // -1 = -12dB (cut)
      expect(bipolarToGain(-1)).toBeCloseTo(0.251, 2);
      
      // 0 = 0dB (unity)
      expect(bipolarToGain(0)).toBeCloseTo(1);
      
      // +1 = +12dB (boost)
      expect(bipolarToGain(1)).toBeCloseTo(3.981, 2);
    });
  });

  describe("Control ID parsing", () => {
    const parseControlId = (controlId: string) => {
      const parts = controlId.split(".");
      return {
        channel: parts[0],
        param: parts[1],
        subParam: parts[2],
      };
    };

    it("parses channel gain", () => {
      const { channel, param, subParam } = parseControlId("channelA.gain");
      expect(channel).toBe("channelA");
      expect(param).toBe("gain");
      expect(subParam).toBeUndefined();
    });

    it("parses channel fader", () => {
      const { channel, param } = parseControlId("channelB.fader");
      expect(channel).toBe("channelB");
      expect(param).toBe("fader");
    });

    it("parses EQ band", () => {
      const { channel, param, subParam } = parseControlId("channelA.eq.low");
      expect(channel).toBe("channelA");
      expect(param).toBe("eq");
      expect(subParam).toBe("low");
    });
  });
});
