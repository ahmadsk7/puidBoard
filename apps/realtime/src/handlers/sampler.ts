/**
 * Sampler handler for Virtual DJ Rooms.
 *
 * Handles SAMPLER_PLAY events: validates slot, broadcasts to room.
 * Local playback is fire-on-receive (no timestamp scheduling needed).
 */

import type { Server, Socket } from "socket.io";
import {
  SamplerPlayEventSchema,
  type SamplerPlayEvent,
  type ServerMutationEvent,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import { sendAcceptedAck, sendRejectedAck } from "../protocol/ack.js";
import { rateLimiter, logRateLimitViolation } from "../security/index.js";

/**
 * Handle SAMPLER_PLAY event.
 * Validates slot, rate limits, broadcasts to room with sourceClientId.
 */
export function handleSamplerPlay(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = SamplerPlayEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[SAMPLER_PLAY] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as SamplerPlayEvent;
  const { slot } = event.payload;

  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const rateResult = rateLimiter.checkAndRecord(client.clientId, "SAMPLER_PLAY");
  if (!rateResult.allowed) {
    logRateLimitViolation("SAMPLER_PLAY", client.clientId, client.roomId, rateResult.error);
    sendRejectedAck(socket, event.clientSeq, "", rateResult.error);
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  room.version++;
  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "SAMPLER_PLAY",
    payload: { slot },
  };

  io.to(room.roomId).emit("SAMPLER_PLAY", serverEvent);
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[SAMPLER_PLAY] slot=${slot} by=${client.clientId} roomId=${room.roomId}`
  );
}

/**
 * Register sampler event handlers on a socket.
 */
export function registerSamplerHandlers(io: Server, socket: Socket): void {
  socket.on("SAMPLER_PLAY", (data: unknown) => {
    handleSamplerPlay(io, socket, data);
  });
}
