/**
 * Idempotency handling for events.
 *
 * Uses event_id (server-assigned) and client_seq (client-assigned) to ensure
 * events are processed exactly once, even if network issues cause retries.
 */

import type { ClientId, EventId, RoomId } from "@puid-board/shared";

/** Track processed events for deduplication */
interface ProcessedEvent {
  eventId: EventId;
  clientId: ClientId;
  clientSeq: number;
  serverTs: number;
}

/** Per-room event tracking */
interface RoomEventLog {
  roomId: RoomId;
  /** Map of clientId -> highest processed client_seq */
  clientSeqs: Map<ClientId, number>;
  /** Set of processed event IDs (server-assigned) */
  processedEventIds: Set<EventId>;
  /** Rolling window of recent events (for debugging/auditing) */
  recentEvents: ProcessedEvent[];
  /** Max events to keep in memory per room */
  maxRecentEvents: number;
}

/** Global event log store */
class IdempotencyStore {
  /** Map of roomId -> event log */
  private rooms: Map<RoomId, RoomEventLog> = new Map();

  /** Default max recent events to track per room */
  private readonly DEFAULT_MAX_RECENT = 1000;

  /**
   * Check if an event has already been processed.
   * @returns true if event is duplicate, false if it's new
   */
  isDuplicate(
    roomId: RoomId,
    clientId: ClientId,
    clientSeq: number,
    eventId?: EventId
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      // Room not tracked yet, definitely not a duplicate
      return false;
    }

    // Check if we've already seen this client_seq from this client
    const lastSeq = room.clientSeqs.get(clientId);
    if (lastSeq !== undefined && clientSeq <= lastSeq) {
      console.log(
        `[idempotency] duplicate clientSeq roomId=${roomId} clientId=${clientId} seq=${clientSeq} (last=${lastSeq})`
      );
      return true;
    }

    // If event has server-assigned ID, check if we've processed it
    if (eventId && room.processedEventIds.has(eventId)) {
      console.log(
        `[idempotency] duplicate eventId roomId=${roomId} eventId=${eventId}`
      );
      return true;
    }

    return false;
  }

  /**
   * Record that an event has been processed.
   */
  recordEvent(
    roomId: RoomId,
    clientId: ClientId,
    clientSeq: number,
    eventId: EventId,
    serverTs: number
  ): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        clientSeqs: new Map(),
        processedEventIds: new Set(),
        recentEvents: [],
        maxRecentEvents: this.DEFAULT_MAX_RECENT,
      };
      this.rooms.set(roomId, room);
    }

    // Update client sequence tracking
    room.clientSeqs.set(clientId, clientSeq);

    // Record event ID
    room.processedEventIds.add(eventId);

    // Add to recent events (rolling window)
    room.recentEvents.push({ eventId, clientId, clientSeq, serverTs });
    if (room.recentEvents.length > room.maxRecentEvents) {
      // Remove oldest event
      const removed = room.recentEvents.shift();
      if (removed) {
        room.processedEventIds.delete(removed.eventId);
      }
    }
  }

  /**
   * Clean up tracking for a room (e.g., when room is deleted).
   */
  deleteRoom(roomId: RoomId): void {
    this.rooms.delete(roomId);
    console.log(`[idempotency] cleaned up roomId=${roomId}`);
  }

  /**
   * Get stats for a room (for monitoring).
   */
  getRoomStats(roomId: RoomId): {
    trackedClients: number;
    processedEvents: number;
    recentEvents: number;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      trackedClients: room.clientSeqs.size,
      processedEvents: room.processedEventIds.size,
      recentEvents: room.recentEvents.length,
    };
  }

  /**
   * Restore event tracking state from persistence.
   * Used when loading a room from Redis/DB on server restart.
   */
  restoreRoom(
    roomId: RoomId,
    clientSeqs: Map<ClientId, number>,
    recentEventIds: EventId[]
  ): void {
    const room: RoomEventLog = {
      roomId,
      clientSeqs: new Map(clientSeqs),
      processedEventIds: new Set(recentEventIds),
      recentEvents: recentEventIds.map((eventId, idx) => ({
        eventId,
        clientId: "", // Not critical for restore
        clientSeq: 0,
        serverTs: Date.now() - (recentEventIds.length - idx) * 1000,
      })),
      maxRecentEvents: this.DEFAULT_MAX_RECENT,
    };

    this.rooms.set(roomId, room);
    console.log(
      `[idempotency] restored roomId=${roomId} clients=${clientSeqs.size} events=${recentEventIds.length}`
    );
  }

  /**
   * Get serializable state for persistence.
   */
  getPersistedState(roomId: RoomId): {
    clientSeqs: Array<[ClientId, number]>;
    recentEventIds: EventId[];
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      clientSeqs: Array.from(room.clientSeqs.entries()),
      recentEventIds: Array.from(room.processedEventIds),
    };
  }
}

// Export singleton instance
export const idempotencyStore = new IdempotencyStore();
