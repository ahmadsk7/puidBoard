import { describe, it, expect } from "vitest";
import { applyServerEvent } from "./applyEvent";
import type { RoomState, ServerMutationEvent } from "@puid-board/shared";
import { createDefaultDeck, createDefaultMixer } from "@puid-board/shared";

function createTestState(): RoomState {
  return {
    roomId: "test-room",
    roomCode: "TEST01",
    version: 0,
    createdAt: Date.now(),
    hostId: "client-1",
    members: [
      {
        clientId: "client-1",
        name: "User 1",
        color: "#FF6B6B",
        joinedAt: Date.now(),
        isHost: true,
        cursor: null,
        latencyMs: 0,
      },
      {
        clientId: "client-2",
        name: "User 2",
        color: "#4ECDC4",
        joinedAt: Date.now(),
        isHost: false,
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
}

describe("applyServerEvent", () => {
  it("applies CURSOR_MOVE and updates member cursor", () => {
    const state = createTestState();
    const event: ServerMutationEvent = {
      type: "CURSOR_MOVE",
      roomId: "test-room",
      clientId: "client-2",
      clientSeq: 1,
      eventId: "ev-1",
      serverTs: Date.now(),
      version: 1,
      payload: { x: 0.5, y: 0.25 },
    };

    const next = applyServerEvent(state, event);
    expect(next.version).toBe(1);
    const member = next.members.find((m) => m.clientId === "client-2");
    expect(member?.cursor).toEqual({
      x: 0.5,
      y: 0.25,
      lastUpdated: expect.any(Number),
    });
  });

  it("applies CONTROL_GRAB and sets ownership", () => {
    const state = createTestState();
    const event: ServerMutationEvent = {
      type: "CONTROL_GRAB",
      roomId: "test-room",
      clientId: "client-2",
      clientSeq: 1,
      eventId: "ev-1",
      serverTs: Date.now(),
      version: 1,
      payload: { controlId: "crossfader" },
    };

    const next = applyServerEvent(state, event);
    expect(next.controlOwners["crossfader"]).toBeDefined();
    expect(next.controlOwners["crossfader"]?.clientId).toBe("client-2");
  });

  it("applies CONTROL_RELEASE and removes ownership", () => {
    const state = createTestState();
    state.controlOwners["crossfader"] = {
      clientId: "client-2",
      acquiredAt: Date.now(),
      lastMovedAt: Date.now(),
    };

    const event: ServerMutationEvent = {
      type: "CONTROL_RELEASE",
      roomId: "test-room",
      clientId: "client-2",
      clientSeq: 2,
      eventId: "ev-2",
      serverTs: Date.now(),
      version: 1,
      payload: { controlId: "crossfader" },
    };

    const next = applyServerEvent(state, event);
    expect(next.controlOwners["crossfader"]).toBeUndefined();
  });

  it("applies MIXER_SET crossfader", () => {
    const state = createTestState();
    const event: ServerMutationEvent = {
      type: "MIXER_SET",
      roomId: "test-room",
      clientId: "client-1",
      clientSeq: 1,
      eventId: "ev-1",
      serverTs: Date.now(),
      version: 1,
      payload: { controlId: "crossfader", value: 0.75 },
    };

    const next = applyServerEvent(state, event);
    expect(next.mixer.crossfader).toBe(0.75);
  });
});
