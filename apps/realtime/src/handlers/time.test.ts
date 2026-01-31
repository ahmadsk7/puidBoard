import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleTimePing } from "./time.js";
import { roomStore } from "../rooms/store.js";

// Mock socket
function createMockSocket(socketId: string) {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];
  return {
    id: socketId,
    emit: (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
    },
    emittedEvents,
  };
}

describe("Time Handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe("handleTimePing", () => {
    it("should respond with TIME_PONG containing t0 and serverTs", () => {
      const socketId = `time-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      const t0 = Date.now();

      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], {
        type: "TIME_PING",
        t0,
      });

      expect(mockSocket.emittedEvents.length).toBe(1);
      expect(mockSocket.emittedEvents[0]!.event).toBe("TIME_PONG");

      const pong = mockSocket.emittedEvents[0]!.data as {
        type: string;
        t0: number;
        serverTs: number;
      };

      expect(pong.type).toBe("TIME_PONG");
      expect(pong.t0).toBe(t0);
      expect(typeof pong.serverTs).toBe("number");
    });

    it("should update latency for client in a room", () => {
      const socketId = `time-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create a room first
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);

      // Set time in the past to simulate network delay
      const t0 = Date.now() - 100; // 100ms ago

      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], {
        type: "TIME_PING",
        t0,
      });

      // Check that latency was updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      const member = updatedRoom?.members.find((m) => m.clientId === clientId);
      expect(member?.latencyMs).toBeGreaterThanOrEqual(0);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should silently ignore invalid TIME_PING payloads", () => {
      const socketId = `time-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Invalid payload (missing t0)
      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], {
        type: "TIME_PING",
      });

      // Should not emit anything
      expect(mockSocket.emittedEvents.length).toBe(0);
    });

    it("should silently ignore completely invalid data", () => {
      const socketId = `time-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Completely invalid
      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], null);
      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], undefined);
      handleTimePing(mockSocket as unknown as Parameters<typeof handleTimePing>[0], "not an object");

      // Should not emit anything
      expect(mockSocket.emittedEvents.length).toBe(0);
    });
  });
});
