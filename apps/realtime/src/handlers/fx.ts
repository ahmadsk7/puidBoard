/**
 * FX event handlers for Virtual DJ Rooms.
 *
 * Implements FX control:
 * - FX_SET: Set FX parameters (type, wetDry, param)
 * - FX_TOGGLE: Enable/disable FX
 *
 * These events update the mixer.fx state and broadcast to all room members.
 */

import type { Server, Socket } from "socket.io";
import {
  FxSetEventSchema,
  FxToggleEventSchema,
  type FxSetEvent,
  type FxToggleEvent,
  type ServerMutationEvent,
  type FxType,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import { sendAcceptedAck, sendRejectedAck } from "../protocol/ack.js";
import { rateLimiter, logRateLimitViolation } from "../security/index.js";

/**
 * Handle FX_SET event.
 * Sets an FX parameter (type, wetDry, or param).
 */
export function handleFxSet(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = FxSetEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[FX_SET] invalid payload socket=${socket.id}`, parsed.error);
    return;
  }

  const event = parsed.data as FxSetEvent;
  const { param, value } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[FX_SET] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(client.clientId, "FX_SET");
  if (!rateResult.allowed) {
    logRateLimitViolation("FX_SET", client.clientId, client.roomId, rateResult.error);
    sendRejectedAck(socket, event.clientSeq, "", rateResult.error);
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Apply the FX parameter change
  if (param === "type") {
    // Validate FX type
    const validTypes: FxType[] = ["echo", "reverb", "filter", "none"];
    if (!validTypes.includes(value as FxType)) {
      console.log(`[FX_SET] invalid FX type: ${value}`);
      sendRejectedAck(socket, event.clientSeq, "", "Invalid FX type");
      return;
    }
    room.mixer.fx.type = value as FxType;
    // Reset enabled state when changing to "none"
    if (value === "none") {
      room.mixer.fx.enabled = false;
    }
  } else if (param === "wetDry") {
    if (typeof value !== "number" || value < 0 || value > 1) {
      console.log(`[FX_SET] invalid wetDry value: ${value}`);
      sendRejectedAck(socket, event.clientSeq, "", "Invalid wetDry value");
      return;
    }
    room.mixer.fx.wetDry = value;
  } else if (param === "param") {
    if (typeof value !== "number" || value < 0 || value > 1) {
      console.log(`[FX_SET] invalid param value: ${value}`);
      sendRejectedAck(socket, event.clientSeq, "", "Invalid param value");
      return;
    }
    room.mixer.fx.param = value;
  } else {
    console.log(`[FX_SET] unknown param: ${param}`);
    sendRejectedAck(socket, event.clientSeq, "", "Unknown FX parameter");
    return;
  }

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "FX_SET",
    payload: { param, value },
  };

  io.to(room.roomId).emit("FX_SET", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[FX_SET] param=${param} value=${value} roomId=${room.roomId} clientId=${client.clientId}`
  );
}

/**
 * Handle FX_TOGGLE event.
 * Enables or disables the FX.
 */
export function handleFxToggle(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = FxToggleEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[FX_TOGGLE] invalid payload socket=${socket.id}`, parsed.error);
    return;
  }

  const event = parsed.data as FxToggleEvent;
  const { enabled } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[FX_TOGGLE] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(client.clientId, "FX_TOGGLE");
  if (!rateResult.allowed) {
    logRateLimitViolation("FX_TOGGLE", client.clientId, client.roomId, rateResult.error);
    sendRejectedAck(socket, event.clientSeq, "", rateResult.error);
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Cannot enable FX if type is "none"
  if (enabled && room.mixer.fx.type === "none") {
    console.log(`[FX_TOGGLE] cannot enable FX when type is none`);
    sendRejectedAck(socket, event.clientSeq, "", "Cannot enable FX when type is none");
    return;
  }

  // Apply the toggle
  room.mixer.fx.enabled = enabled;

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "FX_TOGGLE",
    payload: { enabled },
  };

  io.to(room.roomId).emit("FX_TOGGLE", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[FX_TOGGLE] enabled=${enabled} fxType=${room.mixer.fx.type} roomId=${room.roomId} clientId=${client.clientId}`
  );
}

/**
 * Register FX event handlers on a socket.
 */
export function registerFxHandlers(io: Server, socket: Socket): void {
  socket.on("FX_SET", (data: unknown) => {
    handleFxSet(io, socket, data);
  });

  socket.on("FX_TOGGLE", (data: unknown) => {
    handleFxToggle(io, socket, data);
  });
}
