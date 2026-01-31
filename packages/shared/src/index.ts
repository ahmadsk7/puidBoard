/**
 * @puid-board/shared
 *
 * Shared types, schemas, and utilities for Virtual DJ Rooms.
 * This package is the single source of truth for the realtime protocol.
 */

// Placeholder exports - will be populated in PR 0.2
export const VERSION = "0.0.1";

// Constants for event throttling (guidance for implementations)
export const THROTTLE = {
  /** Cursor updates: max 30 per second */
  CURSOR_MS: 33,
  /** Continuous controls (faders, knobs): max 60 per second */
  CONTROL_MS: 16,
  /** Sync tick interval from server */
  SYNC_TICK_MS: 2000,
} as const;
