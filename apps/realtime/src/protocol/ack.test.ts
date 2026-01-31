import { describe, it, expect, vi } from "vitest";
import {
  sendAck,
  sendAcceptedAck,
  sendRejectedAck,
  generateEventId,
} from "./ack.js";

// Mock socket
function createMockSocket() {
  return {
    emit: vi.fn(),
  };
}

describe("Ack Protocol", () => {
  describe("sendAck", () => {
    it("sends acknowledgment with all fields", () => {
      const mockSocket = createMockSocket();

      sendAck(mockSocket as any, 42, "evt-123", true, undefined);

      expect(mockSocket.emit).toHaveBeenCalledWith("EVENT_ACK", {
        type: "EVENT_ACK",
        clientSeq: 42,
        eventId: "evt-123",
        accepted: true,
        error: undefined,
      });
    });

    it("sends acknowledgment with error message", () => {
      const mockSocket = createMockSocket();

      sendAck(mockSocket as any, 7, "evt-456", false, "Invalid payload");

      expect(mockSocket.emit).toHaveBeenCalledWith("EVENT_ACK", {
        type: "EVENT_ACK",
        clientSeq: 7,
        eventId: "evt-456",
        accepted: false,
        error: "Invalid payload",
      });
    });
  });

  describe("sendAcceptedAck", () => {
    it("sends positive acknowledgment", () => {
      const mockSocket = createMockSocket();

      sendAcceptedAck(mockSocket as any, 100, "evt-success");

      expect(mockSocket.emit).toHaveBeenCalledWith("EVENT_ACK", {
        type: "EVENT_ACK",
        clientSeq: 100,
        eventId: "evt-success",
        accepted: true,
        error: undefined,
      });
    });
  });

  describe("sendRejectedAck", () => {
    it("sends negative acknowledgment with error", () => {
      const mockSocket = createMockSocket();

      sendRejectedAck(
        mockSocket as any,
        50,
        "evt-fail",
        "Validation failed"
      );

      expect(mockSocket.emit).toHaveBeenCalledWith("EVENT_ACK", {
        type: "EVENT_ACK",
        clientSeq: 50,
        eventId: "evt-fail",
        accepted: false,
        error: "Validation failed",
      });
    });
  });

  describe("generateEventId", () => {
    it("generates unique event IDs", () => {
      const id1 = generateEventId();
      const id2 = generateEventId();

      expect(id1).toMatch(/^evt-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^evt-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it("generates IDs with correct prefix", () => {
      const id = generateEventId();
      expect(id.startsWith("evt-")).toBe(true);
    });
  });
});
