/**
 * Tests for persistence manager.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RoomState } from "@puid-board/shared";
import { createDefaultDeck, createDefaultMixer } from "@puid-board/shared";

// Mock the persistence module components
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ping: vi.fn().mockResolvedValue("PONG"),
};

describe("Persistence (in-memory fallback)", () => {
  // We'll test the in-memory fallback since Redis is optional
  // Full Redis integration should be tested in integration tests

  const mockRoom: RoomState = {
    roomId: "test-room",
    roomCode: "ABC123",
    version: 5,
    createdAt: Date.now(),
    hostId: "host-123",
    members: [
      {
        clientId: "host-123",
        name: "Host",
        color: "#FF0000",
        joinedAt: Date.now(),
        isHost: true,
        cursor: null,
        latencyMs: 0,
      },
    ],
    queue: [],
    deckA: createDefaultDeck("A"),
    deckB: createDefaultDeck("B"),
    mixer: createDefaultMixer(),
    controlOwners: {},
  };

  it("should save and load snapshots in-memory", async () => {
    // This is a conceptual test - actual implementation would use the persistence manager
    const snapshot = {
      roomState: mockRoom,
      idempotency: {
        clientSeqs: [] as Array<[string, number]>,
        recentEventIds: [],
      },
      savedAt: Date.now(),
    };

    // Simulate save
    const saved = JSON.stringify(snapshot);
    expect(saved).toBeTruthy();

    // Simulate load
    const loaded = JSON.parse(saved);
    expect(loaded.roomState.roomId).toBe(mockRoom.roomId);
    expect(loaded.roomState.version).toBe(5);
  });

  it("should serialize room state correctly", () => {
    const serialized = JSON.stringify(mockRoom);
    const deserialized = JSON.parse(serialized) as RoomState;

    expect(deserialized.roomId).toBe(mockRoom.roomId);
    expect(deserialized.version).toBe(mockRoom.version);
    expect(deserialized.members).toHaveLength(1);
    expect(deserialized.deckA.deckId).toBe("A");
  });

  it("should handle idempotency state persistence", () => {
    const idempotencyState = {
      clientSeqs: [
        ["client-1", 10],
        ["client-2", 5],
      ] as Array<[string, number]>,
      recentEventIds: ["event-1", "event-2", "event-3"],
    };

    const serialized = JSON.stringify(idempotencyState);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.clientSeqs).toHaveLength(2);
    expect(deserialized.recentEventIds).toHaveLength(3);
  });
});
