/**
 * Tests for control ownership and mixer handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { THROTTLE, CONTROL_OWNERSHIP_TTL_MS } from "@puid-board/shared";

// Mock socket and server
function createMockSocket(id: string) {
  return {
    id,
    emit: vi.fn(),
    to: vi.fn().mockReturnThis(),
  };
}

function createMockServer() {
  return {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  };
}

describe("Control Handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleControlGrab", () => {
    it("should grant ownership on first grab", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab } = await import("./controls.js");

      const socketId = `control-grab-test-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };

      handleControlGrab(mockServer as any, mockSocket as any, event);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]).toBeDefined();
      expect(updatedRoom?.controlOwners["crossfader"]?.clientId).toBe(clientId);

      // Should broadcast to room
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
      expect(mockServer.emit).toHaveBeenCalledWith(
        "CONTROL_OWNERSHIP",
        expect.objectContaining({
          type: "CONTROL_OWNERSHIP",
          roomId: room.roomId,
          controlId: "crossfader",
          ownership: expect.objectContaining({
            clientId,
          }),
        })
      );

      roomStore.leaveRoom(socketId);
    });

    it("should update lastMovedAt if already owned by same client", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab } = await import("./controls.js");

      const socketId = `control-grab-same-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      // First grab
      const event1 = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket as any, event1);

      const firstRoom = roomStore.getRoom(room.roomId);
      const firstAcquiredAt = firstRoom?.controlOwners["crossfader"]?.acquiredAt;

      // Wait a bit and grab again
      vi.advanceTimersByTime(100);

      const event2 = {
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket as any, event2);

      const updatedRoom = roomStore.getRoom(room.roomId);
      const ownership = updatedRoom?.controlOwners["crossfader"];

      expect(ownership?.clientId).toBe(clientId);
      expect(ownership?.acquiredAt).toBe(firstAcquiredAt);
      expect(ownership?.lastMovedAt).toBeGreaterThan(ownership?.acquiredAt ?? 0);

      roomStore.leaveRoom(socketId);
    });

    it("should allow another client to steal ownership (soft lock)", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab } = await import("./controls.js");

      const socket1Id = `control-grab-client1-${Date.now()}`;
      const socket2Id = `control-grab-client2-${Date.now()}`;
      const mockSocket1 = createMockSocket(socket1Id);
      const mockSocket2 = createMockSocket(socket2Id);
      const mockServer = createMockServer();

      const { room, clientId: clientId1 } = roomStore.createRoom("Alice", socket1Id);
      const joinResult = roomStore.joinRoom(room.roomCode, "Bob", socket2Id);
      const clientId2 = joinResult?.clientId;

      // Client 1 grabs
      const event1 = {
        roomId: room.roomId,
        clientId: clientId1,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket1 as any, event1);

      // Client 2 grabs (override)
      const event2 = {
        roomId: room.roomId,
        clientId: clientId2,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket2 as any, event2);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]?.clientId).toBe(clientId2);

      roomStore.leaveRoom(socket1Id);
      roomStore.leaveRoom(socket2Id);
    });

    it("should reject invalid control IDs", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab } = await import("./controls.js");

      const socketId = `control-grab-invalid-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "invalid.control" },
      };

      handleControlGrab(mockServer as any, mockSocket as any, event);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["invalid.control"]).toBeUndefined();
      expect(mockServer.emit).not.toHaveBeenCalled();

      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleControlRelease", () => {
    it("should release ownership if client is owner", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, handleControlRelease } = await import("./controls.js");

      const socketId = `control-release-owner-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      // First grab
      const grabEvent = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket as any, grabEvent);

      vi.clearAllMocks();

      // Then release
      const releaseEvent = {
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        type: "CONTROL_RELEASE",
        payload: { controlId: "crossfader" },
      };
      handleControlRelease(mockServer as any, mockSocket as any, releaseEvent);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]).toBeUndefined();

      // Should broadcast null ownership
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
      expect(mockServer.emit).toHaveBeenCalledWith(
        "CONTROL_OWNERSHIP",
        expect.objectContaining({
          type: "CONTROL_OWNERSHIP",
          roomId: room.roomId,
          controlId: "crossfader",
          ownership: null,
        })
      );

      roomStore.leaveRoom(socketId);
    });

    it("should not release if client is not the owner", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, handleControlRelease } = await import("./controls.js");

      const socket1Id = `control-release-notowner1-${Date.now()}`;
      const socket2Id = `control-release-notowner2-${Date.now()}`;
      const mockSocket1 = createMockSocket(socket1Id);
      const mockSocket2 = createMockSocket(socket2Id);
      const mockServer = createMockServer();

      const { room, clientId: clientId1 } = roomStore.createRoom("Alice", socket1Id);
      const joinResult = roomStore.joinRoom(room.roomCode, "Bob", socket2Id);
      const clientId2 = joinResult?.clientId;

      // Client 1 grabs
      const grabEvent = {
        roomId: room.roomId,
        clientId: clientId1,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket1 as any, grabEvent);

      vi.clearAllMocks();

      // Client 2 tries to release (not the owner)
      const releaseEvent = {
        roomId: room.roomId,
        clientId: clientId2,
        clientSeq: 1,
        type: "CONTROL_RELEASE",
        payload: { controlId: "crossfader" },
      };
      handleControlRelease(mockServer as any, mockSocket2 as any, releaseEvent);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]?.clientId).toBe(clientId1);
      expect(mockServer.emit).not.toHaveBeenCalled();

      roomStore.leaveRoom(socket1Id);
      roomStore.leaveRoom(socket2Id);
    });
  });

  describe("handleMixerSet", () => {
    it("should update mixer value and acquire ownership", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleMixerSet } = await import("./controls.js");

      const socketId = `mixer-set-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.75 },
      };

      handleMixerSet(mockServer as any, mockSocket as any, event);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.mixer.crossfader).toBe(0.75);
      expect(updatedRoom?.controlOwners["crossfader"]?.clientId).toBe(clientId);

      // Should broadcast value change
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
      expect(mockServer.emit).toHaveBeenCalledWith(
        "MIXER_VALUE",
        expect.objectContaining({
          type: "MIXER_VALUE",
          roomId: room.roomId,
          controlId: "crossfader",
          value: 0.75,
          clientId,
        })
      );

      roomStore.leaveRoom(socketId);
    });

    it("should update nested mixer values", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleMixerSet } = await import("./controls.js");

      const socketId = `mixer-set-nested-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "channelA.eq.low", value: -0.5 },
      };

      handleMixerSet(mockServer as any, mockSocket as any, event);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.mixer.channelA.eq.low).toBe(-0.5);

      roomStore.leaveRoom(socketId);
    });

    it("should throttle rapid updates", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleMixerSet } = await import("./controls.js");

      const socketId = `mixer-set-throttle-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      // First update should go through
      const event1 = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.25 },
      };
      handleMixerSet(mockServer as any, mockSocket as any, event1);
      expect(mockServer.emit).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second update immediately (should be throttled)
      const event2 = {
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.5 },
      };
      handleMixerSet(mockServer as any, mockSocket as any, event2);
      expect(mockServer.emit).not.toHaveBeenCalled();

      // After throttle period, should go through
      vi.advanceTimersByTime(THROTTLE.CONTROL_MS + 1);
      const event3 = {
        roomId: room.roomId,
        clientId,
        clientSeq: 3,
        type: "MIXER_SET",
        payload: { controlId: "crossfader", value: 0.75 },
      };
      handleMixerSet(mockServer as any, mockSocket as any, event3);
      expect(mockServer.emit).toHaveBeenCalledTimes(1);

      roomStore.leaveRoom(socketId);
    });
  });

  describe("cleanupExpiredOwnerships", () => {
    it("should remove ownerships past TTL", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, cleanupExpiredOwnerships } = await import("./controls.js");

      const socketId = `cleanup-expired-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      // Grab a control
      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket as any, event);

      const roomBefore = roomStore.getRoom(room.roomId);
      expect(roomBefore?.controlOwners["crossfader"]).toBeDefined();

      // Advance time past TTL
      vi.advanceTimersByTime(CONTROL_OWNERSHIP_TTL_MS + 100);

      const expired = cleanupExpiredOwnerships(room.roomId);

      expect(expired).toHaveLength(1);
      expect(expired[0].controlId).toBe("crossfader");

      const roomAfter = roomStore.getRoom(room.roomId);
      expect(roomAfter?.controlOwners["crossfader"]).toBeUndefined();

      roomStore.leaveRoom(socketId);
    });

    it("should not remove fresh ownerships", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, cleanupExpiredOwnerships } = await import("./controls.js");

      const socketId = `cleanup-fresh-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      const event = {
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket as any, event);

      // Advance time but not past TTL
      vi.advanceTimersByTime(CONTROL_OWNERSHIP_TTL_MS - 100);

      const expired = cleanupExpiredOwnerships(room.roomId);

      expect(expired).toHaveLength(0);
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]).toBeDefined();

      roomStore.leaveRoom(socketId);
    });
  });

  describe("releaseAllClientControls", () => {
    it("should release all controls owned by a client", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, releaseAllClientControls } = await import("./controls.js");

      const socketId = `release-all-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("Alice", socketId);

      // Client grabs multiple controls
      const controls = ["crossfader", "channelA.fader", "channelB.eq.low"];
      for (const controlId of controls) {
        const event = {
          roomId: room.roomId,
          clientId,
          clientSeq: 1,
          type: "CONTROL_GRAB",
          payload: { controlId },
        };
        handleControlGrab(mockServer as any, mockSocket as any, event);
      }

      const roomBefore = roomStore.getRoom(room.roomId);
      expect(Object.keys(roomBefore?.controlOwners ?? {}).length).toBe(3);

      // Release all
      const released = releaseAllClientControls(room.roomId, clientId);

      expect(released).toHaveLength(3);
      expect(released).toEqual(expect.arrayContaining(controls));

      const roomAfter = roomStore.getRoom(room.roomId);
      expect(Object.keys(roomAfter?.controlOwners ?? {}).length).toBe(0);

      roomStore.leaveRoom(socketId);
    });

    it("should only release controls owned by the specified client", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleControlGrab, releaseAllClientControls } = await import("./controls.js");

      const socket1Id = `release-specific1-${Date.now()}`;
      const socket2Id = `release-specific2-${Date.now()}`;
      const mockSocket1 = createMockSocket(socket1Id);
      const mockSocket2 = createMockSocket(socket2Id);
      const mockServer = createMockServer();

      const { room, clientId: clientId1 } = roomStore.createRoom("Alice", socket1Id);
      const joinResult = roomStore.joinRoom(room.roomCode, "Bob", socket2Id);
      const clientId2 = joinResult?.clientId;

      // Client 1 grabs crossfader
      const event1 = {
        roomId: room.roomId,
        clientId: clientId1,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "crossfader" },
      };
      handleControlGrab(mockServer as any, mockSocket1 as any, event1);

      // Client 2 grabs channelA.fader
      const event2 = {
        roomId: room.roomId,
        clientId: clientId2,
        clientSeq: 1,
        type: "CONTROL_GRAB",
        payload: { controlId: "channelA.fader" },
      };
      handleControlGrab(mockServer as any, mockSocket2 as any, event2);

      // Release only client 1's controls
      const released = releaseAllClientControls(room.roomId, clientId1);

      expect(released).toEqual(["crossfader"]);

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.controlOwners["crossfader"]).toBeUndefined();
      expect(updatedRoom?.controlOwners["channelA.fader"]?.clientId).toBe(clientId2);

      roomStore.leaveRoom(socket1Id);
      roomStore.leaveRoom(socket2Id);
    });
  });
});
