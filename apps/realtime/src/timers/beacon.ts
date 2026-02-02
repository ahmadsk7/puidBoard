/**
 * BEACON_TICK timer for Virtual DJ Rooms.
 *
 * Broadcasts authoritative deck state to all room members every 250ms.
 * This is the foundation for synchronized playback with fast convergence.
 *
 * Replaces the old SYNC_TICK (2s interval) with a faster, epoch-based system.
 */

import type { Server } from "socket.io";
import { BeaconTickEvent, DeckBeaconPayload } from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/** Interval for BEACON_TICK broadcasts (milliseconds) */
const BEACON_INTERVAL_MS = 250; // 250ms for fast sync

/** Active beacon intervals by roomId */
const activeTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Start broadcasting BEACON_TICK for a room.
 */
export function startBeacon(io: Server, roomId: string): void {
  // Don't start if already running
  if (activeTimers.has(roomId)) {
    return;
  }

  const timer = setInterval(() => {
    broadcastBeacon(io, roomId);
  }, BEACON_INTERVAL_MS);

  activeTimers.set(roomId, timer);

  console.log(`[beacon] started for roomId=${roomId} (${BEACON_INTERVAL_MS}ms interval)`);
}

/**
 * Stop broadcasting BEACON_TICK for a room.
 */
export function stopBeacon(roomId: string): void {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(roomId);
    console.log(`[beacon] stopped for roomId=${roomId}`);
  }
}

/**
 * Broadcast a single BEACON_TICK to a room.
 */
function broadcastBeacon(io: Server, roomId: string): void {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    // Room no longer exists, stop the timer
    stopBeacon(roomId);
    return;
  }

  const serverTs = Date.now();

  // Increment epochSeq for playing decks
  if (room.deckA.playState === "playing") {
    room.deckA.epochSeq++;
  }
  if (room.deckB.playState === "playing") {
    room.deckB.epochSeq++;
  }

  // Calculate current playhead from epoch for each deck
  const calcPlayhead = (deck: typeof room.deckA): number => {
    if (deck.playState !== "playing") {
      return deck.playheadSec;
    }
    const elapsedMs = serverTs - deck.epochStartTimeMs;
    const elapsedSec = elapsedMs / 1000;
    const playhead = deck.epochStartPlayheadSec + (elapsedSec * deck.playbackRate);
    return Math.min(playhead, deck.durationSec ?? playhead);
  };

  // Build beacon payloads
  const deckA: DeckBeaconPayload = {
    deckId: room.deckA.deckId,
    epochId: room.deckA.epochId,
    epochSeq: room.deckA.epochSeq,
    serverTs,
    playheadSec: calcPlayhead(room.deckA),
    playbackRate: room.deckA.playbackRate,
    playState: room.deckA.playState,
    detectedBpm: room.deckA.detectedBpm,
  };

  const deckB: DeckBeaconPayload = {
    deckId: room.deckB.deckId,
    epochId: room.deckB.epochId,
    epochSeq: room.deckB.epochSeq,
    serverTs,
    playheadSec: calcPlayhead(room.deckB),
    playbackRate: room.deckB.playbackRate,
    playState: room.deckB.playState,
    detectedBpm: room.deckB.detectedBpm,
  };

  const beaconTick: BeaconTickEvent = {
    type: "BEACON_TICK",
    roomId,
    payload: {
      serverTs,
      version: room.version,
      deckA,
      deckB,
    },
  };

  // Broadcast to all clients in the room
  io.to(roomId).emit("BEACON_TICK", beaconTick);
}

/**
 * Get all active beacon room IDs (for testing/monitoring).
 */
export function getActiveBeaconRooms(): string[] {
  return Array.from(activeTimers.keys());
}

/**
 * Clean up all beacon timers (for graceful shutdown).
 */
export function cleanupAllBeacons(): void {
  for (const roomId of activeTimers.keys()) {
    stopBeacon(roomId);
  }
}
