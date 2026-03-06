/**
 * Socket.IO event handlers for the realtime protocol.
 */

import { Server, Socket } from "socket.io";
import {
  CreateRoomEventSchema,
  JoinRoomEventSchema,
  LeaveRoomEventSchema,
  RejoinRoomEventSchema,
  RoomSnapshotEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import { registerCursorHandlers, clearCursorThrottle } from "../handlers/cursor.js";
import { registerQueueHandlers } from "../handlers/queue.js";
import {
  registerControlHandlers,
  clearMixerThrottle,
  releaseAllClientControls,
} from "../handlers/controls.js";
import { registerTimeHandlers } from "../handlers/time.js";
import { registerDeckHandlers } from "../handlers/deck.js";
import { registerFxHandlers } from "../handlers/fx.js";
import { registerSamplerHandlers } from "../handlers/sampler.js";
import { startBeacon, stopBeacon } from "../timers/beacon.js";
import { getPersistence } from "../rooms/persistence.js";
import { idempotencyStore } from "./idempotency.js";
import { rateLimiter } from "../security/index.js";

/**
 * Register all protocol handlers on a socket.
 */
export function registerHandlers(io: Server, socket: Socket): void {
  // Handle room creation
  socket.on("CREATE_ROOM", (data: unknown) => {
    handleCreateRoom(io, socket, data);
  });

  // Handle room join
  socket.on("JOIN_ROOM", (data: unknown) => {
    handleJoinRoom(io, socket, data);
  });

  // Handle room leave
  socket.on("LEAVE_ROOM", (data: unknown) => {
    handleLeaveRoom(io, socket, data);
  });

  // Handle room rejoin (reconnection)
  socket.on("REJOIN_ROOM", (data: unknown) => {
    handleRejoinRoom(io, socket, data);
  });

  // Handle disconnect
  socket.on("disconnect", (reason: string) => {
    handleDisconnect(io, socket, reason);
  });

  // Register time sync handlers
  registerTimeHandlers(socket);

  // Register cursor handlers
  registerCursorHandlers(io, socket);

  // Register queue handlers
  registerQueueHandlers(io, socket);

  // Register control handlers
  registerControlHandlers(io, socket);

  // Register deck handlers
  registerDeckHandlers(io, socket);

  // Register FX handlers
  registerFxHandlers(io, socket);

  // Register sampler handlers
  registerSamplerHandlers(io, socket);
}

/**
 * Handle CREATE_ROOM event.
 */
function handleCreateRoom(io: Server, socket: Socket, data: unknown): void {
  const parsed = CreateRoomEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[CREATE_ROOM] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid CREATE_ROOM payload",
    });
    return;
  }

  const { name } = parsed.data;

  // Check if client is already in a room - auto-leave before creating new
  const existingClient = roomStore.getClient(socket.id);
  if (existingClient?.roomId) {
    console.log(`[CREATE_ROOM] client already in room, auto-leaving roomId=${existingClient.roomId}`);
    // Leave the existing room first
    const leaveResult = roomStore.leaveRoom(socket.id);
    if (leaveResult) {
      socket.leave(leaveResult.roomId);
      // Notify remaining members
      if (leaveResult.room && leaveResult.room.members.length > 0) {
        const memberLeft: MemberLeftEvent = {
          type: "MEMBER_LEFT",
          roomId: leaveResult.roomId,
          serverTs: Date.now(),
          payload: { clientId: leaveResult.clientId },
        };
        io.to(leaveResult.roomId).emit("MEMBER_LEFT", memberLeft);
      }
      // Stop beacon if room is empty
      if (!leaveResult.room || leaveResult.room.members.length === 0) {
        stopBeacon(leaveResult.roomId);
      }
    }
  }

  // Create the room
  const { room, clientId } = roomStore.createRoom(name, socket.id);

  // Join the socket.io room for broadcasts
  socket.join(room.roomId);

  // Send snapshot to the creator
  const snapshot: RoomSnapshotEvent = {
    type: "ROOM_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: room,
  };

  socket.emit("ROOM_SNAPSHOT", snapshot);

  // Also send the client their ID
  socket.emit("CLIENT_ID", { clientId });

  // Start beacon timer for epoch-based sync
  startBeacon(io, room.roomId);

  // Start persistence snapshots
  const persistence = getPersistence();
  persistence.startSnapshotting(room.roomId);

  console.log(
    `[CREATE_ROOM] created roomId=${room.roomId} code=${room.roomCode} host=${clientId}`
  );
}

/**
 * Handle JOIN_ROOM event.
 */
function handleJoinRoom(io: Server, socket: Socket, data: unknown): void {
  const parsed = JoinRoomEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[JOIN_ROOM] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid JOIN_ROOM payload",
    });
    return;
  }

  const { roomCode, name } = parsed.data;

  // Check if client is already in a room - auto-leave before joining new
  const existingClient = roomStore.getClient(socket.id);
  if (existingClient?.roomId) {
    console.log(`[JOIN_ROOM] client already in room, auto-leaving roomId=${existingClient.roomId}`);
    // Leave the existing room first
    const leaveResult = roomStore.leaveRoom(socket.id);
    if (leaveResult) {
      socket.leave(leaveResult.roomId);
      // Notify remaining members
      if (leaveResult.room && leaveResult.room.members.length > 0) {
        const memberLeft: MemberLeftEvent = {
          type: "MEMBER_LEFT",
          roomId: leaveResult.roomId,
          serverTs: Date.now(),
          payload: { clientId: leaveResult.clientId },
        };
        io.to(leaveResult.roomId).emit("MEMBER_LEFT", memberLeft);
      }
      // Stop beacon if room is empty
      if (!leaveResult.room || leaveResult.room.members.length === 0) {
        stopBeacon(leaveResult.roomId);
      }
    }
  }

  // Try to join the room
  const result = roomStore.joinRoom(roomCode, name, socket.id);

  // If room not found in memory, could restore from persistence in future
  // For MVP, if room not in memory, it's truly not found
  if (!result) {
    console.log(`[JOIN_ROOM] room not in memory code=${roomCode}`);

    socket.emit("ERROR", {
      type: "ROOM_NOT_FOUND",
      message: `Room with code ${roomCode} not found`,
    });
    return;
  }

  const { room, clientId } = result;

  // Join the socket.io room for broadcasts
  socket.join(room.roomId);

  // Send snapshot to the joiner
  const snapshot: RoomSnapshotEvent = {
    type: "ROOM_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: room,
  };

  socket.emit("ROOM_SNAPSHOT", snapshot);

  // Also send the client their ID
  socket.emit("CLIENT_ID", { clientId });

  // Notify other members
  const newMember = room.members.find((m) => m.clientId === clientId);
  if (newMember) {
    const memberJoined: MemberJoinedEvent = {
      type: "MEMBER_JOINED",
      roomId: room.roomId,
      serverTs: Date.now(),
      payload: {
        clientId: newMember.clientId,
        name: newMember.name,
        color: newMember.color,
        isHost: newMember.isHost,
      },
    };

    // Broadcast to all other members in the room
    socket.to(room.roomId).emit("MEMBER_JOINED", memberJoined);
  }

  // Ensure beacon is running for this room (idempotent)
  startBeacon(io, room.roomId);

  console.log(
    `[JOIN_ROOM] joined roomId=${room.roomId} clientId=${clientId} name=${name}`
  );
}

/**
 * Handle REJOIN_ROOM event (reconnection with grace period).
 */
function handleRejoinRoom(io: Server, socket: Socket, data: unknown): void {
  const parsed = RejoinRoomEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[REJOIN_ROOM] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid REJOIN_ROOM payload",
    });
    return;
  }

  const { roomCode, name, previousClientId } = parsed.data;

  const result = roomStore.rejoinRoom(roomCode, previousClientId, name, socket.id);

  if (!result) {
    console.log(`[REJOIN_ROOM] room not found or rejoin failed code=${roomCode}`);
    socket.emit("ERROR", {
      type: "ROOM_NOT_FOUND",
      message: `Room with code ${roomCode} not found`,
    });
    return;
  }

  const { room, clientId, rejoined } = result;

  // Join the socket.io room for broadcasts
  socket.join(room.roomId);

  // Send rejoin snapshot
  socket.emit("ROOM_REJOIN_SNAPSHOT", {
    type: "ROOM_REJOIN_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: room,
    clientId,
    missedEvents: [], // Events from idempotency store could be added here
  });

  // Also send the client their ID
  socket.emit("CLIENT_ID", { clientId });

  if (!rejoined) {
    // Normal join - notify other members
    const newMember = room.members.find((m) => m.clientId === clientId);
    if (newMember) {
      const memberJoined: MemberJoinedEvent = {
        type: "MEMBER_JOINED",
        roomId: room.roomId,
        serverTs: Date.now(),
        payload: {
          clientId: newMember.clientId,
          name: newMember.name,
          color: newMember.color,
          isHost: newMember.isHost,
        },
      };
      socket.to(room.roomId).emit("MEMBER_JOINED", memberJoined);
    }
  }
  // If rejoined via grace period, no MEMBER_JOINED needed (they never left)

  // Ensure beacon is running
  startBeacon(io, room.roomId);

  console.log(
    `[REJOIN_ROOM] ${rejoined ? "restored" : "joined"} roomId=${room.roomId} clientId=${clientId}`
  );
}

/**
 * Handle LEAVE_ROOM event.
 */
async function handleLeaveRoom(io: Server, socket: Socket, data: unknown): Promise<void> {
  const parsed = LeaveRoomEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[LEAVE_ROOM] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid LEAVE_ROOM payload",
    });
    return;
  }

  // Clean up cursor throttle tracking
  clearCursorThrottle(socket.id);

  // Clean up mixer throttle tracking
  clearMixerThrottle(socket.id);

  // Get client info before leaving to release controls and clear rate limits
  const client = roomStore.getClient(socket.id);
  const clientIdForCleanup = client?.clientId;
  const roomIdForCleanup = client?.roomId;

  // Clean up rate limit tracking
  if (clientIdForCleanup) {
    rateLimiter.clearClient(clientIdForCleanup);
  }

  const result = roomStore.leaveRoom(socket.id);
  if (!result) {
    return; // Client wasn't in a room
  }

  const { roomId, clientId, room } = result;

  // Leave the socket.io room
  socket.leave(roomId);

  // Release all controls owned by this client
  if (clientIdForCleanup && roomIdForCleanup) {
    const releasedControls = releaseAllClientControls(roomIdForCleanup, clientIdForCleanup);
    // Broadcast control releases to remaining members
    for (const controlId of releasedControls) {
      io.to(roomIdForCleanup).emit("CONTROL_OWNERSHIP", {
        type: "CONTROL_OWNERSHIP",
        roomId: roomIdForCleanup,
        controlId,
        ownership: null,
      });
    }
  }

  // If room is now empty, stop beacon and clean up persistence
  if (!room || room.members.length === 0) {
    stopBeacon(roomId);

    // Clean up persistence
    const persistence = getPersistence();
    await persistence.deleteSnapshot(roomId);
    idempotencyStore.deleteRoom(roomId);
  }

  // Notify remaining members
  if (room && room.members.length > 0) {
    const memberLeft: MemberLeftEvent = {
      type: "MEMBER_LEFT",
      roomId,
      serverTs: Date.now(),
      payload: { clientId },
    };

    io.to(roomId).emit("MEMBER_LEFT", memberLeft);
  }

  // Confirm to the leaving client
  socket.emit("ROOM_LEFT", { roomId });

  console.log(`[LEAVE_ROOM] left roomId=${roomId} clientId=${clientId}`);
}

/**
 * Handle socket disconnect.
 * Uses grace period to allow seamless reconnection.
 */
async function handleDisconnect(io: Server, socket: Socket, reason: string): Promise<void> {
  console.log(`[disconnect] socket=${socket.id} reason=${reason}`);

  // Clean up cursor throttle tracking
  clearCursorThrottle(socket.id);

  // Clean up mixer throttle tracking
  clearMixerThrottle(socket.id);

  // Get client info before processing
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) return;

  const clientIdForCleanup = client.clientId;
  const roomIdForCleanup = client.roomId;

  // Release all controls owned by this client
  const releasedControls = releaseAllClientControls(roomIdForCleanup, clientIdForCleanup);
  for (const controlId of releasedControls) {
    io.to(roomIdForCleanup).emit("CONTROL_OWNERSHIP", {
      type: "CONTROL_OWNERSHIP",
      roomId: roomIdForCleanup,
      controlId,
      ownership: null,
    });
  }

  // Use grace period instead of immediate removal
  const result = roomStore.disconnectWithGrace(
    socket.id,
    async (expiredClientId, expiredRoomId) => {
      // Grace period expired callback - finalize cleanup
      console.log(`[disconnect] grace expired clientId=${expiredClientId} roomId=${expiredRoomId}`);

      rateLimiter.clearClient(expiredClientId);

      const room = roomStore.getRoom(expiredRoomId);

      // If room is now empty, stop beacon and clean up
      if (!room || room.members.length === 0) {
        stopBeacon(expiredRoomId);
        const persistence = getPersistence();
        await persistence.deleteSnapshot(expiredRoomId);
        idempotencyStore.deleteRoom(expiredRoomId);
      }

      // Notify remaining members that this client has left
      if (room && room.members.length > 0) {
        const memberLeft: MemberLeftEvent = {
          type: "MEMBER_LEFT",
          roomId: expiredRoomId,
          serverTs: Date.now(),
          payload: { clientId: expiredClientId },
        };
        io.to(expiredRoomId).emit("MEMBER_LEFT", memberLeft);
      }
    }
  );

  if (!result) {
    return;
  }

  console.log(
    `[disconnect] grace period started roomId=${result.roomId} clientId=${result.clientId}`
  );
}
