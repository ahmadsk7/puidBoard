import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startSyncTick,
  stopSyncTick,
  hasSyncTick,
  getActiveSyncTickCount,
  stopAllSyncTicks,
  SYNC_TICK_INTERVAL_MS,
} from "./syncTick.js";
import { roomStore } from "../rooms/store.js";

// Mock socket.io Server
function createMockIO() {
  const emittedEvents: Array<{ roomId: string; event: string; data: unknown }> = [];
  return {
    to: (roomId: string) => ({
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ roomId, event, data });
      },
    }),
    emittedEvents,
  };
}

describe("syncTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopAllSyncTicks(); // Clean up any previous timers
  });

  afterEach(() => {
    stopAllSyncTicks();
    vi.useRealTimers();
  });

  describe("startSyncTick", () => {
    it("should start a timer for a room", () => {
      const mockIO = createMockIO();
      const socketId = `test-socket-${Date.now()}`;

      // Create a room
      const { room } = roomStore.createRoom("TestHost", socketId);

      expect(hasSyncTick(room.roomId)).toBe(false);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);

      expect(hasSyncTick(room.roomId)).toBe(true);
      expect(getActiveSyncTickCount()).toBe(1);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should emit SYNC_TICK events at regular intervals", () => {
      const mockIO = createMockIO();
      const socketId = `test-socket-${Date.now()}`;

      // Create a room
      const { room } = roomStore.createRoom("TestHost", socketId);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);

      // No events initially
      expect(mockIO.emittedEvents.length).toBe(0);

      // Advance time by one interval
      vi.advanceTimersByTime(SYNC_TICK_INTERVAL_MS);

      // Should have emitted one SYNC_TICK
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]!.event).toBe("SYNC_TICK");
      expect(mockIO.emittedEvents[0]!.roomId).toBe(room.roomId);

      // Advance time by another interval
      vi.advanceTimersByTime(SYNC_TICK_INTERVAL_MS);

      // Should have emitted two SYNC_TICKs
      expect(mockIO.emittedEvents.length).toBe(2);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should include deck states in SYNC_TICK payload", () => {
      const mockIO = createMockIO();
      const socketId = `test-socket-${Date.now()}`;

      // Create a room
      const { room } = roomStore.createRoom("TestHost", socketId);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);

      // Advance time to trigger a tick
      vi.advanceTimersByTime(SYNC_TICK_INTERVAL_MS);

      const syncTick = mockIO.emittedEvents[0]!.data as {
        type: string;
        roomId: string;
        payload: {
          serverTs: number;
          version: number;
          deckA: { deckId: string };
          deckB: { deckId: string };
        };
      };

      expect(syncTick.type).toBe("SYNC_TICK");
      expect(syncTick.roomId).toBe(room.roomId);
      expect(syncTick.payload.deckA.deckId).toBe("A");
      expect(syncTick.payload.deckB.deckId).toBe("B");
      expect(typeof syncTick.payload.serverTs).toBe("number");
      expect(typeof syncTick.payload.version).toBe("number");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should not create duplicate timers for the same room", () => {
      const mockIO = createMockIO();
      const socketId = `test-socket-${Date.now()}`;

      // Create a room
      const { room } = roomStore.createRoom("TestHost", socketId);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);
      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);
      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);

      expect(getActiveSyncTickCount()).toBe(1);

      // Advance time
      vi.advanceTimersByTime(SYNC_TICK_INTERVAL_MS);

      // Should only have one event (not three)
      expect(mockIO.emittedEvents.length).toBe(1);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("stopSyncTick", () => {
    it("should stop the timer for a room", () => {
      const mockIO = createMockIO();
      const socketId = `test-socket-${Date.now()}`;

      // Create a room
      const { room } = roomStore.createRoom("TestHost", socketId);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room.roomId);
      expect(hasSyncTick(room.roomId)).toBe(true);

      stopSyncTick(room.roomId);
      expect(hasSyncTick(room.roomId)).toBe(false);
      expect(getActiveSyncTickCount()).toBe(0);

      // Advance time - should not emit any events
      vi.advanceTimersByTime(SYNC_TICK_INTERVAL_MS * 3);
      expect(mockIO.emittedEvents.length).toBe(0);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("stopAllSyncTicks", () => {
    it("should stop all active timers", () => {
      const mockIO = createMockIO();

      // Create multiple rooms
      const socketId1 = `test-socket-1-${Date.now()}`;
      const socketId2 = `test-socket-2-${Date.now()}`;

      const { room: room1 } = roomStore.createRoom("Host1", socketId1);
      const { room: room2 } = roomStore.createRoom("Host2", socketId2);

      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room1.roomId);
      startSyncTick(mockIO as unknown as Parameters<typeof startSyncTick>[0], room2.roomId);

      expect(getActiveSyncTickCount()).toBe(2);

      stopAllSyncTicks();

      expect(getActiveSyncTickCount()).toBe(0);
      expect(hasSyncTick(room1.roomId)).toBe(false);
      expect(hasSyncTick(room2.roomId)).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId1);
      roomStore.leaveRoom(socketId2);
    });
  });
});
