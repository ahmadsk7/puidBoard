/**
 * Sampler Engine - plays audio samples directly to master output.
 *
 * Samples bypass the mixer chain and play directly on top of any
 * track currently playing. Uses AudioBuffer for actual audio file playback.
 */

import { getAudioContext, getMasterGain, initAudioEngine } from "./engine";

/** Sample slot identifiers */
export type SampleSlot = 0 | 1 | 2 | 3;

/** Sample configuration for each slot */
interface SampleConfig {
  name: string;
  defaultUrl: string;  // URL to default sample file
}

/** Default sample configurations for each slot */
const DEFAULT_SAMPLE_CONFIGS: Record<SampleSlot, SampleConfig> = {
  0: { name: "Kick", defaultUrl: "/assets/audio/samples/kick.wav" },
  1: { name: "Snare", defaultUrl: "/assets/audio/samples/snare.wav" },
  2: { name: "Hi-Hat", defaultUrl: "/assets/audio/samples/hihat.wav" },
  3: { name: "Clap", defaultUrl: "/assets/audio/samples/clap.wav" },
};

/** Fallback oscillator config if audio files can't be loaded */
interface FallbackConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
}

const FALLBACK_CONFIGS: Record<SampleSlot, FallbackConfig> = {
  0: { frequency: 440, duration: 0.15, type: "sine" },
  1: { frequency: 587.33, duration: 0.15, type: "square" },
  2: { frequency: 783.99, duration: 0.2, type: "triangle" },
  3: { frequency: 880, duration: 0.25, type: "sawtooth" },
};

/** Loaded AudioBuffers for each slot */
const sampleBuffers: Map<SampleSlot, AudioBuffer> = new Map();

/** Custom sample URLs (from user uploads/recordings) */
const customSampleUrls: Map<SampleSlot, string> = new Map();

/** Sample metadata (name, source, etc.) */
interface SampleMetadata {
  name: string;
  isCustom: boolean;
  url: string;
}
const sampleMetadata: Map<SampleSlot, SampleMetadata> = new Map();

/** Active source nodes for cleanup */
const activeNodes: Map<SampleSlot, AudioBufferSourceNode | OscillatorNode> = new Map();

/** Track whether defaults have been loaded */
let defaultsLoaded = false;
let loadingPromise: Promise<void> | null = null;

/** Event listeners for sample changes */
type SampleChangeListener = (slot: SampleSlot, metadata: SampleMetadata) => void;
const changeListeners: Set<SampleChangeListener> = new Set();

/**
 * Subscribe to sample changes
 */
export function onSampleChange(listener: SampleChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Notify listeners of sample change
 */
function notifySampleChange(slot: SampleSlot, metadata: SampleMetadata): void {
  changeListeners.forEach(listener => listener(slot, metadata));
}

/**
 * Load an audio buffer from a URL
 */
async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  if (!ctx) {
    await initAudioEngine();
  }

  const audioCtx = getAudioContext();
  if (!audioCtx) {
    throw new Error("AudioContext not available");
  }

  console.log(`[sampler] Loading audio from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  console.log(`[sampler] Loaded audio: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

  return audioBuffer;
}

/**
 * Load default samples for all slots
 */
export async function loadDefaultSamples(): Promise<void> {
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    console.log("[sampler] Loading default samples...");

    const slots: SampleSlot[] = [0, 1, 2, 3];

    for (const slot of slots) {
      // Skip if custom sample is loaded for this slot
      if (customSampleUrls.has(slot)) {
        console.log(`[sampler] Slot ${slot} has custom sample, skipping default`);
        continue;
      }

      const config = DEFAULT_SAMPLE_CONFIGS[slot];
      try {
        const buffer = await loadAudioBuffer(config.defaultUrl);
        sampleBuffers.set(slot, buffer);

        const metadata: SampleMetadata = {
          name: config.name,
          isCustom: false,
          url: config.defaultUrl,
        };
        sampleMetadata.set(slot, metadata);
        notifySampleChange(slot, metadata);

        console.log(`[sampler] Loaded default sample for slot ${slot}: ${config.name}`);
      } catch (error) {
        console.warn(`[sampler] Failed to load default sample for slot ${slot}, using fallback oscillator:`, error);
        // Keep using oscillator fallback
        const metadata: SampleMetadata = {
          name: `Tone ${slot + 1} (fallback)`,
          isCustom: false,
          url: "",
        };
        sampleMetadata.set(slot, metadata);
        notifySampleChange(slot, metadata);
      }
    }

    defaultsLoaded = true;
    console.log("[sampler] Default samples loaded");
  })();

  return loadingPromise;
}

/**
 * Load a custom sample from a URL into a slot
 */
export async function loadCustomSample(slot: SampleSlot, url: string, name: string): Promise<void> {
  console.log(`[sampler] Loading custom sample for slot ${slot}: ${name}`);

  try {
    const buffer = await loadAudioBuffer(url);
    sampleBuffers.set(slot, buffer);
    customSampleUrls.set(slot, url);

    const metadata: SampleMetadata = {
      name,
      isCustom: true,
      url,
    };
    sampleMetadata.set(slot, metadata);
    notifySampleChange(slot, metadata);

    console.log(`[sampler] Custom sample loaded for slot ${slot}: ${name}`);
  } catch (error) {
    console.error(`[sampler] Failed to load custom sample for slot ${slot}:`, error);
    throw error;
  }
}

/**
 * Reset a slot to its default sample
 */
export async function resetSlotToDefault(slot: SampleSlot): Promise<void> {
  console.log(`[sampler] Resetting slot ${slot} to default`);

  // Clear custom URL
  customSampleUrls.delete(slot);

  // Load default sample
  const config = DEFAULT_SAMPLE_CONFIGS[slot];
  try {
    const buffer = await loadAudioBuffer(config.defaultUrl);
    sampleBuffers.set(slot, buffer);

    const metadata: SampleMetadata = {
      name: config.name,
      isCustom: false,
      url: config.defaultUrl,
    };
    sampleMetadata.set(slot, metadata);
    notifySampleChange(slot, metadata);

    console.log(`[sampler] Reset slot ${slot} to default: ${config.name}`);
  } catch (error) {
    console.warn(`[sampler] Failed to load default sample for slot ${slot} during reset:`, error);
    sampleBuffers.delete(slot);

    const metadata: SampleMetadata = {
      name: `Tone ${slot + 1} (fallback)`,
      isCustom: false,
      url: "",
    };
    sampleMetadata.set(slot, metadata);
    notifySampleChange(slot, metadata);
  }
}

/**
 * Get metadata for a sample slot
 */
export function getSampleMetadata(slot: SampleSlot): SampleMetadata | undefined {
  return sampleMetadata.get(slot);
}

/**
 * Get all sample metadata
 */
export function getAllSampleMetadata(): Record<SampleSlot, SampleMetadata | undefined> {
  return {
    0: sampleMetadata.get(0),
    1: sampleMetadata.get(1),
    2: sampleMetadata.get(2),
    3: sampleMetadata.get(3),
  };
}

/**
 * Check if a slot has a custom sample loaded
 */
export function hasCustomSample(slot: SampleSlot): boolean {
  return customSampleUrls.has(slot);
}

/**
 * Play a sample using oscillator fallback
 */
function playOscillatorFallback(slot: SampleSlot): void {
  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();

  if (!audioCtx || !masterGain) {
    return;
  }

  const config = FALLBACK_CONFIGS[slot];

  const oscillator = audioCtx.createOscillator();
  oscillator.type = config.type;
  oscillator.frequency.setValueAtTime(config.frequency, audioCtx.currentTime);

  const envelope = audioCtx.createGain();
  envelope.gain.setValueAtTime(0, audioCtx.currentTime);
  envelope.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + 0.01);
  envelope.gain.setValueAtTime(0.6, audioCtx.currentTime + config.duration * 0.7);
  envelope.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + config.duration);

  oscillator.connect(envelope);
  envelope.connect(masterGain);

  activeNodes.set(slot, oscillator);

  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + config.duration);

  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
    activeNodes.delete(slot);
  };
}

/**
 * Play a sample at the specified slot.
 * Connects directly to master gain for global playback.
 */
export async function playSample(slot: SampleSlot): Promise<void> {
  // Ensure audio context is initialized
  const ctx = getAudioContext();
  if (!ctx) {
    await initAudioEngine();
  }

  // Load defaults if not already done
  if (!defaultsLoaded && !loadingPromise) {
    await loadDefaultSamples();
  }

  const audioCtx = getAudioContext();
  const masterGain = getMasterGain();

  if (!audioCtx || !masterGain) {
    console.warn("[sampler] Audio context not available");
    return;
  }

  // Stop any currently playing sample in this slot
  stopSample(slot);

  // Check if we have a loaded AudioBuffer for this slot
  const buffer = sampleBuffers.get(slot);

  if (buffer) {
    // Play using AudioBufferSourceNode
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    // Create gain node for volume control
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);

    source.connect(gainNode);
    gainNode.connect(masterGain);

    activeNodes.set(slot, source);

    source.start(audioCtx.currentTime);

    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      activeNodes.delete(slot);
    };
  } else {
    // Fall back to oscillator
    console.log(`[sampler] No buffer for slot ${slot}, using oscillator fallback`);
    playOscillatorFallback(slot);
  }
}

/**
 * Preview a sample (alias for playSample, but could have different behavior)
 */
export async function previewSample(slot: SampleSlot): Promise<void> {
  return playSample(slot);
}

/**
 * Stop a sample if currently playing.
 */
export function stopSample(slot: SampleSlot): void {
  const node = activeNodes.get(slot);
  if (node) {
    try {
      node.stop();
      node.disconnect();
    } catch {
      // Already stopped
    }
    activeNodes.delete(slot);
  }
}

/**
 * Stop all playing samples.
 */
export function stopAllSamples(): void {
  for (const slot of [0, 1, 2, 3] as SampleSlot[]) {
    stopSample(slot);
  }
}

/**
 * Keybind to slot mapping.
 */
export const SAMPLER_KEYBINDS: Record<string, SampleSlot> = {
  r: 0,
  t: 1,
  y: 2,
  u: 3,
};

/**
 * Slot to keybind mapping (for display).
 */
export const SLOT_KEYBINDS: Record<SampleSlot, string> = {
  0: "R",
  1: "T",
  2: "Y",
  3: "U",
};

/**
 * Colors for each sample slot.
 * All buttons use the same orange color for a unified look.
 */
export const SLOT_COLORS: Record<SampleSlot, string> = {
  0: "#FF8C3B", // orange
  1: "#FF8C3B", // orange
  2: "#FF8C3B", // orange
  3: "#FF8C3B", // orange
};

/**
 * Default sample names
 */
export const DEFAULT_SAMPLE_NAMES: Record<SampleSlot, string> = {
  0: "Kick",
  1: "Snare",
  2: "Hi-Hat",
  3: "Clap",
};
