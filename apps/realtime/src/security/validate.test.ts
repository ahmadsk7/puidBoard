/**
 * Tests for validation utilities.
 */

import { describe, it, expect } from "vitest";
import {
  validateControlValue,
  validateSeekPosition,
  validateCuePosition,
  validateQueueIndex,
  validateCursorPosition,
  isHost,
  validateHostPermission,
  isMemberOfRoom,
  HOST_ONLY_ACTIONS,
} from "./validate.js";
import type { RoomState, DeckState } from "@puid-board/shared";

// Mock deck for testing
function createMockDeck(overrides: Partial<DeckState> = {}): DeckState {
  return {
    deckId: "A",
    loadedTrackId: "track-1",
    loadedQueueItemId: "queue-1",
    playState: "stopped",
    serverStartTime: null,
    playheadSec: 0,
    cuePointSec: null,
    durationSec: 180, // 3 minutes
    playbackRate: 1.0,
    ...overrides,
  };
}

// Mock room for testing
function createMockRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: "room-1",
    roomCode: "ABC123",
    version: 1,
    createdAt: Date.now(),
    hostId: "host-client",
    members: [
      {
        clientId: "host-client",
        name: "Host",
        color: "#FF6B6B",
        joinedAt: Date.now(),
        isHost: true,
        cursor: null,
        latencyMs: 0,
      },
      {
        clientId: "member-client",
        name: "Member",
        color: "#4ECDC4",
        joinedAt: Date.now(),
        isHost: false,
        cursor: null,
        latencyMs: 0,
      },
    ],
    queue: [
      {
        id: "queue-1",
        trackId: "track-1",
        title: "Track 1",
        durationSec: 180,
        addedBy: "host-client",
        addedAt: Date.now(),
        status: "queued",
      },
      {
        id: "queue-2",
        trackId: "track-2",
        title: "Track 2",
        durationSec: 240,
        addedBy: "member-client",
        addedAt: Date.now(),
        status: "queued",
      },
    ],
    deckA: createMockDeck(),
    deckB: createMockDeck({ deckId: "B" }),
    mixer: {
      crossfader: 0.5,
      masterVolume: 0.8,
      channelA: { fader: 1, gain: 0, eq: { low: 0, mid: 0, high: 0 }, filter: 0.5 },
      channelB: { fader: 1, gain: 0, eq: { low: 0, mid: 0, high: 0 }, filter: 0.5 },
      fx: { type: "none", wetDry: 0, param: 0.5, enabled: false },
    },
    controlOwners: {},
    ...overrides,
  };
}

describe("validateControlValue", () => {
  it("should accept valid 0-1 control values", () => {
    expect(validateControlValue("crossfader", 0).valid).toBe(true);
    expect(validateControlValue("crossfader", 0.5).valid).toBe(true);
    expect(validateControlValue("crossfader", 1).valid).toBe(true);
    expect(validateControlValue("masterVolume", 0.8).valid).toBe(true);
  });

  it("should accept valid -1 to 1 control values", () => {
    expect(validateControlValue("channelA.gain", -1).valid).toBe(true);
    expect(validateControlValue("channelA.gain", 0).valid).toBe(true);
    expect(validateControlValue("channelA.gain", 1).valid).toBe(true);
    expect(validateControlValue("channelA.eq.low", -0.5).valid).toBe(true);
  });

  it("should reject out-of-bounds values", () => {
    const result = validateControlValue("crossfader", 1.5);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("VALUE_OUT_OF_BOUNDS");
    }
  });

  it("should reject invalid control IDs", () => {
    const result = validateControlValue("invalid.control", 0.5);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INVALID_CONTROL_ID");
    }
  });

  it("should reject non-finite values", () => {
    expect(validateControlValue("crossfader", NaN).valid).toBe(false);
    expect(validateControlValue("crossfader", Infinity).valid).toBe(false);
  });
});

describe("validateSeekPosition", () => {
  const deck = createMockDeck({ durationSec: 180 });

  it("should accept valid seek positions", () => {
    expect(validateSeekPosition(0, deck).valid).toBe(true);
    expect(validateSeekPosition(90, deck).valid).toBe(true);
    expect(validateSeekPosition(180, deck).valid).toBe(true);
  });

  it("should reject negative positions", () => {
    const result = validateSeekPosition(-1, deck);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INVALID_SEEK_POSITION");
    }
  });

  it("should reject positions beyond track duration", () => {
    const result = validateSeekPosition(200, deck);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INVALID_SEEK_POSITION");
      expect(result.error).toContain("exceeds track duration");
    }
  });

  it("should allow any position if duration is null", () => {
    const deckNoDuration = createMockDeck({ durationSec: null });
    expect(validateSeekPosition(1000, deckNoDuration).valid).toBe(true);
  });
});

describe("validateCuePosition", () => {
  const deck = createMockDeck({ durationSec: 180 });

  it("should accept valid cue positions", () => {
    expect(validateCuePosition(0, deck).valid).toBe(true);
    expect(validateCuePosition(30, deck).valid).toBe(true);
    expect(validateCuePosition(180, deck).valid).toBe(true);
  });

  it("should reject negative cue positions", () => {
    const result = validateCuePosition(-5, deck);
    expect(result.valid).toBe(false);
  });

  it("should reject cue positions beyond track duration", () => {
    const result = validateCuePosition(200, deck);
    expect(result.valid).toBe(false);
  });
});

describe("validateQueueIndex", () => {
  const room = createMockRoom();

  it("should accept valid indices", () => {
    expect(validateQueueIndex(0, room).valid).toBe(true);
    expect(validateQueueIndex(1, room).valid).toBe(true);
    // Can insert at end
    expect(validateQueueIndex(2, room, true).valid).toBe(true);
  });

  it("should reject negative indices", () => {
    const result = validateQueueIndex(-1, room);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INVALID_QUEUE_INDEX");
    }
  });

  it("should reject out-of-bounds indices", () => {
    const result = validateQueueIndex(10, room);
    expect(result.valid).toBe(false);
  });

  it("should reject end index when allowEnd is false", () => {
    const result = validateQueueIndex(2, room, false);
    expect(result.valid).toBe(false);
  });
});

describe("validateCursorPosition", () => {
  it("should accept valid cursor positions", () => {
    expect(validateCursorPosition(0, 0).valid).toBe(true);
    expect(validateCursorPosition(500, 300).valid).toBe(true);
    expect(validateCursorPosition(1920, 1080).valid).toBe(true);
  });

  it("should reject negative coordinates", () => {
    expect(validateCursorPosition(-1, 0).valid).toBe(false);
    expect(validateCursorPosition(0, -1).valid).toBe(false);
  });

  it("should reject coordinates beyond max", () => {
    expect(validateCursorPosition(20000, 0).valid).toBe(false);
    expect(validateCursorPosition(0, 20000).valid).toBe(false);
  });

  it("should reject non-finite values", () => {
    expect(validateCursorPosition(NaN, 0).valid).toBe(false);
    expect(validateCursorPosition(0, Infinity).valid).toBe(false);
  });
});

describe("isHost", () => {
  const room = createMockRoom();

  it("should return true for the host", () => {
    expect(isHost(room, "host-client")).toBe(true);
  });

  it("should return false for non-host members", () => {
    expect(isHost(room, "member-client")).toBe(false);
  });

  it("should return false for unknown clients", () => {
    expect(isHost(room, "unknown-client")).toBe(false);
  });
});

describe("validateHostPermission", () => {
  const room = createMockRoom();

  it("should allow host to perform host-only actions", () => {
    // QUEUE_CLEAR is a host-only action
    const result = validateHostPermission(room, "host-client", "QUEUE_CLEAR");
    expect(result.valid).toBe(true);
  });

  it("should deny non-host from host-only actions", () => {
    const result = validateHostPermission(room, "member-client", "QUEUE_CLEAR");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("NOT_HOST");
    }
  });

  it("should allow any member to perform non-host-only actions", () => {
    // QUEUE_ADD is not host-only
    const result = validateHostPermission(room, "member-client", "QUEUE_ADD");
    expect(result.valid).toBe(true);
  });
});

describe("isMemberOfRoom", () => {
  const room = createMockRoom();

  it("should return true for room members", () => {
    expect(isMemberOfRoom(room, "host-client")).toBe(true);
    expect(isMemberOfRoom(room, "member-client")).toBe(true);
  });

  it("should return false for non-members", () => {
    expect(isMemberOfRoom(room, "unknown-client")).toBe(false);
  });
});

describe("HOST_ONLY_ACTIONS", () => {
  it("should include QUEUE_CLEAR", () => {
    expect(HOST_ONLY_ACTIONS.has("QUEUE_CLEAR")).toBe(true);
  });

  it("should not include regular actions", () => {
    expect(HOST_ONLY_ACTIONS.has("QUEUE_ADD")).toBe(false);
    expect(HOST_ONLY_ACTIONS.has("DECK_PLAY")).toBe(false);
    expect(HOST_ONLY_ACTIONS.has("MIXER_SET")).toBe(false);
  });
});
