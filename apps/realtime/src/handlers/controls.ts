/**
 * Control ownership and mixer event handlers.
 *
 * Implements soft control locking:
 * - CONTROL_GRAB: acquires ownership of a control
 * - CONTROL_RELEASE: releases ownership
 * - MIXER_SET: updates control values (with throttling)
 *
 * Ownership model:
 * - TTL = 2s since last movement (CONTROL_OWNERSHIP_TTL_MS)
 * - Last-write-wins (soft lock - anyone can override)
 * - Server broadcasts ownership highlights to all clients
 */

import { Server, Socket } from "socket.io";
import {
  ControlGrabEventSchema,
  ControlReleaseEventSchema,
  MixerSetEventSchema,
  ControlOwnership,
  THROTTLE,
  CONTROL_OWNERSHIP_TTL_MS,
  isValidControlId,
  getControlBounds,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/** Track last MIXER_SET update time per client for throttling */
const lastMixerUpdate: Map<string, number> = new Map();

/**
 * Broadcast message when control ownership changes.
 */
export interface ControlOwnershipBroadcast {
  type: "CONTROL_OWNERSHIP";
  roomId: string;
  controlId: string;
  /** Owner info, or null if released/expired */
  ownership: ControlOwnership | null;
}

/**
 * Broadcast message when a mixer control value changes.
 */
export interface MixerValueBroadcast {
  type: "MIXER_VALUE";
  roomId: string;
  controlId: string;
  value: number;
  /** Who set this value */
  clientId: string;
}

/**
 * Handle CONTROL_GRAB event.
 * Grants ownership of a control to the client.
 */
export function handleControlGrab(
  _io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = ControlGrabEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[CONTROL_GRAB] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, payload } = parsed.data;
  const { controlId } = payload;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    return;
  }

  // Validate control ID
  if (!isValidControlId(controlId)) {
    console.log(`[CONTROL_GRAB] invalid controlId=${controlId}`);
    return;
  }

  // Acquire ownership
  const ownership = acquireControlOwnership(roomId, clientId, controlId);
  if (!ownership) {
    return; // Room not found
  }

  // Broadcast ownership to room
  const broadcast: ControlOwnershipBroadcast = {
    type: "CONTROL_OWNERSHIP",
    roomId,
    controlId,
    ownership,
  };

  // Emit to all clients in the room (including sender)
  _io.to(roomId).emit("CONTROL_OWNERSHIP", broadcast);

  console.log(`[CONTROL_GRAB] roomId=${roomId} clientId=${clientId} controlId=${controlId}`);
}

/**
 * Handle CONTROL_RELEASE event.
 * Releases ownership of a control.
 */
export function handleControlRelease(
  _io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = ControlReleaseEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[CONTROL_RELEASE] invalid payload socket=${socket.id}`);
    return;
  }

  const { roomId, clientId, payload } = parsed.data;
  const { controlId } = payload;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    return;
  }

  // Release ownership (only if current owner)
  const released = releaseControlOwnership(roomId, clientId, controlId);
  if (!released) {
    return; // Room not found or not the owner
  }

  // Broadcast release to room
  const broadcast: ControlOwnershipBroadcast = {
    type: "CONTROL_OWNERSHIP",
    roomId,
    controlId,
    ownership: null,
  };

  _io.to(roomId).emit("CONTROL_OWNERSHIP", broadcast);

  console.log(`[CONTROL_RELEASE] roomId=${roomId} clientId=${clientId} controlId=${controlId}`);
}

/**
 * Handle MIXER_SET event.
 * Updates a mixer control value with throttling and ownership tracking.
 */
export function handleMixerSet(
  _io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = MixerSetEventSchema.safeParse(data);
  if (!parsed.success) {
    // Silently ignore invalid mixer events (high frequency)
    return;
  }

  const { roomId, clientId, payload } = parsed.data;
  const { controlId, value } = payload;

  // Verify client is in the room
  const client = roomStore.getClient(socket.id);
  if (!client || client.roomId !== roomId || client.clientId !== clientId) {
    return;
  }

  // Validate control ID
  if (!isValidControlId(controlId)) {
    return;
  }

  // Validate value bounds
  const bounds = getControlBounds(controlId);
  if (value < bounds.min || value > bounds.max) {
    console.log(
      `[MIXER_SET] value out of bounds: controlId=${controlId} value=${value} bounds=[${bounds.min}, ${bounds.max}]`
    );
    return;
  }

  // Server-side throttle check
  const now = Date.now();
  const throttleKey = `${socket.id}:${controlId}`;
  const lastUpdate = lastMixerUpdate.get(throttleKey) ?? 0;
  if (now - lastUpdate < THROTTLE.CONTROL_MS) {
    // Too soon since last update, drop this event
    return;
  }
  lastMixerUpdate.set(throttleKey, now);

  // Update ownership (implicit grab on movement)
  const ownership = acquireControlOwnership(roomId, clientId, controlId);
  if (!ownership) {
    return; // Room not found
  }

  // Update the control value in room state
  const updated = updateMixerValue(roomId, controlId, value);
  if (!updated) {
    return; // Failed to update
  }

  // Broadcast value change to room
  const valueBroadcast: MixerValueBroadcast = {
    type: "MIXER_VALUE",
    roomId,
    controlId,
    value,
    clientId,
  };

  _io.to(roomId).emit("MIXER_VALUE", valueBroadcast);
}

/**
 * Acquire ownership of a control.
 * Updates the lastMovedAt timestamp if already owned.
 */
function acquireControlOwnership(
  roomId: string,
  clientId: string,
  controlId: string
): ControlOwnership | null {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return null;
  }

  const now = Date.now();
  const existing = room.controlOwners[controlId];

  // If already owned by this client, just update lastMovedAt
  if (existing && existing.clientId === clientId) {
    existing.lastMovedAt = now;
    return existing;
  }

  // Create new ownership
  const ownership: ControlOwnership = {
    clientId,
    acquiredAt: now,
    lastMovedAt: now,
  };

  room.controlOwners[controlId] = ownership;

  return ownership;
}

/**
 * Release ownership of a control.
 * Only releases if the client is the current owner.
 * @returns true if released, false otherwise
 */
function releaseControlOwnership(
  roomId: string,
  clientId: string,
  controlId: string
): boolean {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return false;
  }

  const existing = room.controlOwners[controlId];
  if (!existing || existing.clientId !== clientId) {
    return false; // Not the owner
  }

  delete room.controlOwners[controlId];
  return true;
}

/**
 * Update a mixer control value in the room state.
 * Uses a path-based approach to set nested values.
 */
function updateMixerValue(
  roomId: string,
  controlId: string,
  value: number
): boolean {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return false;
  }

  // Parse the control ID and update the nested value
  // Format: "property" or "component.property" or "component.nested.property"
  const parts = controlId.split(".");

  try {
    // Navigate to the parent object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = room.mixer;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]];
      if (target === undefined) {
        console.error(`[updateMixerValue] invalid path: ${controlId}`);
        return false;
      }
    }

    // Set the final property
    const finalKey = parts[parts.length - 1];
    target[finalKey] = value;

    return true;
  } catch (err) {
    console.error(`[updateMixerValue] error updating ${controlId}:`, err);
    return false;
  }
}

/**
 * Clean up expired control ownerships.
 * Called periodically by a background task.
 * @returns Array of expired ownership info for broadcasting
 */
export function cleanupExpiredOwnerships(roomId: string): Array<{
  controlId: string;
  ownership: ControlOwnership;
}> {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return [];
  }

  const now = Date.now();
  const expired: Array<{ controlId: string; ownership: ControlOwnership }> = [];

  for (const [controlId, ownership] of Object.entries(room.controlOwners)) {
    const timeSinceLastMove = now - ownership.lastMovedAt;
    if (timeSinceLastMove > CONTROL_OWNERSHIP_TTL_MS) {
      expired.push({ controlId, ownership });
      delete room.controlOwners[controlId];
    }
  }

  return expired;
}

/**
 * Clear mixer throttle tracking for a disconnected client.
 * Called by the room store during cleanup.
 */
export function clearMixerThrottle(socketId: string): void {
  // Clear all throttle entries for this socket
  const keysToDelete: string[] = [];
  for (const key of lastMixerUpdate.keys()) {
    if (key.startsWith(`${socketId}:`)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    lastMixerUpdate.delete(key);
  }
}

/**
 * Release all controls owned by a client.
 * Called when a client disconnects or leaves a room.
 * @returns Array of control IDs that were released
 */
export function releaseAllClientControls(
  roomId: string,
  clientId: string
): string[] {
  const room = roomStore.getRoom(roomId);
  if (!room) {
    return [];
  }

  const released: string[] = [];

  for (const [controlId, ownership] of Object.entries(room.controlOwners)) {
    if (ownership.clientId === clientId) {
      delete room.controlOwners[controlId];
      released.push(controlId);
    }
  }

  return released;
}

/**
 * Register control handlers on a socket.
 */
export function registerControlHandlers(io: Server, socket: Socket): void {
  socket.on("CONTROL_GRAB", (data: unknown) => {
    handleControlGrab(io, socket, data);
  });

  socket.on("CONTROL_RELEASE", (data: unknown) => {
    handleControlRelease(io, socket, data);
  });

  socket.on("MIXER_SET", (data: unknown) => {
    handleMixerSet(io, socket, data);
  });
}
