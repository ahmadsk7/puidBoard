import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { THROTTLE } from "@puid-board/shared";

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

describe("Cursor Handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleCursorMove", () => {
    it("updates cursor and broadcasts to room", async () => {
      // Fresh imports for isolation
      const { roomStore } = await import("../rooms/store.js");
      const { handleCursorMove, clearCursorThrottle } = await import(
        "./cursor.js"
      );

      const socketId = `cursor-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      // Create a room and get client info
      const { room, clientId } = roomStore.createRoom("CursorHost", socketId);

      // Send cursor move event
      const cursorEvent = {
        type: "CURSOR_MOVE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          x: 100,
          y: 200,
        },
      };

      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent);

      // Verify cursor was updated in room state
      const updatedRoom = roomStore.getRoom(room.roomId);
      const member = updatedRoom?.members.find((m) => m.clientId === clientId);

      expect(member?.cursor).toBeDefined();
      expect(member?.cursor?.x).toBe(100);
      expect(member?.cursor?.y).toBe(200);

      // Verify broadcast was sent to room (excluding sender)
      expect(mockSocket.to).toHaveBeenCalledWith(room.roomId);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "CURSOR_UPDATE",
        expect.objectContaining({
          type: "CURSOR_UPDATE",
          roomId: room.roomId,
          clientId,
          cursor: expect.objectContaining({
            x: 100,
            y: 200,
          }),
        })
      );

      // Cleanup
      clearCursorThrottle(socketId);
      roomStore.leaveRoom(socketId);
    });

    it("throttles rapid cursor updates", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleCursorMove, clearCursorThrottle } = await import(
        "./cursor.js"
      );

      const socketId = `throttle-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("ThrottleHost", socketId);

      const cursorEvent = {
        type: "CURSOR_MOVE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: { x: 100, y: 100 },
      };

      // First update should go through
      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent);
      expect(mockSocket.to).toHaveBeenCalledTimes(1);

      // Immediate second update should be throttled
      const cursorEvent2 = {
        ...cursorEvent,
        clientSeq: 2,
        payload: { x: 150, y: 150 },
      };
      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent2);

      // Should still only have 1 call (second was throttled)
      expect(mockSocket.to).toHaveBeenCalledTimes(1);

      // Advance time past throttle window
      vi.advanceTimersByTime(THROTTLE.CURSOR_MS + 1);

      // Now update should go through
      const cursorEvent3 = {
        ...cursorEvent,
        clientSeq: 3,
        payload: { x: 200, y: 200 },
      };
      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent3);
      expect(mockSocket.to).toHaveBeenCalledTimes(2);

      // Cleanup
      clearCursorThrottle(socketId);
      roomStore.leaveRoom(socketId);
    });

    it("ignores events from clients not in the room", async () => {
      // Import to ensure module is loaded
      await import("../rooms/store.js");
      const { handleCursorMove } = await import("./cursor.js");

      const socketId = `untracked-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      // Don't create a room, just send a fake event
      const cursorEvent = {
        type: "CURSOR_MOVE",
        roomId: "fake-room-id",
        clientId: "fake-client-id",
        clientSeq: 1,
        payload: { x: 100, y: 200 },
      };

      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent);

      // Should not have broadcast anything
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it("ignores events with mismatched clientId", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleCursorMove, clearCursorThrottle } = await import(
        "./cursor.js"
      );

      const socketId = `mismatch-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room } = roomStore.createRoom("MismatchHost", socketId);

      // Send event with wrong clientId
      const cursorEvent = {
        type: "CURSOR_MOVE",
        roomId: room.roomId,
        clientId: "wrong-client-id",
        clientSeq: 1,
        payload: { x: 100, y: 200 },
      };

      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent);

      // Should not have broadcast anything
      expect(mockSocket.to).not.toHaveBeenCalled();

      // Cleanup
      clearCursorThrottle(socketId);
      roomStore.leaveRoom(socketId);
    });

    it("ignores invalid event payloads", async () => {
      // Import to ensure module is loaded
      await import("../rooms/store.js");
      const { handleCursorMove } = await import("./cursor.js");

      const socketId = `invalid-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      // Send invalid event
      handleCursorMove(mockServer as any, mockSocket as any, {
        type: "CURSOR_MOVE",
        // Missing required fields
      });

      // Should not have broadcast anything
      expect(mockSocket.to).not.toHaveBeenCalled();
    });
  });

  describe("clearCursorThrottle", () => {
    it("allows immediate update after clearing throttle", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleCursorMove, clearCursorThrottle } = await import(
        "./cursor.js"
      );

      const socketId = `clear-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("ClearHost", socketId);

      const cursorEvent = {
        type: "CURSOR_MOVE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: { x: 100, y: 100 },
      };

      // First update
      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent);
      expect(mockSocket.to).toHaveBeenCalledTimes(1);

      // Clear throttle
      clearCursorThrottle(socketId);

      // Next update should go through immediately
      const cursorEvent2 = {
        ...cursorEvent,
        clientSeq: 2,
        payload: { x: 200, y: 200 },
      };
      handleCursorMove(mockServer as any, mockSocket as any, cursorEvent2);
      expect(mockSocket.to).toHaveBeenCalledTimes(2);

      // Cleanup
      clearCursorThrottle(socketId);
      roomStore.leaveRoom(socketId);
    });
  });
});
