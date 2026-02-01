/**
 * Drift Detection and Correction
 *
 * Monitors the difference between local audio playhead and expected position
 * based on server time, and applies corrections to keep playback synchronized.
 *
 * Correction strategies:
 * - Small drift (<40ms): Adjust playbackRate slightly (1.01x or 0.99x) to catch up/slow down
 * - Large drift (>100ms): Snap to correct position (with optional crossfade)
 *
 * Guardrails:
 * - playbackRate bounds: 0.95 to 1.05
 * - Cooldown periods to prevent oscillation
 * - Only correct when playing
 */

import type { DeckId } from "@puid-board/shared";
import { calculateExpectedPlayhead, isClockReliable } from "./clock";

/** Drift thresholds in milliseconds */
const DRIFT_IGNORE_MS = 10; // Below this, don't correct
const DRIFT_SNAP_MS = 100; // Above this, snap to position

/** Playback rate bounds */
const MIN_PLAYBACK_RATE = 0.95;
const MAX_PLAYBACK_RATE = 1.05;

/** Rate adjustment amounts */
const RATE_CATCH_UP = 1.02; // Speed up when behind
const RATE_SLOW_DOWN = 0.98; // Slow down when ahead
const RATE_NORMAL = 1.0;

/** Cooldown between corrections (ms) */
const CORRECTION_COOLDOWN_MS = 500;

/** How long a rate adjustment should last (ms) */
const RATE_ADJUST_DURATION_MS = 1000;

/** Correction type */
export type CorrectionType = "none" | "rate_adjust" | "snap";

/** Drift correction result */
export interface DriftCorrection {
  /** Type of correction to apply */
  type: CorrectionType;
  /** New playback rate (1.0 = normal) */
  playbackRate: number;
  /** If snapping, the target position in seconds */
  snapToSec?: number;
  /** Measured drift in milliseconds (positive = local is ahead, negative = local is behind) */
  driftMs: number;
  /** Whether correction was applied or skipped (cooldown, etc.) */
  applied: boolean;
  /** Reason if not applied */
  reason?: string;
}

/** Per-deck drift correction state */
interface DeckDriftState {
  /** Last correction timestamp */
  lastCorrectionAt: number;
  /** Current playback rate being applied */
  currentRate: number;
  /** When the current rate adjustment started */
  rateAdjustStartedAt: number | null;
  /** When the rate adjustment should end */
  rateAdjustEndsAt: number | null;
  /** Rolling average of drift measurements */
  driftHistory: number[];
  /** Is currently in a correction phase */
  isCorreecting: boolean;
}

/** Drift state for both decks */
const deckDriftState: Record<DeckId, DeckDriftState> = {
  A: createDefaultDriftState(),
  B: createDefaultDriftState(),
};

/** Create default drift state */
function createDefaultDriftState(): DeckDriftState {
  return {
    lastCorrectionAt: 0,
    currentRate: RATE_NORMAL,
    rateAdjustStartedAt: null,
    rateAdjustEndsAt: null,
    driftHistory: [],
    isCorreecting: false,
  };
}

/** Listeners for drift corrections */
type DriftListener = (deckId: DeckId, correction: DriftCorrection) => void;
const driftListeners = new Set<DriftListener>();

/**
 * Subscribe to drift correction events.
 */
export function subscribeToDriftCorrection(listener: DriftListener): () => void {
  driftListeners.add(listener);
  return () => driftListeners.delete(listener);
}

/**
 * Notify listeners of a drift correction.
 */
function notifyListeners(deckId: DeckId, correction: DriftCorrection): void {
  for (const listener of driftListeners) {
    listener(deckId, correction);
  }
}

/**
 * Calculate drift and determine correction action.
 *
 * @param deckId - Which deck to check
 * @param localPlayheadSec - Current local playhead position in seconds
 * @param serverStartTime - Server timestamp when playback started
 * @param startPlayheadSec - Playhead position when playback started
 * @param isPlaying - Whether the deck is currently playing
 * @returns Drift correction recommendation
 */
export function calculateDriftCorrection(
  deckId: DeckId,
  localPlayheadSec: number,
  serverStartTime: number,
  startPlayheadSec: number,
  isPlaying: boolean
): DriftCorrection {
  const state = deckDriftState[deckId];
  const now = Date.now();

  // Don't correct if not playing
  if (!isPlaying) {
    return {
      type: "none",
      playbackRate: RATE_NORMAL,
      driftMs: 0,
      applied: false,
      reason: "not_playing",
    };
  }

  // Don't correct if clock sync isn't reliable
  if (!isClockReliable()) {
    return {
      type: "none",
      playbackRate: state.currentRate,
      driftMs: 0,
      applied: false,
      reason: "clock_not_reliable",
    };
  }

  // Calculate expected playhead based on server time
  const expectedPlayheadSec = calculateExpectedPlayhead(serverStartTime, startPlayheadSec);

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

  // Check if we're in an active rate adjustment
  if (state.rateAdjustEndsAt !== null) {
    if (now < state.rateAdjustEndsAt) {
      // Still in rate adjustment phase, continue with current rate
      return {
        type: "rate_adjust",
        playbackRate: state.currentRate,
        driftMs: smoothedDriftMs,
        applied: false,
        reason: "rate_adjust_in_progress",
      };
    } else {
      // Rate adjustment period ended, check if drift is resolved
      state.rateAdjustEndsAt = null;
      state.rateAdjustStartedAt = null;

      // If drift is now small, reset to normal rate
      if (Math.abs(smoothedDriftMs) < DRIFT_IGNORE_MS) {
        state.currentRate = RATE_NORMAL;
        state.isCorreecting = false;
        state.lastCorrectionAt = now;

        console.log(
          `[drift-${deckId}] Rate adjustment complete, drift resolved: ${smoothedDriftMs.toFixed(1)}ms`
        );

        return {
          type: "rate_adjust",
          playbackRate: RATE_NORMAL,
          driftMs: smoothedDriftMs,
          applied: true,
        };
      }
      // Otherwise, fall through to start a new correction
    }
  }

  // Check cooldown
  if (now - state.lastCorrectionAt < CORRECTION_COOLDOWN_MS) {
    return {
      type: "none",
      playbackRate: state.currentRate,
      driftMs: smoothedDriftMs,
      applied: false,
      reason: "cooldown",
    };
  }

  const absDriftMs = Math.abs(smoothedDriftMs);

  // Ignore very small drifts
  if (absDriftMs < DRIFT_IGNORE_MS) {
    // If we were correcting and now drift is small, reset to normal
    if (state.currentRate !== RATE_NORMAL) {
      state.currentRate = RATE_NORMAL;
      state.isCorreecting = false;
      return {
        type: "rate_adjust",
        playbackRate: RATE_NORMAL,
        driftMs: smoothedDriftMs,
        applied: true,
      };
    }

    return {
      type: "none",
      playbackRate: RATE_NORMAL,
      driftMs: smoothedDriftMs,
      applied: false,
      reason: "drift_negligible",
    };
  }

  // Large drift - snap to correct position
  if (absDriftMs > DRIFT_SNAP_MS) {
    const snapToSec = expectedPlayheadSec;
    state.lastCorrectionAt = now;
    state.currentRate = RATE_NORMAL;
    state.isCorreecting = false;
    state.driftHistory = []; // Reset history after snap

    console.log(
      `[drift-${deckId}] SNAP correction: drift=${smoothedDriftMs.toFixed(1)}ms, snapping to ${snapToSec.toFixed(2)}s`
    );

    const correction: DriftCorrection = {
      type: "snap",
      playbackRate: RATE_NORMAL,
      snapToSec,
      driftMs: smoothedDriftMs,
      applied: true,
    };

    notifyListeners(deckId, correction);
    return correction;
  }

  // Medium drift - rate adjustment
  if (absDriftMs >= DRIFT_IGNORE_MS) {
    // Determine rate direction
    const newRate = smoothedDriftMs > 0 ? RATE_SLOW_DOWN : RATE_CATCH_UP;

    // Clamp rate to bounds
    const clampedRate = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, newRate));

    state.currentRate = clampedRate;
    state.lastCorrectionAt = now;
    state.rateAdjustStartedAt = now;
    state.rateAdjustEndsAt = now + RATE_ADJUST_DURATION_MS;
    state.isCorreecting = true;

    console.log(
      `[drift-${deckId}] Rate correction: drift=${smoothedDriftMs.toFixed(1)}ms, rate=${clampedRate.toFixed(3)}`
    );

    const correction: DriftCorrection = {
      type: "rate_adjust",
      playbackRate: clampedRate,
      driftMs: smoothedDriftMs,
      applied: true,
    };

    notifyListeners(deckId, correction);
    return correction;
  }

  return {
    type: "none",
    playbackRate: state.currentRate,
    driftMs: smoothedDriftMs,
    applied: false,
    reason: "no_correction_needed",
  };
}

/**
 * Get current drift state for a deck.
 */
export function getDeckDriftState(deckId: DeckId): DeckDriftState {
  return { ...deckDriftState[deckId] };
}

/**
 * Get the current playback rate for a deck.
 */
export function getCurrentPlaybackRate(deckId: DeckId): number {
  return deckDriftState[deckId].currentRate;
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

/**
 * Force reset to normal playback rate for a deck.
 */
export function resetToNormalRate(deckId: DeckId): void {
  const state = deckDriftState[deckId];
  state.currentRate = RATE_NORMAL;
  state.rateAdjustStartedAt = null;
  state.rateAdjustEndsAt = null;
  state.isCorreecting = false;
}
