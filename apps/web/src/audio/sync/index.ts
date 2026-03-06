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
  getRtt95,
  resetClockSync,
  subscribeToClockSync,
} from "./clock";

