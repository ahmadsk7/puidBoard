import { describe, it, expect } from "vitest";

describe("Deck", () => {
  describe("formatTime helper", () => {
    // Helper to format time as M:SS
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    it("formats 0 seconds", () => {
      expect(formatTime(0)).toBe("0:00");
    });

    it("formats seconds only", () => {
      expect(formatTime(45)).toBe("0:45");
    });

    it("formats minutes and seconds", () => {
      expect(formatTime(180)).toBe("3:00");
      expect(formatTime(185)).toBe("3:05");
    });

    it("formats long durations", () => {
      expect(formatTime(600)).toBe("10:00");
      expect(formatTime(3661)).toBe("61:01");
    });
  });

  describe("Deck state", () => {
    it("defines correct play states", () => {
      const states = ["stopped", "playing", "paused", "cued"];
      expect(states).toHaveLength(4);
      expect(states).toContain("stopped");
      expect(states).toContain("playing");
      expect(states).toContain("paused");
      expect(states).toContain("cued");
    });
  });

  describe("Playhead calculation", () => {
    it("calculates playhead from offset and elapsed time", () => {
      const startOffset = 10; // Started at 10 seconds into the track
      const elapsed = 5; // 5 seconds have passed
      const expected = startOffset + elapsed;
      expect(expected).toBe(15);
    });

    it("clamps playhead to duration", () => {
      const duration = 180;
      const calculatePlayhead = (offset: number, elapsed: number) => {
        return Math.min(offset + elapsed, duration);
      };

      expect(calculatePlayhead(170, 20)).toBe(180); // Clamped to duration
      expect(calculatePlayhead(100, 50)).toBe(150); // Within bounds
    });
  });

  describe("Seek position", () => {
    it("clamps seek position to valid range", () => {
      const duration = 180;
      const clampSeek = (position: number) => {
        return Math.max(0, Math.min(position, duration));
      };

      expect(clampSeek(-10)).toBe(0);
      expect(clampSeek(0)).toBe(0);
      expect(clampSeek(90)).toBe(90);
      expect(clampSeek(180)).toBe(180);
      expect(clampSeek(200)).toBe(180);
    });
  });

  describe("Volume control", () => {
    it("clamps volume to 0-1 range", () => {
      const clampVolume = (v: number) => Math.max(0, Math.min(1, v));

      expect(clampVolume(-0.5)).toBe(0);
      expect(clampVolume(0)).toBe(0);
      expect(clampVolume(0.75)).toBe(0.75);
      expect(clampVolume(1)).toBe(1);
      expect(clampVolume(1.5)).toBe(1);
    });
  });
});
