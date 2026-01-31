/**
 * Audio parameter utilities for smooth, glitch-free updates.
 * 
 * Uses AudioParam.setTargetAtTime for smooth transitions
 * instead of direct value assignment to avoid clicks/pops.
 */

import { getAudioContext } from "./engine";

/** Default time constant for smooth transitions (in seconds) */
const DEFAULT_TIME_CONSTANT = 0.02; // 20ms - responsive but smooth

/** Faster time constant for more immediate response */
const FAST_TIME_CONSTANT = 0.005; // 5ms

/**
 * Smoothly set an AudioParam value.
 * Uses exponential approach to avoid clicks.
 */
export function setParamSmooth(
  param: AudioParam,
  value: number,
  timeConstant: number = DEFAULT_TIME_CONSTANT
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Cancel any scheduled changes
  param.cancelScheduledValues(ctx.currentTime);
  
  // Smoothly transition to new value
  param.setTargetAtTime(value, ctx.currentTime, timeConstant);
}

/**
 * Set param with fast response (for real-time controls).
 */
export function setParamFast(param: AudioParam, value: number): void {
  setParamSmooth(param, value, FAST_TIME_CONSTANT);
}

/**
 * Immediately set param (may cause clicks - use sparingly).
 */
export function setParamImmediate(param: AudioParam, value: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  param.cancelScheduledValues(ctx.currentTime);
  param.setValueAtTime(value, ctx.currentTime);
}

/**
 * Ramp param linearly over time.
 */
export function rampParamLinear(
  param: AudioParam,
  value: number,
  durationSec: number
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  param.cancelScheduledValues(ctx.currentTime);
  param.linearRampToValueAtTime(value, ctx.currentTime + durationSec);
}

/**
 * Ramp param exponentially over time.
 * Note: value must be > 0 for exponential ramp.
 */
export function rampParamExponential(
  param: AudioParam,
  value: number,
  durationSec: number
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Exponential ramp can't reach 0, use small value instead
  const safeValue = Math.max(0.0001, value);

  param.cancelScheduledValues(ctx.currentTime);
  param.exponentialRampToValueAtTime(safeValue, ctx.currentTime + durationSec);
}

/**
 * Convert dB to linear gain.
 * 0 dB = 1.0, -6 dB ≈ 0.5, -12 dB ≈ 0.25
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain to dB.
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Equal-power crossfade calculation.
 * Returns [gainA, gainB] for crossfader position (0 = full A, 1 = full B).
 */
export function equalPowerCrossfade(position: number): [number, number] {
  // Clamp to 0-1
  const pos = Math.max(0, Math.min(1, position));
  
  // Equal power: use sine/cosine curves
  // At center (0.5), both channels are at ~0.707 (-3dB)
  const angle = pos * Math.PI / 2;
  const gainA = Math.cos(angle);
  const gainB = Math.sin(angle);
  
  return [gainA, gainB];
}

/**
 * Linear crossfade calculation.
 * Returns [gainA, gainB] for crossfader position (0 = full A, 1 = full B).
 */
export function linearCrossfade(position: number): [number, number] {
  const pos = Math.max(0, Math.min(1, position));
  return [1 - pos, pos];
}

/**
 * Clamp a value to a range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a bipolar value (-1 to 1) to a gain multiplier.
 * Used for gain knobs that boost/cut.
 * -1 = -12dB, 0 = 0dB, 1 = +12dB
 */
export function bipolarToGain(bipolar: number, maxDb: number = 12): number {
  const db = clamp(bipolar, -1, 1) * maxDb;
  return dbToLinear(db);
}
