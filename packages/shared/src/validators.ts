/**
 * Validation utilities for Virtual DJ Rooms protocol.
 *
 * These validators wrap zod schemas with additional logic for:
 * - Type-safe parsing with error handling
 * - Control ID validation
 * - Event bounds checking
 */

import { z } from "zod";
import {
  ClientMutationEventSchema,
  ClientEventSchema,
  ServerEventSchema,
  type ClientMutationEvent,
  type ClientEvent,
  type ServerEvent,
  type MixerSetPayload,
} from "./events.js";
import {
  RoomStateSchema,
  type RoomState,
  type DeckState,
} from "./state.js";

// ============================================================================
// Control ID Validation
// ============================================================================

/**
 * Valid control IDs for the mixer.
 * Format: "component.property" or just "property" for top-level controls.
 */
export const VALID_CONTROL_IDS = [
  // Top-level mixer controls
  "crossfader",
  "masterVolume",
  // Channel A controls
  "channelA.fader",
  "channelA.gain",
  "channelA.eq.low",
  "channelA.eq.mid",
  "channelA.eq.high",
  "channelA.filter",
  // Channel B controls
  "channelB.fader",
  "channelB.gain",
  "channelB.eq.low",
  "channelB.eq.mid",
  "channelB.eq.high",
  "channelB.filter",
  // FX controls
  "fx.wetDry",
  "fx.param",
  // Deck controls (for jog/scratch)
  "deckA.jog",
  "deckB.jog",
] as const;

export type ValidControlId = (typeof VALID_CONTROL_IDS)[number];

/** Check if a control ID is valid */
export function isValidControlId(controlId: string): controlId is ValidControlId {
  return VALID_CONTROL_IDS.includes(controlId as ValidControlId);
}

/** Get the value bounds for a control ID */
export function getControlBounds(controlId: ValidControlId): { min: number; max: number } {
  // Most controls are 0-1
  const zeroToOne = { min: 0, max: 1 };
  // Gain and EQ are -1 to 1
  const negOneToOne = { min: -1, max: 1 };

  switch (controlId) {
    case "channelA.gain":
    case "channelB.gain":
    case "channelA.eq.low":
    case "channelA.eq.mid":
    case "channelA.eq.high":
    case "channelB.eq.low":
    case "channelB.eq.mid":
    case "channelB.eq.high":
      return negOneToOne;
    default:
      return zeroToOne;
  }
}

/** Validate a control value is within bounds */
export function isValidControlValue(controlId: ValidControlId, value: number): boolean {
  const bounds = getControlBounds(controlId);
  return value >= bounds.min && value <= bounds.max;
}

// ============================================================================
// Event Validation
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Validate a client mutation event */
export function validateClientMutationEvent(
  event: unknown
): ValidationResult<ClientMutationEvent> {
  const result = ClientMutationEventSchema.safeParse(event);
  if (!result.success) {
    return {
      success: false,
      error: formatZodError(result.error),
    };
  }

  // Additional validation for MIXER_SET
  if (result.data.type === "MIXER_SET") {
    const payload = result.data.payload as MixerSetPayload;
    if (!isValidControlId(payload.controlId)) {
      return {
        success: false,
        error: `Invalid control ID: ${payload.controlId}`,
      };
    }
    if (!isValidControlValue(payload.controlId, payload.value)) {
      const bounds = getControlBounds(payload.controlId);
      return {
        success: false,
        error: `Value ${payload.value} out of bounds for ${payload.controlId} (${bounds.min} to ${bounds.max})`,
      };
    }
  }

  return { success: true, data: result.data };
}

/** Validate any client event */
export function validateClientEvent(event: unknown): ValidationResult<ClientEvent> {
  const result = ClientEventSchema.safeParse(event);
  if (!result.success) {
    return {
      success: false,
      error: formatZodError(result.error),
    };
  }
  return { success: true, data: result.data };
}

/** Validate a server event */
export function validateServerEvent(event: unknown): ValidationResult<ServerEvent> {
  const result = ServerEventSchema.safeParse(event);
  if (!result.success) {
    return {
      success: false,
      error: formatZodError(result.error),
    };
  }
  return { success: true, data: result.data };
}

/** Validate room state */
export function validateRoomState(state: unknown): ValidationResult<RoomState> {
  const result = RoomStateSchema.safeParse(state);
  if (!result.success) {
    return {
      success: false,
      error: formatZodError(result.error),
    };
  }
  return { success: true, data: result.data };
}

// ============================================================================
// Deck Validation
// ============================================================================

/** Validate a seek position is within track bounds */
export function isValidSeekPosition(deck: DeckState, positionSec: number): boolean {
  if (deck.durationSec === null) return false;
  return positionSec >= 0 && positionSec <= deck.durationSec;
}

/** Check if a deck can be played (has a track loaded) */
export function canPlayDeck(deck: DeckState): boolean {
  return deck.loadedTrackId !== null;
}

// ============================================================================
// Queue Validation
// ============================================================================

/** Check if a queue item ID exists in the room state */
export function queueItemExists(state: RoomState, queueItemId: string): boolean {
  return state.queue.some((item) => item.id === queueItemId);
}

/** Check if a reorder index is valid */
export function isValidReorderIndex(state: RoomState, index: number): boolean {
  return index >= 0 && index <= state.queue.length;
}

// ============================================================================
// Helpers
// ============================================================================

/** Format a zod error into a readable string */
function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => {
      const path = e.path.join(".");
      return path ? `${path}: ${e.message}` : e.message;
    })
    .join("; ");
}

/** Type guard for checking if an event is a continuous event */
export function isContinuousEvent(event: ClientMutationEvent): boolean {
  return event.type === "CURSOR_MOVE" || event.type === "MIXER_SET";
}

/** Type guard for checking if an event is a discrete event */
export function isDiscreteEvent(event: ClientMutationEvent): boolean {
  return !isContinuousEvent(event);
}
