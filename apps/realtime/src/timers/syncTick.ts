/**
 * SYNC_TICK timer - broadcasts deck state to all room members at regular intervals.
 * This allows clients to compute server-time basis and correct drift.
 */

import { Server } from "socket.io";
import type { SyncTickEvent, SyncTickDeckState } from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/** Sync tick interval in milliseconds (~2 seconds) */
export const SYNC_TICK_INTERVAL_MS = 2000;

/** Map of roomId -> interval timer */
const roomTimers = new Map<string, NodeJS.Timeout>();

/**
 * Create a SyncTickDeckState from the current deck state.
 */
function createDeckState(
  deck: { deckId: "A" | "B"; loadedTrackId: string | null; playState: string; serverStartTime: number | null; playheadSec: number }
): SyncTickDeckState {
  return {
    deckId: deck.deckId,
    loadedTrackId: deck.loadedTrackId,
    playState: deck.playState as "stopped" | "playing" | "paused" | "cued",
    serverStartTime: deck.serverStartTime,
    playheadSec: deck.playheadSec,
  };
}

/**
 * Start the sync tick timer for a room.
 * Called when a room is created or when the first client joins.
 */
export function startSyncTick(io: Server, roomId: string): void {
  // Don't start if already running
  if (roomTimers.has(roomId)) {
    return;
  }

  const timer = setInterval(() => {
    const room = roomStore.getRoom(roomId);
    if (!room) {
      // Room was deleted, stop the timer
      stopSyncTick(roomId);
      return;
    }

    // Build sync tick event
    const syncTick: SyncTickEvent = {
      type: "SYNC_TICK",
      roomId,
      payload: {
        serverTs: Date.now(),
        version: room.version,
        deckA: createDeckState(room.deckA),
        deckB: createDeckState(room.deckB),
      },
    };

    // Broadcast to all room members
    io.to(roomId).emit("SYNC_TICK", syncTick);
  }, SYNC_TICK_INTERVAL_MS);

  roomTimers.set(roomId, timer);
  console.log(`[sync-tick] started for roomId=${roomId}`);
}

/**
 * Stop the sync tick timer for a room.
 * Called when a room is deleted or when the last client leaves.
 */
export function stopSyncTick(roomId: string): void {
  const timer = roomTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    roomTimers.delete(roomId);
    console.log(`[sync-tick] stopped for roomId=${roomId}`);
  }
}

/**
 * Check if a room has an active sync tick timer.
 */
export function hasSyncTick(roomId: string): boolean {
  return roomTimers.has(roomId);
}

/**
 * Get the number of active sync tick timers (for monitoring).
 */
export function getActiveSyncTickCount(): number {
  return roomTimers.size;
}

/**
 * Stop all sync tick timers (for graceful shutdown).
 */
export function stopAllSyncTicks(): void {
  for (const [roomId, timer] of roomTimers) {
    clearInterval(timer);
    console.log(`[sync-tick] stopped for roomId=${roomId} (shutdown)`);
  }
  roomTimers.clear();
}
