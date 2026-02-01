/**
 * Comprehensive validation utilities for Virtual DJ Rooms.
 *
 * Provides:
 * - Bounds validation for control values, seek positions, queue indices
 * - Permission checks for host-only actions
 * - Client room membership validation
 * - Type guards and helpers with specific error messages
 */

import type { RoomState, DeckState, DeckId } from "@puid-board/shared";
import {
  isValidControlId,
  getControlBounds,
  type ValidControlId,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationSuccess {
  valid: true;
}

export interface ValidationError {
  valid: false;
  error: string;
  code: ValidationErrorCode;
}

export type ValidationResult = ValidationSuccess | ValidationError;

export type ValidationErrorCode =
  | "INVALID_CONTROL_ID"
  | "VALUE_OUT_OF_BOUNDS"
  | "INVALID_SEEK_POSITION"
  | "INVALID_QUEUE_INDEX"
  | "INVALID_CURSOR_POSITION"
  | "NOT_IN_ROOM"
  | "ROOM_MISMATCH"
  | "CLIENT_MISMATCH"
  | "NOT_HOST"
  | "PERMISSION_DENIED"
  | "ROOM_NOT_FOUND"
  | "DECK_NOT_FOUND"
  | "QUEUE_ITEM_NOT_FOUND";

// ============================================================================
// Permission Configuration
// ============================================================================

/** Actions that require host permission (MVP: minimal set) */
export const HOST_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "QUEUE_CLEAR", // Clear entire queue (not implemented yet but reserve it)
  // For MVP, most actions are allowed by any member
  // Can expand this list later:
  // "ROOM_SETTINGS_UPDATE",
  // "KICK_MEMBER",
]);

// ============================================================================
// Bounds Validation
// ============================================================================

/**
 * Validate a control value is within the expected bounds.
 */
export function validateControlValue(
  controlId: string,
  value: number
): ValidationResult {
  if (!isValidControlId(controlId)) {
    return {
      valid: false,
      error: `Invalid control ID: ${controlId}`,
      code: "INVALID_CONTROL_ID",
    };
  }

  const bounds = getControlBounds(controlId as ValidControlId);

  if (typeof value !== "number" || !isFinite(value)) {
    return {
      valid: false,
      error: `Invalid value for ${controlId}: must be a finite number`,
      code: "VALUE_OUT_OF_BOUNDS",
    };
  }

  if (value < bounds.min || value > bounds.max) {
    return {
      valid: false,
      error: `Value ${value} out of bounds for ${controlId}. Expected ${bounds.min} to ${bounds.max}`,
      code: "VALUE_OUT_OF_BOUNDS",
    };
  }

  return { valid: true };
}

/**
 * Validate a seek position is within track duration.
 */
export function validateSeekPosition(
  positionSec: number,
  deck: DeckState
): ValidationResult {
  if (typeof positionSec !== "number" || !isFinite(positionSec)) {
    return {
      valid: false,
      error: "Seek position must be a finite number",
      code: "INVALID_SEEK_POSITION",
    };
  }

  if (positionSec < 0) {
    return {
      valid: false,
      error: `Seek position cannot be negative: ${positionSec}`,
      code: "INVALID_SEEK_POSITION",
    };
  }

  if (deck.durationSec !== null && positionSec > deck.durationSec) {
    return {
      valid: false,
      error: `Seek position ${positionSec}s exceeds track duration ${deck.durationSec}s`,
      code: "INVALID_SEEK_POSITION",
    };
  }

  return { valid: true };
}

/**
 * Validate a cue point position.
 */
export function validateCuePosition(
  cuePointSec: number,
  deck: DeckState
): ValidationResult {
  if (typeof cuePointSec !== "number" || !isFinite(cuePointSec)) {
    return {
      valid: false,
      error: "Cue point must be a finite number",
      code: "INVALID_SEEK_POSITION",
    };
  }

  if (cuePointSec < 0) {
    return {
      valid: false,
      error: `Cue point cannot be negative: ${cuePointSec}`,
      code: "INVALID_SEEK_POSITION",
    };
  }

  if (deck.durationSec !== null && cuePointSec > deck.durationSec) {
    return {
      valid: false,
      error: `Cue point ${cuePointSec}s exceeds track duration ${deck.durationSec}s`,
      code: "INVALID_SEEK_POSITION",
    };
  }

  return { valid: true };
}

/**
 * Validate a queue index for insertion or reorder.
 */
export function validateQueueIndex(
  index: number,
  room: RoomState,
  allowEnd: boolean = true
): ValidationResult {
  if (typeof index !== "number" || !Number.isInteger(index)) {
    return {
      valid: false,
      error: "Queue index must be an integer",
      code: "INVALID_QUEUE_INDEX",
    };
  }

  if (index < 0) {
    return {
      valid: false,
      error: `Queue index cannot be negative: ${index}`,
      code: "INVALID_QUEUE_INDEX",
    };
  }

  const maxIndex = allowEnd ? room.queue.length : room.queue.length - 1;
  if (index > maxIndex) {
    return {
      valid: false,
      error: `Queue index ${index} out of bounds. Max: ${maxIndex}`,
      code: "INVALID_QUEUE_INDEX",
    };
  }

  return { valid: true };
}

/**
 * Validate cursor position is within reasonable bounds.
 * Cursor coordinates should be relative percentages (0-1) or pixel values.
 */
export function validateCursorPosition(x: number, y: number): ValidationResult {
  // Allow reasonable pixel coordinates (up to 10000x10000) or percentages (0-1)
  const MAX_COORD = 10000;

  if (typeof x !== "number" || !isFinite(x)) {
    return {
      valid: false,
      error: "Cursor X must be a finite number",
      code: "INVALID_CURSOR_POSITION",
    };
  }

  if (typeof y !== "number" || !isFinite(y)) {
    return {
      valid: false,
      error: "Cursor Y must be a finite number",
      code: "INVALID_CURSOR_POSITION",
    };
  }

  if (x < 0 || x > MAX_COORD) {
    return {
      valid: false,
      error: `Cursor X ${x} out of reasonable bounds (0-${MAX_COORD})`,
      code: "INVALID_CURSOR_POSITION",
    };
  }

  if (y < 0 || y > MAX_COORD) {
    return {
      valid: false,
      error: `Cursor Y ${y} out of reasonable bounds (0-${MAX_COORD})`,
      code: "INVALID_CURSOR_POSITION",
    };
  }

  return { valid: true };
}

// ============================================================================
// Permission Checks
// ============================================================================

/**
 * Check if a client is the host of a room.
 */
export function isHost(room: RoomState, clientId: string): boolean {
  return room.hostId === clientId;
}

/**
 * Validate that a client has permission to perform a host-only action.
 */
export function validateHostPermission(
  room: RoomState,
  clientId: string,
  action: string
): ValidationResult {
  if (!HOST_ONLY_ACTIONS.has(action)) {
    // Action doesn't require host permission
    return { valid: true };
  }

  if (!isHost(room, clientId)) {
    return {
      valid: false,
      error: `Action ${action} requires host permission`,
      code: "NOT_HOST",
    };
  }

  return { valid: true };
}

/**
 * Check if a client is a member of a room.
 */
export function isMemberOfRoom(room: RoomState, clientId: string): boolean {
  return room.members.some((m) => m.clientId === clientId);
}

// ============================================================================
// Client/Room Validation
// ============================================================================

/**
 * Validate that a client is in the claimed room.
 * Uses the room store to verify the socket's actual room membership.
 */
export function validateClientInRoom(
  socketId: string,
  claimedRoomId: string,
  claimedClientId: string
): ValidationResult {
  const client = roomStore.getClient(socketId);

  if (!client) {
    return {
      valid: false,
      error: "Client not registered",
      code: "NOT_IN_ROOM",
    };
  }

  if (!client.roomId) {
    return {
      valid: false,
      error: "Client is not in any room",
      code: "NOT_IN_ROOM",
    };
  }

  if (client.roomId !== claimedRoomId) {
    return {
      valid: false,
      error: `Client claims room ${claimedRoomId} but is in ${client.roomId}`,
      code: "ROOM_MISMATCH",
    };
  }

  if (client.clientId !== claimedClientId) {
    return {
      valid: false,
      error: `Client ID mismatch: claimed ${claimedClientId}, actual ${client.clientId}`,
      code: "CLIENT_MISMATCH",
    };
  }

  return { valid: true };
}

/**
 * Get room and validate it exists.
 */
export function validateRoomExists(
  roomId: string
): { valid: true; room: RoomState } | ValidationError {
  const room = roomStore.getRoom(roomId);

  if (!room) {
    return {
      valid: false,
      error: `Room not found: ${roomId}`,
      code: "ROOM_NOT_FOUND",
    };
  }

  return { valid: true, room };
}

/**
 * Get deck from room and validate it exists.
 */
export function validateDeckExists(
  room: RoomState,
  deckId: DeckId
): { valid: true; deck: DeckState } | ValidationError {
  const deck = deckId === "A" ? room.deckA : room.deckB;

  if (!deck) {
    return {
      valid: false,
      error: `Invalid deck ID: ${deckId}`,
      code: "DECK_NOT_FOUND",
    };
  }

  return { valid: true, deck };
}

/**
 * Validate a queue item exists in the room.
 */
export function validateQueueItemExists(
  room: RoomState,
  queueItemId: string
): ValidationResult {
  const exists = room.queue.some((item) => item.id === queueItemId);

  if (!exists) {
    return {
      valid: false,
      error: `Queue item not found: ${queueItemId}`,
      code: "QUEUE_ITEM_NOT_FOUND",
    };
  }

  return { valid: true };
}

// ============================================================================
// Combined Validation Helpers
// ============================================================================

/**
 * Perform full client validation for an event.
 * Checks client registration, room membership, and optionally host permission.
 */
export function validateEventClient(
  socketId: string,
  claimedRoomId: string,
  claimedClientId: string,
  action?: string
):
  | { valid: true; room: RoomState }
  | ValidationError {
  // Validate client is in the claimed room
  const clientResult = validateClientInRoom(socketId, claimedRoomId, claimedClientId);
  if (!clientResult.valid) {
    return clientResult;
  }

  // Get and validate room exists
  const roomResult = validateRoomExists(claimedRoomId);
  if (!roomResult.valid) {
    return roomResult;
  }

  // Check host permission if action is specified
  if (action) {
    const permResult = validateHostPermission(roomResult.room, claimedClientId, action);
    if (!permResult.valid) {
      return permResult;
    }
  }

  return { valid: true, room: roomResult.room };
}

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Log a rate limit violation.
 */
export function logRateLimitViolation(
  eventType: string,
  clientId: string,
  roomId: string,
  error: string
): void {
  console.warn(
    `[RATE_LIMIT] ${eventType} clientId=${clientId} roomId=${roomId} error="${error}"`
  );
}

/**
 * Log a validation failure.
 */
export function logValidationFailure(
  eventType: string,
  socketId: string,
  error: string,
  code: ValidationErrorCode
): void {
  console.log(
    `[VALIDATION] ${eventType} socket=${socketId} code=${code} error="${error}"`
  );
}

/**
 * Log a permission denial.
 */
export function logPermissionDenied(
  action: string,
  clientId: string,
  roomId: string
): void {
  console.warn(
    `[PERMISSION] denied action=${action} clientId=${clientId} roomId=${roomId}`
  );
}
