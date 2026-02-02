/**
 * Drift Detection and Correction (Simplified)
 *
 * @deprecated This module is part of the legacy SYNC_TICK (2s interval) system.
 * The new BEACON_TICK system uses DeckEngine with PLL-based smooth correction.
 *
 * This module provides utilities for measuring drift between local and server
 * playhead positions. Drift correction is DISABLED by default because:
 *
 * 1. It interferes with manual tempo changes from the tempo fader
 * 2. It creates confusion about what the "correct" tempo should be
 * 3. The SYNC_TICK broadcasts already provide periodic corrections
 *
 * When enabled, drift correction should ONLY be used for:
 * - Explicit multiplayer sync requests (sync button)
 * - Beat-grid alignment (future feature)
 *
 * The simplified architecture:
 * - User tempo (from tempo fader) is the authoritative playbackRate
 * - No separate "userBaseRate" tracking - that was confusing
 * - Drift measurement is provided for UI display purposes
 * - Actual corrections are done via snap-to-position, not rate changes
 *
 * **New System:** DeckEngine + PLL (see /audio/DeckEngine.ts, /audio/sync/pll.ts)
 */

import type { DeckId } from "@puid-board/shared";
import { calculateExpectedPlayhead, isClockReliable } from "./clock";

/** Drift thresholds in milliseconds */
const DRIFT_IGNORE_MS = 10; // Below this, don't correct
const DRIFT_SNAP_MS = 100; // Above this, snap to position

/** Correction type */
export type CorrectionType = "none" | "snap";

/** Drift measurement result */
export interface DriftMeasurement {
  /** Measured drift in milliseconds (positive = local is ahead, negative = local is behind) */
  driftMs: number;
  /** Whether drift is significant enough to warrant correction */
  isSignificant: boolean;
  /** Whether a snap correction is recommended */
  shouldSnap: boolean;
  /** Target position for snap correction */
  snapToSec?: number;
}

/** Per-deck drift state (simplified) */
interface DeckDriftState {
  /** Rolling average of drift measurements for smoothing */
  driftHistory: number[];
  /** Last snap correction timestamp (for cooldown) */
  lastSnapAt: number;
}

/** Cooldown between snap corrections (ms) */
const SNAP_COOLDOWN_MS = 1000;

/** Drift state for both decks */
const deckDriftState: Record<DeckId, DeckDriftState> = {
  A: createDefaultDriftState(),
  B: createDefaultDriftState(),
};

/** Create default drift state */
function createDefaultDriftState(): DeckDriftState {
  return {
    driftHistory: [],
    lastSnapAt: 0,
  };
}

/** Listeners for drift measurements */
type DriftListener = (deckId: DeckId, measurement: DriftMeasurement) => void;
const driftListeners = new Set<DriftListener>();

/**
 * Subscribe to drift measurement events.
 */
export function subscribeToDriftMeasurement(listener: DriftListener): () => void {
  driftListeners.add(listener);
  return () => driftListeners.delete(listener);
}

/**
 * Notify listeners of a drift measurement.
 */
function notifyListeners(deckId: DeckId, measurement: DriftMeasurement): void {
  for (const listener of driftListeners) {
    listener(deckId, measurement);
  }
}

/**
 * Measure drift between local and expected playhead.
 * This does NOT apply corrections - it just measures and reports.
 *
 * @param deckId - Which deck to check
 * @param localPlayheadSec - Current local playhead position in seconds
 * @param serverStartTime - Server timestamp when playback started
 * @param startPlayheadSec - Playhead position when playback started
 * @param playbackRate - Current playback rate
 * @param isPlaying - Whether the deck is currently playing
 * @returns Drift measurement with recommendations
 */
export function measureDrift(
  deckId: DeckId,
  localPlayheadSec: number,
  serverStartTime: number,
  startPlayheadSec: number,
  playbackRate: number,
  isPlaying: boolean
): DriftMeasurement {
  const state = deckDriftState[deckId];
  const now = Date.now();

  // Default measurement when we can't calculate drift
  const defaultMeasurement: DriftMeasurement = {
    driftMs: 0,
    isSignificant: false,
    shouldSnap: false,
  };

  // Don't measure if not playing
  if (!isPlaying) {
    return defaultMeasurement;
  }

  // Don't measure if clock sync isn't reliable
  if (!isClockReliable()) {
    return { ...defaultMeasurement, driftMs: NaN };
  }

  // Calculate expected playhead based on server time, accounting for playback rate
  const expectedPlayheadSec = calculateExpectedPlayhead(
    serverStartTime,
    startPlayheadSec,
    playbackRate
  );

  // Drift = local - expected (positive = local is ahead, negative = behind)
  const driftSec = localPlayheadSec - expectedPlayheadSec;
  const driftMs = driftSec * 1000;

  // Add to drift history for smoothing
  state.driftHistory.push(driftMs);
  if (state.driftHistory.length > 5) {
    state.driftHistory.shift();
  }

  // Calculate smoothed drift (median to reduce noise)
  const sortedDrift = [...state.driftHistory].sort((a, b) => a - b);
  const smoothedDriftMs = sortedDrift[Math.floor(sortedDrift.length / 2)] ?? driftMs;

  const absDriftMs = Math.abs(smoothedDriftMs);
  const isSignificant = absDriftMs >= DRIFT_IGNORE_MS;
  const shouldSnap = absDriftMs > DRIFT_SNAP_MS && (now - state.lastSnapAt > SNAP_COOLDOWN_MS);

  const measurement: DriftMeasurement = {
    driftMs: smoothedDriftMs,
    isSignificant,
    shouldSnap,
    snapToSec: shouldSnap ? expectedPlayheadSec : undefined,
  };

  notifyListeners(deckId, measurement);
  return measurement;
}

/**
 * Record that a snap correction was performed.
 * Updates the cooldown timer.
 */
export function recordSnapCorrection(deckId: DeckId): void {
  const state = deckDriftState[deckId];
  state.lastSnapAt = Date.now();
  state.driftHistory = []; // Reset history after snap
}

/**
 * Get current drift state for a deck.
 */
export function getDeckDriftState(deckId: DeckId): DeckDriftState {
  return { ...deckDriftState[deckId] };
}

/**
 * Reset drift state for a deck (e.g., when loading a new track).
 */
export function resetDriftState(deckId: DeckId): void {
  deckDriftState[deckId] = createDefaultDriftState();
}

/**
 * Reset drift state for all decks.
 */
export function resetAllDriftState(): void {
  deckDriftState.A = createDefaultDriftState();
  deckDriftState.B = createDefaultDriftState();
}

// ============================================================================
// DEPRECATED EXPORTS (kept for backwards compatibility, can be removed later)
// ============================================================================

/** @deprecated Drift correction is disabled. Use measureDrift() instead. */
export interface DriftCorrection {
  type: CorrectionType;
  playbackRate: number;
  snapToSec?: number;
  driftMs: number;
  applied: boolean;
  reason?: string;
}

/** @deprecated Drift correction is disabled */
export function calculateDriftCorrection(
  deckId: DeckId,
  localPlayheadSec: number,
  serverStartTime: number,
  startPlayheadSec: number,
  isPlaying: boolean
): DriftCorrection {
  const measurement = measureDrift(deckId, localPlayheadSec, serverStartTime, startPlayheadSec, 1.0, isPlaying);
  return {
    type: measurement.shouldSnap ? "snap" : "none",
    playbackRate: 1.0,
    snapToSec: measurement.snapToSec,
    driftMs: measurement.driftMs,
    applied: false,
    reason: "drift_correction_disabled",
  };
}

/** @deprecated Use measureDrift() instead */
export function subscribeToDriftCorrection(listener: (deckId: DeckId, correction: DriftCorrection) => void): () => void {
  return subscribeToDriftMeasurement((deckId, measurement) => {
    listener(deckId, {
      type: measurement.shouldSnap ? "snap" : "none",
      playbackRate: 1.0,
      snapToSec: measurement.snapToSec,
      driftMs: measurement.driftMs,
      applied: false,
      reason: "drift_correction_disabled",
    });
  });
}

/** @deprecated No longer needed */
export function getCurrentPlaybackRate(_deckId: DeckId): number {
  return 1.0;
}

/** @deprecated No longer needed */
export function resetToNormalRate(_deckId: DeckId): void {
  // No-op
}

/** @deprecated No longer needed - user tempo is the only tempo */
export function setUserBaseRate(_deckId: DeckId, _rate: number): void {
  // No-op - user tempo is now the only source of truth
}

/** @deprecated No longer needed */
export function getUserBaseRate(_deckId: DeckId): number {
  return 1.0;
}
