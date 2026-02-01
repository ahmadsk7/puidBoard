/**
 * Server Clock Synchronization
 *
 * Implements TIME_PING/TIME_PONG handshake to measure RTT and clock offset.
 * Tracks the difference between client time (Date.now()) and server time,
 * allowing us to convert server timestamps to local time accurately.
 *
 * Uses multiple ping samples for accuracy and provides functions to:
 * - Get the current estimated server time
 * - Convert server timestamps to local AudioContext time
 */

import { getAudioContext } from "../engine";

/** Number of ping samples to keep for averaging */
const SAMPLE_COUNT = 7;

/** Minimum samples before we consider the offset reliable */
// INCREASED: 5 samples provides better clock sync accuracy
const MIN_RELIABLE_SAMPLES = 5;

/** Maximum age of a sample before discarding (ms) */
const MAX_SAMPLE_AGE_MS = 60_000;

/** A single clock sync sample */
interface ClockSample {
  /** Round-trip time in ms */
  rttMs: number;
  /** Estimated server-client offset (serverTime - clientTime) in ms */
  offsetMs: number;
  /** When this sample was taken (client time) */
  takenAt: number;
}

/** Clock sync state */
interface ClockState {
  /** Recent samples, ordered by age (newest last) */
  samples: ClockSample[];
  /** Computed average offset (smoothed) */
  averageOffsetMs: number;
  /** Computed average RTT */
  averageRttMs: number;
  /** Whether we have enough samples to be reliable */
  isReliable: boolean;
}

/** Singleton clock state */
let clockState: ClockState = {
  samples: [],
  averageOffsetMs: 0,
  averageRttMs: 0,
  isReliable: false,
};

/** Listeners for clock state changes */
type ClockListener = (state: ClockState) => void;
const clockListeners = new Set<ClockListener>();

/**
 * Subscribe to clock state changes.
 */
export function subscribeToClockSync(listener: ClockListener): () => void {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

/**
 * Notify all listeners of clock state change.
 */
function notifyListeners(): void {
  for (const listener of clockListeners) {
    listener(clockState);
  }
}

/**
 * Process a TIME_PONG response from the server.
 *
 * @param t0 - Original client timestamp when TIME_PING was sent
 * @param serverTs - Server timestamp when it processed the ping
 */
export function processPong(t0: number, serverTs: number): void {
  const now = Date.now();
  const rttMs = now - t0;

  // Estimate that the server timestamp was taken halfway through the RTT
  // This gives us the most likely offset between clocks
  const oneWayMs = rttMs / 2;
  const estimatedClientTimeAtServer = t0 + oneWayMs;
  const offsetMs = serverTs - estimatedClientTimeAtServer;

  // Add new sample
  const sample: ClockSample = {
    rttMs,
    offsetMs,
    takenAt: now,
  };

  // Filter out old samples and add new one
  const freshSamples = clockState.samples
    .filter((s) => now - s.takenAt < MAX_SAMPLE_AGE_MS)
    .slice(-(SAMPLE_COUNT - 1)); // Keep last N-1 samples

  freshSamples.push(sample);

  // Compute weighted average (more recent samples weighted higher)
  // Also filter out outliers (RTT > 2x median)
  const sortedByRtt = [...freshSamples].sort((a, b) => a.rttMs - b.rttMs);
  const medianRtt = sortedByRtt[Math.floor(sortedByRtt.length / 2)]?.rttMs ?? rttMs;
  const validSamples = freshSamples.filter((s) => s.rttMs < medianRtt * 2);

  if (validSamples.length === 0) {
    validSamples.push(sample);
  }

  // Weighted average - prefer samples with lower RTT (more accurate)
  let totalWeight = 0;
  let weightedOffset = 0;
  let totalRtt = 0;

  for (const s of validSamples) {
    // Weight inversely proportional to RTT (lower RTT = higher weight)
    const weight = 1 / (s.rttMs + 1);
    totalWeight += weight;
    weightedOffset += s.offsetMs * weight;
    totalRtt += s.rttMs;
  }

  const averageOffsetMs = weightedOffset / totalWeight;
  const averageRttMs = totalRtt / validSamples.length;

  clockState = {
    samples: freshSamples,
    averageOffsetMs,
    averageRttMs,
    isReliable: freshSamples.length >= MIN_RELIABLE_SAMPLES,
  };

  notifyListeners();
}

/**
 * Get the current clock sync state.
 */
export function getClockState(): ClockState {
  return clockState;
}

/**
 * Check if clock sync is reliable (has enough samples).
 */
export function isClockReliable(): boolean {
  return clockState.isReliable;
}

/**
 * Get the estimated current server time.
 */
export function getServerTime(): number {
  return Date.now() + clockState.averageOffsetMs;
}

/**
 * Convert a server timestamp to client time (Date.now() basis).
 *
 * @param serverTs - Server timestamp to convert
 * @returns Equivalent client timestamp
 */
export function serverToClientTime(serverTs: number): number {
  return serverTs - clockState.averageOffsetMs;
}

/**
 * Convert a server timestamp to AudioContext time.
 *
 * This is useful for scheduling audio precisely.
 *
 * @param serverTs - Server timestamp to convert
 * @returns Equivalent AudioContext.currentTime value, or null if no context
 */
export function serverToAudioTime(serverTs: number): number | null {
  const ctx = getAudioContext();
  if (!ctx) return null;

  // Convert server time to client time (ms)
  const clientTimeMs = serverToClientTime(serverTs);

  // Calculate the offset between client time and audio context time
  // AudioContext.currentTime is in seconds since context creation
  // Date.now() is in ms since epoch
  const nowMs = Date.now();
  const audioNow = ctx.currentTime;

  // The difference between the target client time and now
  const deltaMs = clientTimeMs - nowMs;

  // Convert to audio time
  return audioNow + deltaMs / 1000;
}

/**
 * Get the current AudioContext time offset from Date.now().
 * Returns the relationship: audioTime = (Date.now() - baseTime) / 1000
 *
 * @returns Object with audioNow and dateNow for reference calculations
 */
export function getAudioTimeReference(): { audioNow: number; dateNow: number } | null {
  const ctx = getAudioContext();
  if (!ctx) return null;

  return {
    audioNow: ctx.currentTime,
    dateNow: Date.now(),
  };
}

/**
 * Calculate expected playhead position based on server state.
 *
 * @param serverStartTime - When playback started (server timestamp)
 * @param startPlayheadSec - Playhead position when playback started
 * @param playbackRate - Current playback rate (default 1.0)
 * @returns Expected current playhead in seconds
 */
export function calculateExpectedPlayhead(
  serverStartTime: number,
  startPlayheadSec: number,
  playbackRate: number = 1.0
): number {
  const serverNow = getServerTime();
  const elapsedMs = serverNow - serverStartTime;
  // FIXED: Multiply by playbackRate to account for tempo changes
  return startPlayheadSec + (elapsedMs / 1000) * playbackRate;
}

/**
 * Get the average RTT in milliseconds.
 */
export function getAverageRtt(): number {
  return clockState.averageRttMs;
}

/**
 * Reset clock sync state (useful for debugging or reconnection).
 */
export function resetClockSync(): void {
  clockState = {
    samples: [],
    averageOffsetMs: 0,
    averageRttMs: 0,
    isReliable: false,
  };
  notifyListeners();
}
