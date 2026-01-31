/**
 * Socket.IO event handlers for the realtime protocol.
 */

import { Server, Socket } from "socket.io";
import {
  CreateRoomEventSchema,
  JoinRoomEventSchema,
  LeaveRoomEventSchema,
  TimePingEventSchema,
  RoomSnapshotEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
  TimePongEvent,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import { registerCursorHandlers, clearCursorThrottle } from "../handlers/cursor.js";
import { registerQueueHandlers } from "../handlers/queue.js";
import {
  registerControlHandlers,
  clearMixerThrottle,
  releaseAllClientControls,
} from "../handlers/controls.js";
import { registerDeckHandlers } from "../handlers/deck.js";
import { startSyncTick, stopSyncTick } from "../timers/syncTick.js";

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

  // Handle time ping for latency measurement
  socket.on("TIME_PING", (data: unknown) => {
    handleTimePing(socket, data);
  });

  // Handle disconnect
  socket.on("disconnect", (reason: string) => {
    handleDisconnect(io, socket, reason);
  });

  // Register cursor handlers
  registerCursorHandlers(io, socket);

  // Register queue handlers
  registerQueueHandlers(io, socket);

  // Register control handlers
  registerControlHandlers(io, socket);

  // Register deck handlers
  registerDeckHandlers(io, socket);
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

  // Check if client is already in a room
  const existingClient = roomStore.getClient(socket.id);
  if (existingClient?.roomId) {
    socket.emit("ERROR", {
      type: "ALREADY_IN_ROOM",
      message: "Already in a room. Leave first.",
    });
    return;
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

  // Start sync tick timer for this room
  startSyncTick(io, room.roomId);

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

  // Check if client is already in a room
  const existingClient = roomStore.getClient(socket.id);
  if (existingClient?.roomId) {
    socket.emit("ERROR", {
      type: "ALREADY_IN_ROOM",
      message: "Already in a room. Leave first.",
    });
    return;
  }

  // Try to join the room
  const result = roomStore.joinRoom(roomCode, name, socket.id);
  if (!result) {
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

  // Ensure sync tick is running for this room (idempotent)
  startSyncTick(io, room.roomId);

  console.log(
    `[JOIN_ROOM] joined roomId=${room.roomId} clientId=${clientId} name=${name}`
  );
}

/**
 * Handle LEAVE_ROOM event.
 */
function handleLeaveRoom(io: Server, socket: Socket, data: unknown): void {
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

  // Get client info before leaving to release controls
  const client = roomStore.getClient(socket.id);
  const clientIdForCleanup = client?.clientId;
  const roomIdForCleanup = client?.roomId;

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

  // Notify remaining members
  if (room && room.members.length > 0) {
    const memberLeft: MemberLeftEvent = {
      type: "MEMBER_LEFT",
      roomId,
      serverTs: Date.now(),
      payload: { clientId },
    };

    io.to(roomId).emit("MEMBER_LEFT", memberLeft);
  } else {
    // Room was deleted (last member left), stop sync tick
    stopSyncTick(roomId);
  }

  // Confirm to the leaving client
  socket.emit("ROOM_LEFT", { roomId });

  console.log(`[LEAVE_ROOM] left roomId=${roomId} clientId=${clientId}`);
}

/**
 * Handle TIME_PING event for latency measurement.
 */
function handleTimePing(socket: Socket, data: unknown): void {
  const parsed = TimePingEventSchema.safeParse(data);
  if (!parsed.success) {
    return; // Silently ignore invalid pings
  }

  const { t0 } = parsed.data;
  const serverTs = Date.now();

  // Calculate approximate latency (one-way)
  const latencyMs = Math.max(0, Math.round((serverTs - t0) / 2));

  // Update stored latency
  roomStore.updateLatency(socket.id, latencyMs);

  // Send pong
  const pong: TimePongEvent = {
    type: "TIME_PONG",
    t0,
    serverTs,
  };

  socket.emit("TIME_PONG", pong);
}

/**
 * Handle socket disconnect.
 */
function handleDisconnect(io: Server, socket: Socket, reason: string): void {
  console.log(`[disconnect] socket=${socket.id} reason=${reason}`);

  // Clean up cursor throttle tracking
  clearCursorThrottle(socket.id);

  // Clean up mixer throttle tracking
  clearMixerThrottle(socket.id);

  // Get client info before leaving to release controls
  const client = roomStore.getClient(socket.id);
  const clientIdForCleanup = client?.clientId;
  const roomIdForCleanup = client?.roomId;

  const result = roomStore.leaveRoom(socket.id);
  if (!result) {
    return; // Client wasn't in a room
  }

  const { roomId, clientId, room } = result;

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

  // Notify remaining members
  if (room && room.members.length > 0) {
    const memberLeft: MemberLeftEvent = {
      type: "MEMBER_LEFT",
      roomId,
      serverTs: Date.now(),
      payload: { clientId },
    };

    io.to(roomId).emit("MEMBER_LEFT", memberLeft);
  } else {
    // Room was deleted (last member disconnected), stop sync tick
    stopSyncTick(roomId);
  }

  console.log(
    `[disconnect] cleaned up roomId=${roomId} clientId=${clientId}`
  );
}
