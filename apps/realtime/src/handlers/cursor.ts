/**
 * Cursor event handler for CURSOR_MOVE events.
 * Handles throttling, state updates, and broadcast to room members.
 */

import { Server, Socket } from "socket.io";
import {
  CursorMoveEventSchema,
  CursorMovePayload,
  CursorState,
  THROTTLE,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/** Track last cursor update time per client for throttling */
const lastCursorUpdate: Map<string, number> = new Map();

/**
 * Server-side cursor update event broadcast to other clients.
 */
export interface CursorUpdateBroadcast {
  type: "CURSOR_UPDATE";
  roomId: string;
  clientId: string;
  cursor: CursorState;
}

/**
 * Handle CURSOR_MOVE event from a client.
 * Updates the member's cursor in room state and broadcasts to others.
 */
export function handleCursorMove(
  _io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = CursorMoveEventSchema.safeParse(data);
  if (!parsed.success) {
    // Silently ignore invalid cursor events (high frequency, don't spam errors)
    return;
  }

  const { roomId, clientId, payload } = parsed.data;

  // Verify client is in the room they claim
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    // Client is not in this room or mismatched clientId
    return;
  }

  // Server-side throttle check
  const now = Date.now();
  const lastUpdate = lastCursorUpdate.get(socket.id) ?? 0;
  if (now - lastUpdate < THROTTLE.CURSOR_MS) {
    // Too soon since last update, drop this event
    return;
  }
  lastCursorUpdate.set(socket.id, now);

  // Update cursor in room state
  const cursor = updateCursorInRoom(roomId, clientId, payload, now);
  if (!cursor) {
    return;
  }

  // Broadcast to all other members in the room
  const broadcast: CursorUpdateBroadcast = {
    type: "CURSOR_UPDATE",
    roomId,
    clientId,
    cursor,
  };

  socket.to(roomId).emit("CURSOR_UPDATE", broadcast);
}

/**
 * Update a member's cursor position in the room state.
 * @returns The updated cursor state, or null if update failed
 */
function updateCursorInRoom(
  roomId: string,
  clientId: string,
  payload: CursorMovePayload,
  timestamp: number
): CursorState | null {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return null;
  }

  const member = room.members.find((m) => m.clientId === clientId);
  if (!member) {
    return null;
  }

  // Update cursor state
  const cursor: CursorState = {
    x: payload.x,
    y: payload.y,
    lastUpdated: timestamp,
  };

  member.cursor = cursor;

  return cursor;
}

/**
 * Clear a client's cursor when they disconnect or leave.
 * Called by the room store during cleanup.
 */
export function clearCursorThrottle(socketId: string): void {
  lastCursorUpdate.delete(socketId);
}

/**
 * Register cursor handlers on a socket.
 */
export function registerCursorHandlers(io: Server, socket: Socket): void {
  socket.on("CURSOR_MOVE", (data: unknown) => {
    handleCursorMove(io, socket, data);
  });
}
