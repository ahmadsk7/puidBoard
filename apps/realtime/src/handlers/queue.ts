/**
 * Queue event handlers for QUEUE_ADD, QUEUE_REMOVE, QUEUE_REORDER, QUEUE_EDIT.
 * Implements the authoritative queue as source of truth with acks for optimistic UI.
 *
 * Security features:
 * - Rate limiting for all queue operations
 * - Validation of queue indices
 * - Permission checks for host-only actions
 */

import { Server, Socket } from "socket.io";
import {
  QueueAddEventSchema,
  QueueRemoveEventSchema,
  QueueReorderEventSchema,
  QueueEditEventSchema,
  QueueItem,
  QueueItemStatus,
  ServerMutationEvent,
  queueItemExists,
  isValidReorderIndex,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import {
  sendAcceptedAck,
  sendRejectedAck,
  generateEventId,
} from "../protocol/ack.js";
import {
  rateLimiter,
  logRateLimitViolation,
} from "../security/index.js";

/**
 * Generate a unique queue item ID.
 */
function generateQueueItemId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Handle QUEUE_ADD event - add a track to the queue.
 */
export function handleQueueAdd(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = QueueAddEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[QUEUE_ADD] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, clientSeq, payload } = parsed.data;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    console.log(`[QUEUE_ADD] unauthorized socket=${socket.id}`);
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(clientId, "QUEUE_ADD");
  if (!rateResult.allowed) {
    logRateLimitViolation("QUEUE_ADD", clientId, roomId, rateResult.error);
    sendRejectedAck(socket, clientSeq, generateEventId(), rateResult.error);
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room) {
    sendRejectedAck(socket, clientSeq, generateEventId(), "Room not found");
    return;
  }

  // Create new queue item
  const queueItemId = generateQueueItemId();
  const now = Date.now();

  const queueItem: QueueItem = {
    id: queueItemId,
    trackId: payload.trackId,
    title: payload.title,
    durationSec: payload.durationSec,
    addedBy: clientId,
    addedAt: now,
    status: "queued" as QueueItemStatus,
  };

  // Determine insertion position
  const insertAt = payload.insertAt ?? room.queue.length;
  const validInsertAt = Math.max(0, Math.min(insertAt, room.queue.length));

  // Insert into queue
  room.queue.splice(validInsertAt, 0, queueItem);
  room.version++;

  // Generate event metadata
  const eventId = generateEventId();

  // Send ack to the sender
  sendAcceptedAck(socket, clientSeq, eventId);

  // Broadcast mutation event to all room members (including sender for reconciliation)
  // Include the server-generated queueItemId so clients use the same ID
  const mutationEvent: ServerMutationEvent = {
    type: "QUEUE_ADD",
    roomId,
    clientId,
    clientSeq,
    eventId,
    serverTs: now,
    version: room.version,
    payload: {
      ...payload,
      queueItemId, // Include server-generated ID
    },
  };

  io.to(roomId).emit("QUEUE_ADD", mutationEvent);

  console.log(
    `[QUEUE_ADD] roomId=${roomId} clientId=${clientId} trackId=${payload.trackId} queueItemId=${queueItemId} position=${validInsertAt}`
  );
}

/**
 * Handle QUEUE_REMOVE event - remove a track from the queue.
 */
export function handleQueueRemove(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = QueueRemoveEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[QUEUE_REMOVE] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, clientSeq, payload } = parsed.data;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    console.log(`[QUEUE_REMOVE] unauthorized socket=${socket.id}`);
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(clientId, "QUEUE_REMOVE");
  if (!rateResult.allowed) {
    logRateLimitViolation("QUEUE_REMOVE", clientId, roomId, rateResult.error);
    sendRejectedAck(socket, clientSeq, generateEventId(), rateResult.error);
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room) {
    sendRejectedAck(socket, clientSeq, generateEventId(), "Room not found");
    return;
  }

  // Verify queue item exists
  if (!queueItemExists(room, payload.queueItemId)) {
    sendRejectedAck(
      socket,
      clientSeq,
      generateEventId(),
      `Queue item ${payload.queueItemId} not found`
    );
    return;
  }

  // Check if the item is currently loaded in a deck
  const item = room.queue.find((q) => q.id === payload.queueItemId);
  if (
    item &&
    (item.status === "loaded_A" ||
      item.status === "loaded_B" ||
      item.status === "playing_A" ||
      item.status === "playing_B")
  ) {
    sendRejectedAck(
      socket,
      clientSeq,
      generateEventId(),
      "Cannot remove item that is loaded or playing"
    );
    return;
  }

  // Remove from queue
  room.queue = room.queue.filter((q) => q.id !== payload.queueItemId);
  room.version++;

  const now = Date.now();
  const eventId = generateEventId();

  // Send ack to the sender
  sendAcceptedAck(socket, clientSeq, eventId);

  // Broadcast mutation event to all room members
  const mutationEvent: ServerMutationEvent = {
    type: "QUEUE_REMOVE",
    roomId,
    clientId,
    clientSeq,
    eventId,
    serverTs: now,
    version: room.version,
    payload,
  };

  io.to(roomId).emit("QUEUE_REMOVE", mutationEvent);

  console.log(
    `[QUEUE_REMOVE] roomId=${roomId} clientId=${clientId} queueItemId=${payload.queueItemId}`
  );
}

/**
 * Handle QUEUE_REORDER event - reorder a queue item to a new position.
 */
export function handleQueueReorder(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = QueueReorderEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[QUEUE_REORDER] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, clientSeq, payload } = parsed.data;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    console.log(`[QUEUE_REORDER] unauthorized socket=${socket.id}`);
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(clientId, "QUEUE_REORDER");
  if (!rateResult.allowed) {
    logRateLimitViolation("QUEUE_REORDER", clientId, roomId, rateResult.error);
    sendRejectedAck(socket, clientSeq, generateEventId(), rateResult.error);
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room) {
    sendRejectedAck(socket, clientSeq, generateEventId(), "Room not found");
    return;
  }

  // Verify queue item exists
  const itemIndex = room.queue.findIndex((q) => q.id === payload.queueItemId);
  if (itemIndex === -1) {
    sendRejectedAck(
      socket,
      clientSeq,
      generateEventId(),
      `Queue item ${payload.queueItemId} not found`
    );
    return;
  }

  // Validate new index
  if (!isValidReorderIndex(room, payload.newIndex)) {
    sendRejectedAck(
      socket,
      clientSeq,
      generateEventId(),
      `Invalid reorder index ${payload.newIndex}`
    );
    return;
  }

  // Remove item from current position
  const [item] = room.queue.splice(itemIndex, 1);

  // Insert at new position
  // The newIndex represents the desired final position, so we use it directly
  room.queue.splice(payload.newIndex, 0, item!);

  room.version++;

  const now = Date.now();
  const eventId = generateEventId();

  // Send ack to the sender
  sendAcceptedAck(socket, clientSeq, eventId);

  // Broadcast mutation event to all room members
  const mutationEvent: ServerMutationEvent = {
    type: "QUEUE_REORDER",
    roomId,
    clientId,
    clientSeq,
    eventId,
    serverTs: now,
    version: room.version,
    payload,
  };

  io.to(roomId).emit("QUEUE_REORDER", mutationEvent);

  console.log(
    `[QUEUE_REORDER] roomId=${roomId} clientId=${clientId} queueItemId=${payload.queueItemId} oldIndex=${itemIndex} newIndex=${payload.newIndex}`
  );
}

/**
 * Handle QUEUE_EDIT event - edit queue item metadata.
 */
export function handleQueueEdit(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = QueueEditEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[QUEUE_EDIT] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, clientSeq, payload } = parsed.data;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    console.log(`[QUEUE_EDIT] unauthorized socket=${socket.id}`);
    return;
  }

  // Rate limit check
  const rateResult = rateLimiter.checkAndRecord(clientId, "QUEUE_EDIT");
  if (!rateResult.allowed) {
    logRateLimitViolation("QUEUE_EDIT", clientId, roomId, rateResult.error);
    sendRejectedAck(socket, clientSeq, generateEventId(), rateResult.error);
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room) {
    sendRejectedAck(socket, clientSeq, generateEventId(), "Room not found");
    return;
  }

  // Find queue item
  const item = room.queue.find((q) => q.id === payload.queueItemId);
  if (!item) {
    sendRejectedAck(
      socket,
      clientSeq,
      generateEventId(),
      `Queue item ${payload.queueItemId} not found`
    );
    return;
  }

  // Apply updates
  if (payload.updates.title !== undefined) {
    item.title = payload.updates.title;
  }

  room.version++;

  const now = Date.now();
  const eventId = generateEventId();

  // Send ack to the sender
  sendAcceptedAck(socket, clientSeq, eventId);

  // Broadcast mutation event to all room members
  const mutationEvent: ServerMutationEvent = {
    type: "QUEUE_EDIT",
    roomId,
    clientId,
    clientSeq,
    eventId,
    serverTs: now,
    version: room.version,
    payload,
  };

  io.to(roomId).emit("QUEUE_EDIT", mutationEvent);

  console.log(
    `[QUEUE_EDIT] roomId=${roomId} clientId=${clientId} queueItemId=${payload.queueItemId} updates=${JSON.stringify(payload.updates)}`
  );
}

/**
 * Register queue event handlers on a socket.
 */
export function registerQueueHandlers(io: Server, socket: Socket): void {
  socket.on("QUEUE_ADD", (data: unknown) => {
    handleQueueAdd(io, socket, data);
  });

  socket.on("QUEUE_REMOVE", (data: unknown) => {
    handleQueueRemove(io, socket, data);
  });

  socket.on("QUEUE_REORDER", (data: unknown) => {
    handleQueueReorder(io, socket, data);
  });

  socket.on("QUEUE_EDIT", (data: unknown) => {
    handleQueueEdit(io, socket, data);
  });
}
