/**
 * Audio Engine - manages the global AudioContext and autoplay state.
 * 
 * Web Audio requires user interaction before audio can play (autoplay policy).
 * This module provides a singleton AudioContext and tracks its state.
 */

/** Autoplay state */
export type AutoplayState = "blocked" | "allowed" | "unknown";

/** Audio engine state */
export interface AudioEngineState {
  context: AudioContext | null;
  autoplayState: AutoplayState;
  masterGain: GainNode | null;
}

/** Global audio engine state */
let engineState: AudioEngineState = {
  context: null,
  autoplayState: "unknown",
  masterGain: null,
};

/** Listeners for state changes */
type StateListener = (state: AudioEngineState) => void;
const listeners = new Set<StateListener>();

/**
 * Get the current audio engine state.
 */
export function getAudioEngineState(): AudioEngineState {
  return engineState;
}

/**
 * Subscribe to audio engine state changes.
 */
export function subscribeToAudioEngine(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify all listeners of state change.
 */
function notifyListeners(): void {
  for (const listener of listeners) {
    listener(engineState);
  }
}

/**
 * Initialize the audio engine (create AudioContext).
 * Should be called on user interaction to satisfy autoplay policy.
 */
export async function initAudioEngine(): Promise<AudioContext> {
  // Return existing context if already initialized and running
  if (engineState.context && engineState.context.state === "running") {
    return engineState.context;
  }

  // Create new AudioContext if needed
  if (!engineState.context) {
    engineState.context = new AudioContext();
    
    // Create master gain node
    engineState.masterGain = engineState.context.createGain();
    engineState.masterGain.connect(engineState.context.destination);
    engineState.masterGain.gain.value = 0.8; // Default master volume
  }

  // Resume if suspended (autoplay blocked)
  if (engineState.context.state === "suspended") {
    try {
      await engineState.context.resume();
      engineState.autoplayState = "allowed";
      console.log("[audio-engine] AudioContext resumed successfully");
    } catch (err) {
      console.error("[audio-engine] Failed to resume AudioContext:", err);
      engineState.autoplayState = "blocked";
      throw err;
    }
  } else {
    engineState.autoplayState = "allowed";
  }

  notifyListeners();
  return engineState.context;
}

/**
 * Check if autoplay is allowed (AudioContext is running).
 */
export function isAutoplayAllowed(): boolean {
  return engineState.context?.state === "running";
}

/**
 * Get the AudioContext (may be null if not initialized).
 */
export function getAudioContext(): AudioContext | null {
  return engineState.context;
}

/**
 * Get the master gain node (may be null if not initialized).
 */
export function getMasterGain(): GainNode | null {
  return engineState.masterGain;
}

/**
 * Set the master volume (0-1).
 */
export function setMasterVolume(volume: number): void {
  if (engineState.masterGain) {
    engineState.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }
}

/**
 * Suspend the audio engine (pause all audio).
 */
export async function suspendAudioEngine(): Promise<void> {
  if (engineState.context && engineState.context.state === "running") {
    await engineState.context.suspend();
    engineState.autoplayState = "blocked";
    notifyListeners();
  }
}

/**
 * Close the audio engine (cleanup).
 */
export async function closeAudioEngine(): Promise<void> {
  if (engineState.context) {
    await engineState.context.close();
    engineState.context = null;
    engineState.masterGain = null;
    engineState.autoplayState = "unknown";
    notifyListeners();
  }
}
