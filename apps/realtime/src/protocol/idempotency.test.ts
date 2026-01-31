/**
 * Tests for idempotency store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { idempotencyStore } from "./idempotency.js";

describe("IdempotencyStore", () => {
  const roomId = "test-room";
  const clientId = "test-client";

  beforeEach(() => {
    // Clean up between tests
    idempotencyStore.deleteRoom(roomId);
  });

  it("should not mark first event as duplicate", () => {
    const isDupe = idempotencyStore.isDuplicate(
      roomId,
      clientId,
      1
    );

    expect(isDupe).toBe(false);
  });

  it("should mark duplicate client_seq as duplicate", () => {
    // Record an event
    idempotencyStore.recordEvent(roomId, clientId, 1, "event-1", Date.now());

    // Try same seq again
    const isDupe = idempotencyStore.isDuplicate(roomId, clientId, 1);

    expect(isDupe).toBe(true);
  });

  it("should mark lower client_seq as duplicate", () => {
    // Record seq 5
    idempotencyStore.recordEvent(roomId, clientId, 5, "event-5", Date.now());

    // Try seq 3 (should be duplicate)
    const isDupe = idempotencyStore.isDuplicate(roomId, clientId, 3);

    expect(isDupe).toBe(true);
  });

  it("should allow higher client_seq", () => {
    // Record seq 5
    idempotencyStore.recordEvent(roomId, clientId, 5, "event-5", Date.now());

    // Try seq 6 (should be allowed)
    const isDupe = idempotencyStore.isDuplicate(roomId, clientId, 6);

    expect(isDupe).toBe(false);
  });

  it("should mark duplicate event_id as duplicate", () => {
    const eventId = "event-123";

    // Record an event
    idempotencyStore.recordEvent(roomId, clientId, 1, eventId, Date.now());

    // Try same event ID again (even with different seq)
    const isDupe = idempotencyStore.isDuplicate(
      roomId,
      clientId,
      2,
      eventId
    );

    expect(isDupe).toBe(true);
  });

  it("should track multiple clients separately", () => {
    const client1 = "client-1";
    const client2 = "client-2";

    // Record seq 1 for client 1
    idempotencyStore.recordEvent(roomId, client1, 1, "event-1", Date.now());

    // Seq 1 for client 2 should NOT be duplicate
    const isDupe = idempotencyStore.isDuplicate(roomId, client2, 1);

    expect(isDupe).toBe(false);
  });

  it("should provide room stats", () => {
    idempotencyStore.recordEvent(roomId, clientId, 1, "event-1", Date.now());
    idempotencyStore.recordEvent(roomId, clientId, 2, "event-2", Date.now());

    const stats = idempotencyStore.getRoomStats(roomId);

    expect(stats).toBeTruthy();
    expect(stats?.trackedClients).toBe(1);
    expect(stats?.processedEvents).toBe(2);
  });

  it("should clean up room on delete", () => {
    idempotencyStore.recordEvent(roomId, clientId, 1, "event-1", Date.now());

    idempotencyStore.deleteRoom(roomId);

    const stats = idempotencyStore.getRoomStats(roomId);
    expect(stats).toBeNull();
  });

  it("should support persistence state export/import", () => {
    // Record some events
    idempotencyStore.recordEvent(roomId, clientId, 1, "event-1", Date.now());
    idempotencyStore.recordEvent(roomId, clientId, 2, "event-2", Date.now());

    // Export state
    const state = idempotencyStore.getPersistedState(roomId);
    expect(state).toBeTruthy();
    expect(state?.clientSeqs).toHaveLength(1);
    expect(state?.recentEventIds).toHaveLength(2);

    // Clean up
    idempotencyStore.deleteRoom(roomId);

    // Restore state
    const newRoomId = "restored-room";
    idempotencyStore.restoreRoom(
      newRoomId,
      new Map(state!.clientSeqs),
      state!.recentEventIds
    );

    // Verify restoration
    const stats = idempotencyStore.getRoomStats(newRoomId);
    expect(stats?.trackedClients).toBe(1);
    expect(stats?.processedEvents).toBe(2);
  });
});
