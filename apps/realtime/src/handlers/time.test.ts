/**
 * Tests for time synchronization handler.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTimePing } from "./time.js";
import { roomStore } from "../rooms/store.js";

describe("Time Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleTimePing", () => {
    it("should respond with TIME_PONG containing server timestamp", () => {
      const mockSocket = {
        id: "socket-123",
        emit: vi.fn(),
      };

      const t0 = Date.now() - 50; // Simulate 50ms ago
      const event = {
        type: "TIME_PING",
        t0,
      };

      handleTimePing(mockSocket as any, event);

      expect(mockSocket.emit).toHaveBeenCalledWith("TIME_PONG", {
        type: "TIME_PONG",
        t0,
        serverTs: expect.any(Number),
      });

      const pongEvent = mockSocket.emit.mock.calls[0]?.[1];
      expect(pongEvent).toBeDefined();
      expect(pongEvent!.serverTs).toBeGreaterThan(t0);
    });

    it("should update client latency in room store", () => {
      const mockSocket = {
        id: "socket-456",
        emit: vi.fn(),
      };

      // Create a room and join with this socket
      const { room } = roomStore.createRoom("Test User", mockSocket.id);
      const initialLatency = room.members[0]?.latencyMs;

      const t0 = Date.now() - 100; // Simulate 100ms RTT
      const event = {
        type: "TIME_PING",
        t0,
      };

      handleTimePing(mockSocket as any, event);

      // Check that latency was updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      const updatedMember = updatedRoom?.members[0];

      expect(updatedMember).toBeDefined();
      expect(updatedMember?.latencyMs).toBeDefined();
      expect(updatedMember?.latencyMs).not.toBe(initialLatency);
      expect(updatedMember?.latencyMs).toBeGreaterThan(0);

      // Clean up
      roomStore.leaveRoom(mockSocket.id);
    });

    it("should silently ignore invalid TIME_PING payloads", () => {
      const mockSocket = {
        id: "socket-789",
        emit: vi.fn(),
      };

      const invalidEvent = {
        type: "TIME_PING",
        // Missing t0
      };

      handleTimePing(mockSocket as any, invalidEvent);

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it("should handle TIME_PING with string type field", () => {
      const mockSocket = {
        id: "socket-abc",
        emit: vi.fn(),
      };

      const event = {
        type: "TIME_PING" as const,
        t0: Date.now(),
      };

      handleTimePing(mockSocket as any, event);

      expect(mockSocket.emit).toHaveBeenCalledWith("TIME_PONG", {
        type: "TIME_PONG",
        t0: event.t0,
        serverTs: expect.any(Number),
      });
    });

    it("should calculate reasonable latency estimates", () => {
      const mockSocket = {
        id: "socket-latency",
        emit: vi.fn(),
      };

      roomStore.createRoom("Test User", mockSocket.id);

      // Simulate a ping from 60ms ago
      const t0 = Date.now() - 60;
      const event = {
        type: "TIME_PING",
        t0,
      };

      handleTimePing(mockSocket as any, event);

      const pongEvent = mockSocket.emit.mock.calls[0]?.[1];
      expect(pongEvent).toBeDefined();
      const estimatedRtt = pongEvent!.serverTs - t0;
      const estimatedOneWay = estimatedRtt / 2;

      // One-way latency should be approximately 30ms (half of 60ms RTT)
      expect(estimatedOneWay).toBeGreaterThanOrEqual(20);
      expect(estimatedOneWay).toBeLessThanOrEqual(40);

      // Clean up
      roomStore.leaveRoom(mockSocket.id);
    });
  });
});
