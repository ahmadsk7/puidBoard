import { describe, it, expect, vi } from "vitest";

// Mock socket and server
function createMockSocket(id: string) {
  return {
    id,
    emit: vi.fn(),
    to: vi.fn().mockReturnThis(),
  };
}

function createMockServer() {
  return {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  };
}

describe("Queue Handlers", () => {
  describe("handleQueueAdd", () => {
    it("adds a track to the queue and broadcasts", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd } = await import("./queue.js");

      const socketId = `queue-add-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("QueueHost", socketId);

      const queueAddEvent = {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-123",
          title: "Test Track",
          durationSec: 180,
          url: "https://example.com/track-123.mp3",
        },
      };

      handleQueueAdd(mockServer as any, mockSocket as any, queueAddEvent);

      // Verify queue item was added
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue).toHaveLength(1);
      expect(updatedRoom?.queue[0]?.trackId).toBe("track-123");
      expect(updatedRoom?.queue[0]?.title).toBe("Test Track");
      expect(updatedRoom?.queue[0]?.durationSec).toBe(180);
      expect(updatedRoom?.queue[0]?.addedBy).toBe(clientId);
      expect(updatedRoom?.queue[0]?.status).toBe("queued");

      // Verify version incremented
      expect(updatedRoom?.version).toBe(1);

      // Verify ack was sent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 1,
          accepted: true,
        })
      );

      // Verify broadcast to room
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
      expect(mockServer.emit).toHaveBeenCalledWith(
        "QUEUE_ADD",
        expect.objectContaining({
          type: "QUEUE_ADD",
          roomId: room.roomId,
          clientId,
          payload: expect.objectContaining({
            trackId: "track-123",
          }),
        })
      );

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("adds item at specified position", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd } = await import("./queue.js");

      const socketId = `queue-insert-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("InsertHost", socketId);

      // Add first item
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-1",
          title: "Track 1",
          durationSec: 100,
          url: "https://example.com/track-1.mp3",
        },
      });

      // Add second item
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        payload: {
          trackId: "track-2",
          title: "Track 2",
          durationSec: 120,
          url: "https://example.com/track-2.mp3",
        },
      });

      // Add third item at position 0 (top of queue)
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 3,
        payload: {
          trackId: "track-3",
          title: "Track 3",
          durationSec: 90,
          url: "https://example.com/track-3.mp3",
          insertAt: 0,
        },
      });

      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue).toHaveLength(3);
      expect(updatedRoom?.queue[0]?.trackId).toBe("track-3");
      expect(updatedRoom?.queue[1]?.trackId).toBe("track-1");
      expect(updatedRoom?.queue[2]?.trackId).toBe("track-2");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("rejects unauthorized queue add", async () => {
      await import("../rooms/store.js");
      const { handleQueueAdd } = await import("./queue.js");

      const socketId = `queue-unauth-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      // Don't create a room, send event from untracked client
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: "fake-room",
        clientId: "fake-client",
        clientSeq: 1,
        payload: {
          trackId: "track-123",
          title: "Test Track",
          durationSec: 180,
          url: "https://example.com/track-123.mp3",
        },
      });

      // Should not broadcast
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  describe("handleQueueRemove", () => {
    it("removes a track from the queue", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd, handleQueueRemove } = await import("./queue.js");

      const socketId = `queue-remove-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("RemoveHost", socketId);

      // Add an item first
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-123",
          title: "Test Track",
          durationSec: 180,
          url: "https://example.com/track-123.mp3",
        },
      });

      const updatedRoom = roomStore.getRoom(room.roomId);
      const queueItemId = updatedRoom?.queue[0]?.id!;

      // Clear previous mock calls
      vi.clearAllMocks();

      // Remove the item
      handleQueueRemove(mockServer as any, mockSocket as any, {
        type: "QUEUE_REMOVE",
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        payload: {
          queueItemId,
        },
      });

      // Verify queue is empty
      const finalRoom = roomStore.getRoom(room.roomId);
      expect(finalRoom?.queue).toHaveLength(0);

      // Verify ack was sent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 2,
          accepted: true,
        })
      );

      // Verify broadcast
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
      expect(mockServer.emit).toHaveBeenCalledWith(
        "QUEUE_REMOVE",
        expect.objectContaining({
          type: "QUEUE_REMOVE",
          payload: { queueItemId },
        })
      );

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("rejects removal of non-existent queue item", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueRemove } = await import("./queue.js");

      const socketId = `queue-remove-missing-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom(
        "RemoveMissingHost",
        socketId
      );

      handleQueueRemove(mockServer as any, mockSocket as any, {
        type: "QUEUE_REMOVE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          queueItemId: "nonexistent-item",
        },
      });

      // Verify rejection ack
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 1,
          accepted: false,
          error: expect.stringContaining("not found"),
        })
      );

      // Should not broadcast
      expect(mockServer.to).not.toHaveBeenCalled();

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleQueueReorder", () => {
    it("reorders a queue item to new position", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd, handleQueueReorder } = await import("./queue.js");

      const socketId = `queue-reorder-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("ReorderHost", socketId);

      // Add three items
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-1",
          title: "Track 1",
          durationSec: 100,
          url: "https://example.com/track-1.mp3",
        },
      });

      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        payload: {
          trackId: "track-2",
          title: "Track 2",
          durationSec: 120,
          url: "https://example.com/track-2.mp3",
        },
      });

      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 3,
        payload: {
          trackId: "track-3",
          title: "Track 3",
          durationSec: 90,
          url: "https://example.com/track-3.mp3",
        },
      });

      let updatedRoom = roomStore.getRoom(room.roomId);
      const queueItemId = updatedRoom?.queue[0]?.id!; // First item

      // Clear previous mock calls
      vi.clearAllMocks();

      // Move first item to position 2 (end)
      handleQueueReorder(mockServer as any, mockSocket as any, {
        type: "QUEUE_REORDER",
        roomId: room.roomId,
        clientId,
        clientSeq: 4,
        payload: {
          queueItemId,
          newIndex: 2,
        },
      });

      // Verify new order
      updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue[0]?.trackId).toBe("track-2");
      expect(updatedRoom?.queue[1]?.trackId).toBe("track-3");
      expect(updatedRoom?.queue[2]?.trackId).toBe("track-1");

      // Verify ack was sent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 4,
          accepted: true,
        })
      );

      // Verify broadcast
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("rejects invalid reorder index", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd, handleQueueReorder } = await import("./queue.js");

      const socketId = `queue-reorder-invalid-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom(
        "ReorderInvalidHost",
        socketId
      );

      // Add one item
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-1",
          title: "Track 1",
          durationSec: 100,
          url: "https://example.com/track-1.mp3",
        },
      });

      const updatedRoom = roomStore.getRoom(room.roomId);
      const queueItemId = updatedRoom?.queue[0]?.id!;

      vi.clearAllMocks();

      // Try to reorder to invalid index
      handleQueueReorder(mockServer as any, mockSocket as any, {
        type: "QUEUE_REORDER",
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        payload: {
          queueItemId,
          newIndex: 99, // Out of bounds
        },
      });

      // Verify rejection ack
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 2,
          accepted: false,
          error: expect.stringContaining("Invalid reorder index"),
        })
      );

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleQueueEdit", () => {
    it("edits queue item title", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd, handleQueueEdit } = await import("./queue.js");

      const socketId = `queue-edit-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom("EditHost", socketId);

      // Add an item
      handleQueueAdd(mockServer as any, mockSocket as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          trackId: "track-123",
          title: "Original Title",
          durationSec: 180,
          url: "https://example.com/track-123.mp3",
        },
      });

      let updatedRoom = roomStore.getRoom(room.roomId);
      const queueItemId = updatedRoom?.queue[0]?.id!;

      vi.clearAllMocks();

      // Edit the title
      handleQueueEdit(mockServer as any, mockSocket as any, {
        type: "QUEUE_EDIT",
        roomId: room.roomId,
        clientId,
        clientSeq: 2,
        payload: {
          queueItemId,
          updates: {
            title: "New Title",
          },
        },
      });

      // Verify title was updated
      updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue[0]?.title).toBe("New Title");

      // Verify ack was sent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 2,
          accepted: true,
        })
      );

      // Verify broadcast
      expect(mockServer.to).toHaveBeenCalledWith(room.roomId);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("rejects edit of non-existent queue item", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueEdit } = await import("./queue.js");

      const socketId = `queue-edit-missing-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);
      const mockServer = createMockServer();

      const { room, clientId } = roomStore.createRoom(
        "EditMissingHost",
        socketId
      );

      handleQueueEdit(mockServer as any, mockSocket as any, {
        type: "QUEUE_EDIT",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          queueItemId: "nonexistent-item",
          updates: {
            title: "New Title",
          },
        },
      });

      // Verify rejection ack
      expect(mockSocket.emit).toHaveBeenCalledWith(
        "EVENT_ACK",
        expect.objectContaining({
          type: "EVENT_ACK",
          clientSeq: 1,
          accepted: false,
          error: expect.stringContaining("not found"),
        })
      );

      // Should not broadcast
      expect(mockServer.to).not.toHaveBeenCalled();

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("Multiple clients", () => {
    it("ensures queue ordering is consistent across clients", async () => {
      const { roomStore } = await import("../rooms/store.js");
      const { handleQueueAdd, handleQueueReorder } = await import("./queue.js");

      const socketId1 = `multi-client-1-${Date.now()}`;
      const socketId2 = `multi-client-2-${Date.now() + 1}`;

      const mockSocket1 = createMockSocket(socketId1);
      const mockSocket2 = createMockSocket(socketId2);
      const mockServer = createMockServer();

      // Client 1 creates room
      const { room, clientId: clientId1 } = roomStore.createRoom(
        "Client1",
        socketId1
      );

      // Client 2 joins room
      const result = roomStore.joinRoom(room.roomCode, "Client2", socketId2);
      const clientId2 = result!.clientId;

      // Client 1 adds track 1
      handleQueueAdd(mockServer as any, mockSocket1 as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId: clientId1,
        clientSeq: 1,
        payload: {
          trackId: "track-1",
          title: "Track 1",
          durationSec: 100,
          url: "https://example.com/track-1.mp3",
        },
      });

      // Client 2 adds track 2
      handleQueueAdd(mockServer as any, mockSocket2 as any, {
        type: "QUEUE_ADD",
        roomId: room.roomId,
        clientId: clientId2,
        clientSeq: 1,
        payload: {
          trackId: "track-2",
          title: "Track 2",
          durationSec: 120,
          url: "https://example.com/track-2.mp3",
        },
      });

      let updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue).toHaveLength(2);

      const item1Id = updatedRoom?.queue[0]?.id!;

      // Client 1 reorders track 1 to end
      handleQueueReorder(mockServer as any, mockSocket1 as any, {
        type: "QUEUE_REORDER",
        roomId: room.roomId,
        clientId: clientId1,
        clientSeq: 2,
        payload: {
          queueItemId: item1Id,
          newIndex: 1,
        },
      });

      // Verify final order
      updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.queue[0]?.trackId).toBe("track-2");
      expect(updatedRoom?.queue[1]?.trackId).toBe("track-1");

      // Cleanup
      roomStore.leaveRoom(socketId1);
      roomStore.leaveRoom(socketId2);
    });
  });
});
