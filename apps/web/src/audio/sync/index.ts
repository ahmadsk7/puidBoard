/**
 * Audio Synchronization Module
 *
 * Provides clock synchronization and drift correction for multi-user audio playback.
 */

export {
  // Clock sync
  processPong,
  getClockState,
  isClockReliable,
  getServerTime,
  serverToClientTime,
  serverToAudioTime,
  getAudioTimeReference,
  calculateExpectedPlayhead,
  getAverageRtt,
  resetClockSync,
  subscribeToClockSync,
} from "./clock";

export {
  // Drift measurement (simplified API)
  measureDrift,
  recordSnapCorrection,
  getDeckDriftState,
  resetDriftState,
  resetAllDriftState,
  subscribeToDriftMeasurement,
  type DriftMeasurement,
  type CorrectionType,
  // Deprecated exports for backwards compatibility
  calculateDriftCorrection,
  getCurrentPlaybackRate,
  resetToNormalRate,
  subscribeToDriftCorrection,
  type DriftCorrection,
} from "./drift";
