import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleDeckLoad,
  handleDeckPlay,
  handleDeckPause,
  handleDeckCue,
  handleDeckSeek,
} from "./deck.js";
import { roomStore } from "../rooms/store.js";
import type { QueueItem } from "@puid-board/shared";

// Mock socket.io
function createMockIO() {
  const emittedEvents: Array<{ roomId: string; event: string; data: unknown }> = [];
  return {
    to: (roomId: string) => ({
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ roomId, event, data });
      },
    }),
    emittedEvents,
  };
}

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

// Helper to add a test queue item to a room
function addTestQueueItem(roomId: string, clientId: string): QueueItem {
  const room = roomStore.getRoom(roomId);
  if (!room) throw new Error("Room not found");

  const queueItem: QueueItem = {
    id: `q-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    trackId: `track-${Date.now()}`,
    title: "Test Track",
    durationSec: 180,
    url: "https://example.com/test-track.mp3",
    addedBy: clientId,
    addedAt: Date.now(),
    status: "queued",
  };

  room.queue.push(queueItem);
  return queueItem;
}

describe("Deck Handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe("handleDeckLoad", () => {
    it("should load a track from queue into deck", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and add a track to queue
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);

      const event = {
        type: "DECK_LOAD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          trackId: queueItem.trackId,
          queueItemId: queueItem.id,
        },
      };

      handleDeckLoad(
        mockIO as unknown as Parameters<typeof handleDeckLoad>[0],
        mockSocket as unknown as Parameters<typeof handleDeckLoad>[1],
        event
      );

      // Check deck was updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.loadedTrackId).toBe(queueItem.trackId);
      expect(updatedRoom?.deckA.loadedQueueItemId).toBe(queueItem.id);
      expect(updatedRoom?.deckA.playState).toBe("stopped");
      expect(updatedRoom?.deckA.playheadSec).toBe(0);

      // Check queue item status updated
      expect(updatedRoom?.queue[0]?.status).toBe("loaded_A");

      // Check broadcast
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]?.event).toBe("DECK_LOAD");

      // Check ack
      expect(mockSocket.emittedEvents.length).toBe(1);
      expect(mockSocket.emittedEvents[0]?.event).toBe("EVENT_ACK");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if queue item not found", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      const { room, clientId } = roomStore.createRoom("TestHost", socketId);

      const event = {
        type: "DECK_LOAD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          trackId: "track-123",
          queueItemId: "nonexistent-queue-item",
        },
      };

      handleDeckLoad(
        mockIO as unknown as Parameters<typeof handleDeckLoad>[0],
        mockSocket as unknown as Parameters<typeof handleDeckLoad>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      expect(mockSocket.emittedEvents.length).toBeGreaterThanOrEqual(1);
      const ackEvent = mockSocket.emittedEvents.find((e) => e.event === "EVENT_ACK");
      expect(ackEvent).toBeDefined();
      const ack = ackEvent?.data as { accepted: boolean };
      expect(ack?.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if track ID mismatch", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);

      const event = {
        type: "DECK_LOAD",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          trackId: "wrong-track-id",
          queueItemId: queueItem.id,
        },
      };

      handleDeckLoad(
        mockIO as unknown as Parameters<typeof handleDeckLoad>[0],
        mockSocket as unknown as Parameters<typeof handleDeckLoad>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      const ack = mockSocket.emittedEvents[0]?.data as { accepted: boolean };
      expect(ack.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleDeckPlay", () => {
    it("should start playback and assign server_start_time", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and load a track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.playState = "stopped";

      const event = {
        type: "DECK_PLAY",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
        },
      };

      const beforeTs = Date.now();
      handleDeckPlay(
        mockIO as unknown as Parameters<typeof handleDeckPlay>[0],
        mockSocket as unknown as Parameters<typeof handleDeckPlay>[1],
        event
      );
      const afterTs = Date.now();

      // Check deck state updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.playState).toBe("playing");
      expect(updatedRoom?.deckA.serverStartTime).toBeGreaterThanOrEqual(beforeTs);
      expect(updatedRoom?.deckA.serverStartTime).toBeLessThanOrEqual(afterTs);

      // Check queue item status updated
      expect(updatedRoom?.queue[0]?.status).toBe("playing_A");

      // Check broadcast
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]?.event).toBe("DECK_PLAY");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if no track loaded", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      // Don't load a track

      const event = {
        type: "DECK_PLAY",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
        },
      };

      handleDeckPlay(
        mockIO as unknown as Parameters<typeof handleDeckPlay>[0],
        mockSocket as unknown as Parameters<typeof handleDeckPlay>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      const ack = mockSocket.emittedEvents[0]?.data as { accepted: boolean };
      expect(ack.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleDeckPause", () => {
    it("should pause playback and calculate current playhead", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and set up playing deck
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.playState = "playing";
      room.deckA.serverStartTime = Date.now();
      room.deckA.playheadSec = 10;
      room.deckA.durationSec = 180;

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      const event = {
        type: "DECK_PAUSE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
        },
      };

      handleDeckPause(
        mockIO as unknown as Parameters<typeof handleDeckPause>[0],
        mockSocket as unknown as Parameters<typeof handleDeckPause>[1],
        event
      );

      // Check deck state updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.playState).toBe("paused");
      expect(updatedRoom?.deckA.serverStartTime).toBe(null);

      // Playhead should be approximately 10 + 5 = 15 seconds
      expect(updatedRoom?.deckA.playheadSec).toBeGreaterThanOrEqual(14.9);
      expect(updatedRoom?.deckA.playheadSec).toBeLessThanOrEqual(15.1);

      // Check queue item status updated
      expect(updatedRoom?.queue[0]?.status).toBe("loaded_A");

      // Check broadcast
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]?.event).toBe("DECK_PAUSE");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should clamp playhead to track duration", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and set up playing deck near end of track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.playState = "playing";
      room.deckA.serverStartTime = Date.now();
      room.deckA.playheadSec = 175;
      room.deckA.durationSec = 180; // 3 minutes

      // Advance time by 10 seconds (would go beyond duration)
      vi.advanceTimersByTime(10000);

      const event = {
        type: "DECK_PAUSE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
        },
      };

      handleDeckPause(
        mockIO as unknown as Parameters<typeof handleDeckPause>[0],
        mockSocket as unknown as Parameters<typeof handleDeckPause>[1],
        event
      );

      // Playhead should be clamped to duration
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.playheadSec).toBe(180);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleDeckCue", () => {
    it("should set cue point and jump to it", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and load a track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.durationSec = 180;

      const event = {
        type: "DECK_CUE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          cuePointSec: 30,
        },
      };

      handleDeckCue(
        mockIO as unknown as Parameters<typeof handleDeckCue>[0],
        mockSocket as unknown as Parameters<typeof handleDeckCue>[1],
        event
      );

      // Check deck state updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.cuePointSec).toBe(30);
      expect(updatedRoom?.deckA.playheadSec).toBe(30);
      expect(updatedRoom?.deckA.playState).toBe("cued");
      expect(updatedRoom?.deckA.serverStartTime).toBe(null);

      // Check broadcast
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]?.event).toBe("DECK_CUE");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if cue point beyond duration", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and load a track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.durationSec = 180;

      const event = {
        type: "DECK_CUE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          cuePointSec: 200, // Beyond duration
        },
      };

      handleDeckCue(
        mockIO as unknown as Parameters<typeof handleDeckCue>[0],
        mockSocket as unknown as Parameters<typeof handleDeckCue>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      const ack = mockSocket.emittedEvents[0]?.data as { accepted: boolean };
      expect(ack.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should jump to existing cue point if cuePointSec not provided", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and set up deck with existing cue point
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.cuePointSec = 45;
      room.deckA.playheadSec = 100;

      const event = {
        type: "DECK_CUE",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          cuePointSec: undefined,
        },
      };

      handleDeckCue(
        mockIO as unknown as Parameters<typeof handleDeckCue>[0],
        mockSocket as unknown as Parameters<typeof handleDeckCue>[1],
        event
      );

      // Check playhead jumped to cue point
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.cuePointSec).toBe(45); // Unchanged
      expect(updatedRoom?.deckA.playheadSec).toBe(45); // Jumped

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });

  describe("handleDeckSeek", () => {
    it("should seek to position while stopped", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and load a track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.playState = "stopped";
      room.deckA.durationSec = 180;

      const event = {
        type: "DECK_SEEK",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          positionSec: 60,
        },
      };

      handleDeckSeek(
        mockIO as unknown as Parameters<typeof handleDeckSeek>[0],
        mockSocket as unknown as Parameters<typeof handleDeckSeek>[1],
        event
      );

      // Check playhead updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.playheadSec).toBe(60);
      expect(updatedRoom?.deckA.serverStartTime).toBe(null);

      // Check broadcast
      expect(mockIO.emittedEvents.length).toBe(1);
      expect(mockIO.emittedEvents[0]?.event).toBe("DECK_SEEK");

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should seek and update server_start_time while playing", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and set up playing deck
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.playState = "playing";
      room.deckA.serverStartTime = Date.now() - 5000; // Started 5 seconds ago
      room.deckA.durationSec = 180;

      const event = {
        type: "DECK_SEEK",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          positionSec: 90,
        },
      };

      const beforeTs = Date.now();
      handleDeckSeek(
        mockIO as unknown as Parameters<typeof handleDeckSeek>[0],
        mockSocket as unknown as Parameters<typeof handleDeckSeek>[1],
        event
      );
      const afterTs = Date.now();

      // Check playhead and server_start_time updated
      const updatedRoom = roomStore.getRoom(room.roomId);
      expect(updatedRoom?.deckA.playheadSec).toBe(90);
      expect(updatedRoom?.deckA.serverStartTime).toBeGreaterThanOrEqual(beforeTs);
      expect(updatedRoom?.deckA.serverStartTime).toBeLessThanOrEqual(afterTs);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if seek position beyond duration", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      // Create room and load a track
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      const queueItem = addTestQueueItem(room.roomId, clientId);
      room.deckA.loadedTrackId = queueItem.trackId;
      room.deckA.loadedQueueItemId = queueItem.id;
      room.deckA.durationSec = 180;

      const event = {
        type: "DECK_SEEK",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          positionSec: 200, // Beyond duration
        },
      };

      handleDeckSeek(
        mockIO as unknown as Parameters<typeof handleDeckSeek>[0],
        mockSocket as unknown as Parameters<typeof handleDeckSeek>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      const ack = mockSocket.emittedEvents[0]?.data as { accepted: boolean };
      expect(ack.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });

    it("should reject if no track loaded", () => {
      const mockIO = createMockIO();
      const socketId = `deck-test-socket-${Date.now()}`;
      const mockSocket = createMockSocket(socketId);

      const { room, clientId } = roomStore.createRoom("TestHost", socketId);
      // Don't load a track

      const event = {
        type: "DECK_SEEK",
        roomId: room.roomId,
        clientId,
        clientSeq: 1,
        payload: {
          deckId: "A" as const,
          positionSec: 60,
        },
      };

      handleDeckSeek(
        mockIO as unknown as Parameters<typeof handleDeckSeek>[0],
        mockSocket as unknown as Parameters<typeof handleDeckSeek>[1],
        event
      );

      // Should not broadcast
      expect(mockIO.emittedEvents.length).toBe(0);

      // Should send error ack
      const ack = mockSocket.emittedEvents[0]?.data as { accepted: boolean };
      expect(ack.accepted).toBe(false);

      // Cleanup
      roomStore.leaveRoom(socketId);
    });
  });
});
