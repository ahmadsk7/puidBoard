/**
 * SYNC_TICK timer for Virtual DJ Rooms.
 *
 * Broadcasts authoritative deck state to all room members every ~2 seconds.
 * This is the foundation for synchronized playback across clients.
 *
 * @deprecated This system is being replaced by BEACON_TICK (250ms interval)
 * with epoch-based sync. SYNC_TICK is kept running temporarily for backwards
 * compatibility and as a fallback. Future versions will phase this out entirely.
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
  // Calculate current playhead for playing decks (accounting for playbackRate)
  const calcPlayhead = (deck: typeof room.deckA) => {
    if (deck.playState === "playing" && deck.serverStartTime !== null) {
      const elapsedMs = serverTs - deck.serverStartTime;
      const elapsedSec = elapsedMs / 1000;
      // Multiply elapsed time by playbackRate to get correct position
      const playhead = deck.playheadSec + (elapsedSec * deck.playbackRate);
      return Math.min(playhead, deck.durationSec ?? playhead);
    }
    return deck.playheadSec;
  };

  const deckA: SyncTickDeckState = {
    deckId: room.deckA.deckId,
    loadedTrackId: room.deckA.loadedTrackId,
    playState: room.deckA.playState,
    serverStartTime: room.deckA.serverStartTime,
    playheadSec: calcPlayhead(room.deckA),
    playbackRate: room.deckA.playbackRate,
  };

  const deckB: SyncTickDeckState = {
    deckId: room.deckB.deckId,
    loadedTrackId: room.deckB.loadedTrackId,
    playState: room.deckB.playState,
    serverStartTime: room.deckB.serverStartTime,
    playheadSec: calcPlayhead(room.deckB),
    playbackRate: room.deckB.playbackRate,
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
