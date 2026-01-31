/**
 * Tests for SYNC_TICK timer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startSyncTick,
  stopSyncTick,
  getActiveSyncTickRooms,
  cleanupAllSyncTicks,
} from "./syncTick.js";
import { roomStore } from "../rooms/store.js";

describe("SyncTick Timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cleanupAllSyncTicks(); // Clean slate
  });

  afterEach(() => {
    cleanupAllSyncTicks();
    vi.restoreAllMocks();
  });

  describe("startSyncTick", () => {
    it("should start broadcasting SYNC_TICK for a room", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-1");

      startSyncTick(mockIo as any, room.roomId);

      expect(getActiveSyncTickRooms()).toContain(room.roomId);

      // Clean up
      roomStore.leaveRoom("socket-1");
    });

    it("should not start duplicate timers for the same room", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-2");

      startSyncTick(mockIo as any, room.roomId);
      const timerCountBefore = getActiveSyncTickRooms().length;

      startSyncTick(mockIo as any, room.roomId);
      const timerCountAfter = getActiveSyncTickRooms().length;

      expect(timerCountBefore).toBe(timerCountAfter);

      // Clean up
      roomStore.leaveRoom("socket-2");
    });

    it("should broadcast SYNC_TICK every 2 seconds", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-3");

      startSyncTick(mockIo as any, room.roomId);

      // Initially, no broadcasts
      expect(mockIo.emit).not.toHaveBeenCalled();

      // Advance 2 seconds
      vi.advanceTimersByTime(2000);

      // Should have broadcast once
      expect(mockIo.to).toHaveBeenCalledWith(room.roomId);
      expect(mockIo.emit).toHaveBeenCalledWith("SYNC_TICK", {
        type: "SYNC_TICK",
        roomId: room.roomId,
        payload: {
          serverTs: expect.any(Number),
          version: room.version,
          deckA: {
            deckId: "A",
            loadedTrackId: null,
            playState: "stopped",
            serverStartTime: null,
            playheadSec: 0,
          },
          deckB: {
            deckId: "B",
            loadedTrackId: null,
            playState: "stopped",
            serverStartTime: null,
            playheadSec: 0,
          },
        },
      });

      // Advance another 2 seconds
      vi.advanceTimersByTime(2000);

      // Should have broadcast twice total
      expect(mockIo.emit).toHaveBeenCalledTimes(2);

      // Clean up
      roomStore.leaveRoom("socket-3");
    });
  });

  describe("stopSyncTick", () => {
    it("should stop broadcasting SYNC_TICK for a room", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-4");

      startSyncTick(mockIo as any, room.roomId);
      expect(getActiveSyncTickRooms()).toContain(room.roomId);

      stopSyncTick(room.roomId);
      expect(getActiveSyncTickRooms()).not.toContain(room.roomId);

      // Advance time - should not broadcast anymore
      vi.advanceTimersByTime(2000);
      expect(mockIo.emit).not.toHaveBeenCalled();

      // Clean up
      roomStore.leaveRoom("socket-4");
    });

    it("should handle stopping a non-existent timer gracefully", () => {
      expect(() => {
        stopSyncTick("non-existent-room");
      }).not.toThrow();
    });
  });

  describe("SYNC_TICK payload", () => {
    it("should include current deck states in payload", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-5");

      // Modify deck state
      room.deckA.loadedTrackId = "track-123";
      room.deckA.playState = "playing";
      room.deckA.serverStartTime = Date.now();
      room.deckA.playheadSec = 30.5;

      startSyncTick(mockIo as any, room.roomId);

      vi.advanceTimersByTime(2000);

      expect(mockIo.emit).toHaveBeenCalledWith("SYNC_TICK", {
        type: "SYNC_TICK",
        roomId: room.roomId,
        payload: {
          serverTs: expect.any(Number),
          version: room.version,
          deckA: {
            deckId: "A",
            loadedTrackId: "track-123",
            playState: "playing",
            serverStartTime: expect.any(Number),
            playheadSec: 30.5,
          },
          deckB: {
            deckId: "B",
            loadedTrackId: null,
            playState: "stopped",
            serverStartTime: null,
            playheadSec: 0,
          },
        },
      });

      // Clean up
      roomStore.leaveRoom("socket-5");
    });

    it("should include current room version in payload", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-6");

      // Increment version
      room.version = 42;

      startSyncTick(mockIo as any, room.roomId);

      vi.advanceTimersByTime(2000);

      const syncTickEvent = mockIo.emit.mock.calls[0]?.[1];
      expect(syncTickEvent).toBeDefined();
      expect(syncTickEvent!.payload.version).toBe(42);

      // Clean up
      roomStore.leaveRoom("socket-6");
    });
  });

  describe("cleanupAllSyncTicks", () => {
    it("should stop all active sync tick timers", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room: room1 } = roomStore.createRoom("Host1", "socket-7");
      const { room: room2 } = roomStore.createRoom("Host2", "socket-8");

      startSyncTick(mockIo as any, room1.roomId);
      startSyncTick(mockIo as any, room2.roomId);

      expect(getActiveSyncTickRooms()).toHaveLength(2);

      cleanupAllSyncTicks();

      expect(getActiveSyncTickRooms()).toHaveLength(0);

      // Advance time - should not broadcast
      vi.advanceTimersByTime(2000);
      expect(mockIo.emit).not.toHaveBeenCalled();

      // Clean up
      roomStore.leaveRoom("socket-7");
      roomStore.leaveRoom("socket-8");
    });
  });

  describe("auto-cleanup on room deletion", () => {
    it("should stop SYNC_TICK when room no longer exists", () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      const { room } = roomStore.createRoom("Host", "socket-9");

      startSyncTick(mockIo as any, room.roomId);

      // Broadcast once
      vi.advanceTimersByTime(2000);
      expect(mockIo.emit).toHaveBeenCalledTimes(1);

      // Delete the room
      roomStore.leaveRoom("socket-9");

      // Advance time - should attempt broadcast, detect room is gone, and stop
      mockIo.emit.mockClear();
      vi.advanceTimersByTime(2000);

      // Should not have broadcast (room is gone)
      expect(mockIo.emit).not.toHaveBeenCalled();

      // Timer should be stopped
      expect(getActiveSyncTickRooms()).not.toContain(room.roomId);
    });
  });
});
