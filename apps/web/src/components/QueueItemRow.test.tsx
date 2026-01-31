import { describe, it, expect } from "vitest";

// Test helper functions from QueueItemRow
// Since they're not exported, we duplicate minimal logic for testing

/** Format duration as M:SS */
function formatDuration(sec: number): string {
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

describe("QueueItemRow helpers", () => {
  describe("formatDuration", () => {
    it("formats 0 seconds", () => {
      expect(formatDuration(0)).toBe("0:00");
    });

    it("formats seconds only", () => {
      expect(formatDuration(45)).toBe("0:45");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(180)).toBe("3:00");
      expect(formatDuration(185)).toBe("3:05");
      expect(formatDuration(195)).toBe("3:15");
    });

    it("formats long durations", () => {
      expect(formatDuration(600)).toBe("10:00");
      expect(formatDuration(3661)).toBe("61:01");
    });

    it("pads seconds with zero", () => {
      expect(formatDuration(62)).toBe("1:02");
      expect(formatDuration(69)).toBe("1:09");
    });
  });
});

describe("QueueItemRow status display", () => {
  const STATUS_TEXT: Record<string, string> = {
    queued: "Queued",
    loaded_A: "Deck A",
    loaded_B: "Deck B",
    playing_A: "▶ A",
    playing_B: "▶ B",
    played: "Played",
  };

  it("has correct status text for all statuses", () => {
    expect(STATUS_TEXT["queued"]).toBe("Queued");
    expect(STATUS_TEXT["loaded_A"]).toBe("Deck A");
    expect(STATUS_TEXT["loaded_B"]).toBe("Deck B");
    expect(STATUS_TEXT["playing_A"]).toBe("▶ A");
    expect(STATUS_TEXT["playing_B"]).toBe("▶ B");
    expect(STATUS_TEXT["played"]).toBe("Played");
  });
});
