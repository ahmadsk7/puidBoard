/**
 * Drift Detection and Correction
 *
 * DRIFT CORRECTION DISABLED
 *
 * Drift correction was interfering with manual tempo changes.
 * When user set tempo to +8%, drift would force it back down.
 *
 * Drift correction should only be used for:
 * - Explicit multiplayer sync (sync button)
 * - Beat-grid alignment (future feature)
 *
 * It should NEVER run automatically in the background.
 *
 * Original description (when enabled):
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

/**
 * DRIFT CORRECTION DISABLED
 *
 * Set to false to completely disable automatic drift correction.
 * This prevents drift correction from interfering with user tempo changes.
 */
const DRIFT_CORRECTION_ENABLED = false;
import { calculateExpectedPlayhead, isClockReliable } from "./clock";

/** Drift thresholds in milliseconds */
const DRIFT_IGNORE_MS = 10; // Below this, don't correct
const DRIFT_SNAP_MS = 100; // Above this, snap to position

/** Playback rate bounds */
const MIN_PLAYBACK_RATE = 0.95;
const MAX_PLAYBACK_RATE = 1.05;

/** Rate adjustment amounts */
const RATE_NORMAL = 1.0;
// NOTE: RATE_CATCH_UP and RATE_SLOW_DOWN removed - drift correction now uses
// relative adjustments from userBaseRate (+/- 0.02) instead of fixed rates

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
  /** User-set base playback rate (from tempo fader) - drift correction is RELATIVE to this */
  userBaseRate: number;
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
    userBaseRate: RATE_NORMAL,
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
  // DRIFT CORRECTION DISABLED - see comments at top of file
  // This prevents drift correction from interfering with user tempo changes.
  // When enabled, drift correction would override user-set tempo values.
  if (!DRIFT_CORRECTION_ENABLED) {
    return {
      type: "none",
      playbackRate: deckDriftState[deckId].userBaseRate,
      driftMs: 0,
      applied: false,
      reason: "drift_correction_disabled",
    };
  }

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

      // If drift is now small, return to user's base rate (not necessarily 1.0)
      if (Math.abs(smoothedDriftMs) < DRIFT_IGNORE_MS) {
        state.currentRate = state.userBaseRate;
        state.isCorreecting = false;
        state.lastCorrectionAt = now;

        console.log(
          `[drift-${deckId}] Rate adjustment complete, drift resolved: ${smoothedDriftMs.toFixed(1)}ms, returning to userBaseRate=${state.userBaseRate.toFixed(3)}`
        );

        return {
          type: "rate_adjust",
          playbackRate: state.userBaseRate,
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
    // If we were correcting and now drift is small, return to user's base rate
    if (state.currentRate !== state.userBaseRate) {
      state.currentRate = state.userBaseRate;
      state.isCorreecting = false;
      return {
        type: "rate_adjust",
        playbackRate: state.userBaseRate,
        driftMs: smoothedDriftMs,
        applied: true,
      };
    }

    return {
      type: "none",
      playbackRate: state.userBaseRate,
      driftMs: smoothedDriftMs,
      applied: false,
      reason: "drift_negligible",
    };
  }

  // Large drift - snap to correct position
  if (absDriftMs > DRIFT_SNAP_MS) {
    const snapToSec = expectedPlayheadSec;
    state.lastCorrectionAt = now;
    state.currentRate = state.userBaseRate; // Return to user's base rate after snap
    state.isCorreecting = false;
    state.driftHistory = []; // Reset history after snap

    console.log(
      `[drift-${deckId}] SNAP correction: drift=${smoothedDriftMs.toFixed(1)}ms, snapping to ${snapToSec.toFixed(2)}s, userBaseRate=${state.userBaseRate.toFixed(3)}`
    );

    const correction: DriftCorrection = {
      type: "snap",
      playbackRate: state.userBaseRate,
      snapToSec,
      driftMs: smoothedDriftMs,
      applied: true,
    };

    notifyListeners(deckId, correction);
    return correction;
  }

  // Medium drift - rate adjustment
  // FIXED: Apply correction RELATIVE to user's base rate, not to 1.0
  if (absDriftMs >= DRIFT_IGNORE_MS) {
    // Determine rate direction - adjust relative to user's tempo setting
    const baseRate = state.userBaseRate;
    const rateAdjustment = smoothedDriftMs > 0 ? -0.02 : 0.02; // Slow down if ahead, speed up if behind
    const newRate = baseRate + rateAdjustment;

    // Clamp rate to bounds
    const clampedRate = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, newRate));

    state.currentRate = clampedRate;
    state.lastCorrectionAt = now;
    state.rateAdjustStartedAt = now;
    state.rateAdjustEndsAt = now + RATE_ADJUST_DURATION_MS;
    state.isCorreecting = true;

    console.log(
      `[drift-${deckId}] Rate correction: drift=${smoothedDriftMs.toFixed(1)}ms, baseRate=${baseRate.toFixed(3)}, adjustedRate=${clampedRate.toFixed(3)}`
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

/**
 * Set the user's base playback rate (from tempo fader).
 * Drift correction will be calculated relative to this rate, not 1.0.
 * This allows users to change tempo without drift correction fighting back.
 */
export function setUserBaseRate(deckId: DeckId, rate: number): void {
  const state = deckDriftState[deckId];
  const oldRate = state.userBaseRate;
  state.userBaseRate = rate;

  // When user changes tempo, reset drift correction state to prevent fighting
  state.driftHistory = [];
  state.isCorreecting = false;
  state.rateAdjustStartedAt = null;
  state.rateAdjustEndsAt = null;
  state.currentRate = rate;

  console.log(`[drift-${deckId}] User base rate updated: ${oldRate.toFixed(3)} -> ${rate.toFixed(3)}`);
}

/**
 * Get the user's base playback rate for a deck.
 */
export function getUserBaseRate(deckId: DeckId): number {
  return deckDriftState[deckId].userBaseRate;
}
