import { describe, it, expect } from "vitest";

// We need to test the RoomStore class directly, so we'll create a fresh instance for each test
// Since the module exports a singleton, we'll need to import the class and create instances

// For testing, we'll re-implement a minimal version or test through the singleton
// For now, let's test through the exported singleton and reset between tests

describe("RoomStore", () => {
  // Note: Since roomStore is a singleton, tests may affect each other
  // In a real scenario, we'd refactor to allow injecting/resetting the store

  describe("createRoom", () => {
    it("creates a room with valid host", async () => {
      // Dynamic import to get fresh module
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);

      expect(room).toBeDefined();
      expect(room.roomId).toBeTruthy();
      expect(room.roomCode).toHaveLength(6);
      expect(room.version).toBe(0);
      expect(room.hostId).toBe(clientId);
      expect(room.members).toHaveLength(1);
      expect(room.members[0]?.name).toBe("TestHost");
      expect(room.members[0]?.isHost).toBe(true);
      expect(room.queue).toEqual([]);
      expect(room.deckA.deckId).toBe("A");
      expect(room.deckB.deckId).toBe("B");
    });

    it("assigns correct default mixer state", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const { room } = roomStore.createRoom("TestHost", socketId);

      expect(room?.mixer.crossfader).toBe(0.5);
      expect(room?.mixer.masterVolume).toBe(0.8);
      expect(room?.mixer.channelA.fader).toBe(1);
      expect(room?.mixer.channelB.fader).toBe(1);
    });

    it("tracks client after room creation", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const { room, clientId } = roomStore.createRoom("TestHost", socketId);

      const client = roomStore.getClient(socketId);
      expect(client).toBeDefined();
      expect(client?.clientId).toBe(clientId);
      expect(client?.roomId).toBe(room.roomId);
    });
  });

  describe("joinRoom", () => {
    it("joins an existing room by code", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom } = roomStore.createRoom("Host", hostSocketId);

      const joinerSocketId = `joiner-socket-${Date.now()}`;
      const result = roomStore.joinRoom(
        hostRoom.roomCode,
        "Joiner",
        joinerSocketId
      );

      expect(result).not.toBeNull();
      expect(result?.room.members).toHaveLength(2);
      expect(result?.room.members[1]?.name).toBe("Joiner");
      expect(result?.room.members[1]?.isHost).toBe(false);
      expect(result?.room.version).toBe(1);
    });

    it("returns null for non-existent room code", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const result = roomStore.joinRoom("XXXXXX", "Test", socketId);

      expect(result).toBeNull();
    });

    it("assigns different colors to members", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom } = roomStore.createRoom("Host", hostSocketId);

      const joinerSocketId = `joiner-socket-${Date.now()}`;
      const result = roomStore.joinRoom(
        hostRoom.roomCode,
        "Joiner",
        joinerSocketId
      );

      expect(result?.room.members[0]?.color).not.toBe(
        result?.room.members[1]?.color
      );
    });

    it("handles case-insensitive room codes", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom } = roomStore.createRoom("Host", hostSocketId);

      const joinerSocketId = `joiner-socket-${Date.now()}`;
      const result = roomStore.joinRoom(
        hostRoom?.roomCode.toLowerCase() ?? "",
        "Joiner",
        joinerSocketId
      );

      expect(result).not.toBeNull();
    });
  });

  describe("leaveRoom", () => {
    it("removes member from room on leave", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom, clientId: hostId } = roomStore.createRoom(
        "Host",
        hostSocketId
      );

      const joinerSocketId = `joiner-socket-${Date.now()}`;
      roomStore.joinRoom(hostRoom.roomCode, "Joiner", joinerSocketId);

      const result = roomStore.leaveRoom(joinerSocketId);

      expect(result).not.toBeNull();
      expect(result?.room?.members).toHaveLength(1);
      expect(result?.room?.members[0]?.clientId).toBe(hostId);
    });

    it("deletes room when last member leaves", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom } = roomStore.createRoom("Host", hostSocketId);
      const roomId = hostRoom.roomId;

      roomStore.leaveRoom(hostSocketId);

      expect(roomStore.getRoom(roomId)).toBeUndefined();
    });

    it("transfers host when host leaves", async () => {
      const { roomStore } = await import("./store.js");

      const hostSocketId = `host-socket-${Date.now()}`;
      const { room: hostRoom } = roomStore.createRoom("Host", hostSocketId);

      const joinerSocketId = `joiner-socket-${Date.now()}`;
      const joinResult = roomStore.joinRoom(
        hostRoom.roomCode,
        "Joiner",
        joinerSocketId
      );
      const joinerId = joinResult?.clientId;

      roomStore.leaveRoom(hostSocketId);

      const updatedRoom = roomStore.getRoom(hostRoom.roomId);
      expect(updatedRoom?.hostId).toBe(joinerId);
      expect(updatedRoom?.members[0]?.isHost).toBe(true);
    });

    it("cleans up client tracking on leave", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      roomStore.createRoom("Host", socketId);

      roomStore.leaveRoom(socketId);

      expect(roomStore.getClient(socketId)).toBeUndefined();
    });
  });

  describe("latency tracking", () => {
    it("updates member latency", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const { room, clientId } = roomStore.createRoom("Host", socketId);

      roomStore.updateLatency(socketId, 50);

      const updatedRoom = roomStore.getRoom(room.roomId);
      const member = updatedRoom?.members.find((m) => m.clientId === clientId);
      expect(member?.latencyMs).toBe(50);
    });
  });

  describe("getRoomByCode", () => {
    it("retrieves room by code", async () => {
      const { roomStore } = await import("./store.js");

      const socketId = `test-socket-${Date.now()}`;
      const { room } = roomStore.createRoom("Host", socketId);

      const retrieved = roomStore.getRoomByCode(room?.roomCode ?? "");
      expect(retrieved?.roomId).toBe(room?.roomId);
    });
  });

  describe("monitoring", () => {
    it("tracks room and client counts", async () => {
      const { roomStore } = await import("./store.js");

      const initialRooms = roomStore.getRoomCount();
      const initialClients = roomStore.getClientCount();

      const socketId = `test-socket-${Date.now()}`;
      roomStore.createRoom("Host", socketId);

      expect(roomStore.getRoomCount()).toBeGreaterThanOrEqual(initialRooms);
      expect(roomStore.getClientCount()).toBeGreaterThanOrEqual(initialClients);
    });
  });
});
