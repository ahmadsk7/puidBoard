import { describe, it, expect } from "vitest";
import {
  VERSION,
  THROTTLE,
  // State schemas
  RoomStateSchema,
  MemberSchema,
  DeckStateSchema,
  MixerStateSchema,
  QueueItemSchema,
  // Factory functions
  createDefaultDeck,
  createDefaultMixer,
  createDefaultEq,
  createDefaultChannel,
  createDefaultFx,
  // Event schemas
  CursorMoveEventSchema,
  MixerSetEventSchema,
  DeckPlayEventSchema,
  QueueAddEventSchema,
  ClientMutationEventSchema,
  // Validators
  validateClientMutationEvent,
  isValidControlId,
  getControlBounds,
  isValidControlValue,
  VALID_CONTROL_IDS,
  // Control IDs
  CROSSFADER,
  ALL_CONTROL_IDS,
  CONTROL_OWNERSHIP_TTL_MS,
} from "./index.js";

describe("@puid-board/shared", () => {
  describe("version and constants", () => {
    it("exports VERSION", () => {
      expect(VERSION).toBe("0.1.0");
    });

    it("exports THROTTLE constants", () => {
      expect(THROTTLE.CURSOR_MS).toBe(33);
      expect(THROTTLE.CONTROL_MS).toBe(16);
      expect(THROTTLE.SYNC_TICK_MS).toBe(2000);
    });

    it("exports CONTROL_OWNERSHIP_TTL_MS", () => {
      expect(CONTROL_OWNERSHIP_TTL_MS).toBe(2000);
    });
  });

  describe("state schemas", () => {
    it("validates a valid Member", () => {
      const member = {
        clientId: "client-123",
        name: "DJ Test",
        color: "#FF5500",
        joinedAt: Date.now(),
        isHost: true,
        cursor: { x: 100, y: 200, lastUpdated: Date.now() },
        latencyMs: 45,
      };
      expect(MemberSchema.safeParse(member).success).toBe(true);
    });

    it("rejects invalid Member (bad color format)", () => {
      const member = {
        clientId: "client-123",
        name: "DJ Test",
        color: "red", // Should be hex
        joinedAt: Date.now(),
        isHost: true,
        cursor: null,
        latencyMs: 45,
      };
      expect(MemberSchema.safeParse(member).success).toBe(false);
    });

    it("validates a valid QueueItem", () => {
      const item = {
        id: "queue-item-1",
        trackId: "track-abc",
        title: "Test Track",
        durationSec: 180,
        addedBy: "client-123",
        addedAt: Date.now(),
        status: "queued",
      };
      expect(QueueItemSchema.safeParse(item).success).toBe(true);
    });

    it("validates a valid DeckState", () => {
      const deck = createDefaultDeck("A");
      expect(DeckStateSchema.safeParse(deck).success).toBe(true);
    });

    it("validates a valid MixerState", () => {
      const mixer = createDefaultMixer();
      expect(MixerStateSchema.safeParse(mixer).success).toBe(true);
    });

    it("validates a complete RoomState", () => {
      const room = {
        roomId: "room-xyz",
        roomCode: "ABCD",
        version: 42,
        createdAt: Date.now(),
        hostId: "client-123",
        members: [
          {
            clientId: "client-123",
            name: "Host DJ",
            color: "#FF0000",
            joinedAt: Date.now(),
            isHost: true,
            cursor: null,
            latencyMs: 20,
          },
        ],
        queue: [],
        deckA: createDefaultDeck("A"),
        deckB: createDefaultDeck("B"),
        mixer: createDefaultMixer(),
        controlOwners: {},
      };
      expect(RoomStateSchema.safeParse(room).success).toBe(true);
    });
  });

  describe("factory functions", () => {
    it("createDefaultEq returns neutral EQ", () => {
      const eq = createDefaultEq();
      expect(eq).toEqual({ low: 0, mid: 0, high: 0 });
    });

    it("createDefaultChannel returns valid channel state", () => {
      const channel = createDefaultChannel();
      expect(channel.fader).toBe(1);
      expect(channel.gain).toBe(0);
      expect(channel.filter).toBe(0.5);
    });

    it("createDefaultFx returns disabled FX", () => {
      const fx = createDefaultFx();
      expect(fx.type).toBe("none");
      expect(fx.enabled).toBe(false);
    });

    it("createDefaultMixer returns valid mixer state", () => {
      const mixer = createDefaultMixer();
      expect(mixer.crossfader).toBe(0.5);
      expect(mixer.masterVolume).toBe(0.8);
    });

    it("createDefaultDeck returns stopped deck", () => {
      const deckA = createDefaultDeck("A");
      expect(deckA.deckId).toBe("A");
      expect(deckA.playState).toBe("stopped");
      expect(deckA.loadedTrackId).toBeNull();

      const deckB = createDefaultDeck("B");
      expect(deckB.deckId).toBe("B");
    });
  });

  describe("event schemas", () => {
    const baseMeta = {
      roomId: "room-123",
      clientId: "client-456",
      clientSeq: 1,
    };

    it("validates CURSOR_MOVE event", () => {
      const event = {
        ...baseMeta,
        type: "CURSOR_MOVE",
        payload: { x: 100, y: 200 },
      };
      expect(CursorMoveEventSchema.safeParse(event).success).toBe(true);
    });

    it("validates MIXER_SET event", () => {
      const event = {
        ...baseMeta,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.7 },
      };
      expect(MixerSetEventSchema.safeParse(event).success).toBe(true);
    });

    it("validates DECK_PLAY event", () => {
      const event = {
        ...baseMeta,
        type: "DECK_PLAY",
        payload: { deckId: "A" },
      };
      expect(DeckPlayEventSchema.safeParse(event).success).toBe(true);
    });

    it("validates QUEUE_ADD event", () => {
      const event = {
        ...baseMeta,
        type: "QUEUE_ADD",
        payload: {
          trackId: "track-123",
          title: "Test Track",
          durationSec: 180,
        },
      };
      expect(QueueAddEventSchema.safeParse(event).success).toBe(true);
    });

    it("validates discriminated union for mutation events", () => {
      const cursorEvent = {
        ...baseMeta,
        type: "CURSOR_MOVE",
        payload: { x: 50, y: 50 },
      };
      const mixerEvent = {
        ...baseMeta,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.5 },
      };

      expect(ClientMutationEventSchema.safeParse(cursorEvent).success).toBe(true);
      expect(ClientMutationEventSchema.safeParse(mixerEvent).success).toBe(true);
    });

    it("rejects invalid event type", () => {
      const event = {
        ...baseMeta,
        type: "INVALID_TYPE",
        payload: {},
      };
      expect(ClientMutationEventSchema.safeParse(event).success).toBe(false);
    });
  });

  describe("validators", () => {
    it("validates valid control IDs", () => {
      expect(isValidControlId("crossfader")).toBe(true);
      expect(isValidControlId("channelA.fader")).toBe(true);
      expect(isValidControlId("channelB.eq.low")).toBe(true);
      expect(isValidControlId("invalid")).toBe(false);
    });

    it("returns correct bounds for controls", () => {
      expect(getControlBounds("crossfader")).toEqual({ min: 0, max: 1 });
      expect(getControlBounds("channelA.gain")).toEqual({ min: -1, max: 1 });
      expect(getControlBounds("channelA.eq.mid")).toEqual({ min: -1, max: 1 });
    });

    it("validates control values within bounds", () => {
      expect(isValidControlValue("crossfader", 0.5)).toBe(true);
      expect(isValidControlValue("crossfader", -0.1)).toBe(false);
      expect(isValidControlValue("crossfader", 1.1)).toBe(false);
      expect(isValidControlValue("channelA.gain", -0.5)).toBe(true);
      expect(isValidControlValue("channelA.gain", -1.5)).toBe(false);
    });

    it("validateClientMutationEvent validates full event", () => {
      const validEvent = {
        roomId: "room-123",
        clientId: "client-456",
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.5 },
      };
      const result = validateClientMutationEvent(validEvent);
      expect(result.success).toBe(true);
    });

    it("validateClientMutationEvent rejects invalid control ID", () => {
      const invalidEvent = {
        roomId: "room-123",
        clientId: "client-456",
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "invalid_control", value: 0.5 },
      };
      const result = validateClientMutationEvent(invalidEvent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid control ID");
      }
    });

    it("validateClientMutationEvent rejects out-of-bounds value", () => {
      const invalidEvent = {
        roomId: "room-123",
        clientId: "client-456",
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 1.5 },
      };
      const result = validateClientMutationEvent(invalidEvent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("out of bounds");
      }
    });
  });

  describe("control IDs", () => {
    it("exports control ID constants", () => {
      expect(CROSSFADER).toBe("crossfader");
    });

    it("ALL_CONTROL_IDS matches VALID_CONTROL_IDS", () => {
      expect(ALL_CONTROL_IDS.length).toBe(VALID_CONTROL_IDS.length);
      ALL_CONTROL_IDS.forEach((id) => {
        expect(VALID_CONTROL_IDS).toContain(id);
      });
    });
  });
});
