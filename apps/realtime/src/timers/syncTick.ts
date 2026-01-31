/**
 * SYNC_TICK timer for Virtual DJ Rooms.
 *
 * Broadcasts authoritative deck state to all room members every ~2 seconds.
 * This is the foundation for synchronized playback across clients.
 */

import type { Server } from "socket.io";
import { SyncTickEvent, SyncTickDeckState } from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/** Interval for SYNC_TICK broadcasts (milliseconds) */
const SYNC_TICK_INTERVAL_MS = 2000; // 2 seconds

/** Active sync tick intervals by roomId */
const activeTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Start broadcasting SYNC_TICK for a room.
 */
export function startSyncTick(io: Server, roomId: string): void {
  // Don't start if already running
  if (activeTimers.has(roomId)) {
    return;
  }

  const timer = setInterval(() => {
    broadcastSyncTick(io, roomId);
  }, SYNC_TICK_INTERVAL_MS);

  activeTimers.set(roomId, timer);

  console.log(`[sync-tick] started for roomId=${roomId}`);
}

/**
 * Stop broadcasting SYNC_TICK for a room.
 */
export function stopSyncTick(roomId: string): void {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(roomId);
    console.log(`[sync-tick] stopped for roomId=${roomId}`);
  }
}

/**
 * Broadcast a single SYNC_TICK to a room.
 */
function broadcastSyncTick(io: Server, roomId: string): void {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    // Room no longer exists, stop the timer
    stopSyncTick(roomId);
    return;
  }

  const serverTs = Date.now();

  // Build deck state snapshots for the tick
  const deckA: SyncTickDeckState = {
    deckId: room.deckA.deckId,
    loadedTrackId: room.deckA.loadedTrackId,
    playState: room.deckA.playState,
    serverStartTime: room.deckA.serverStartTime,
    playheadSec: room.deckA.playheadSec,
  };

  const deckB: SyncTickDeckState = {
    deckId: room.deckB.deckId,
    loadedTrackId: room.deckB.loadedTrackId,
    playState: room.deckB.playState,
    serverStartTime: room.deckB.serverStartTime,
    playheadSec: room.deckB.playheadSec,
  };

  const syncTick: SyncTickEvent = {
    type: "SYNC_TICK",
    roomId,
    payload: {
      serverTs,
      version: room.version,
      deckA,
      deckB,
    },
  };

  // Broadcast to all clients in the room
  io.to(roomId).emit("SYNC_TICK", syncTick);
}

/**
 * Get all active sync tick room IDs (for testing/monitoring).
 */
export function getActiveSyncTickRooms(): string[] {
  return Array.from(activeTimers.keys());
}

/**
 * Clean up all sync tick timers (for graceful shutdown).
 */
export function cleanupAllSyncTicks(): void {
  for (const roomId of activeTimers.keys()) {
    stopSyncTick(roomId);
  }
}
