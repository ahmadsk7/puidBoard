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
  // Drift correction
  calculateDriftCorrection,
  getDeckDriftState,
  getCurrentPlaybackRate,
  resetDriftState,
  resetAllDriftState,
  resetToNormalRate,
  subscribeToDriftCorrection,
  type DriftCorrection,
  type CorrectionType,
} from "./drift";
