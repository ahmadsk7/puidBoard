/**
 * Mixer Graph - full audio routing for DJ mixer.
 * 
 * Signal flow:
 * Deck A → Gain → 3-band EQ → Channel Fader → Crossfader A input
 * Deck B → Gain → 3-band EQ → Channel Fader → Crossfader B input
 * Crossfader → Master Gain → Analyser → Destination
 * 
 * The mixer graph is a singleton that connects to the audio engine.
 */

import type { MixerState, ChannelState, EqState } from "@puid-board/shared";
import { getAudioContext, getMasterGain } from "./engine";
import {
  setParamSmooth,
  setParamFast,
  equalPowerCrossfade,
  bipolarToGain,
  clamp,
} from "./params";
import { initFXManager, applyFXState } from "./fx/manager";

/** EQ frequency bands */
const EQ_FREQUENCIES = {
  low: 320,    // Low shelf
  mid: 1000,   // Peaking
  high: 3200,  // High shelf
};

/** EQ Q factors */
const EQ_Q = {
  low: 0.7,
  mid: 1.0,
  high: 0.7,
};

/** Maximum EQ boost/cut in dB */
const EQ_MAX_DB = 12;

/** Channel audio nodes */
interface ChannelNodes {
  /** Input gain (trim/gain knob) */
  inputGain: GainNode;
  /** Low EQ (shelf filter) */
  eqLow: BiquadFilterNode;
  /** Mid EQ (peaking filter) */
  eqMid: BiquadFilterNode;
  /** High EQ (shelf filter) */
  eqHigh: BiquadFilterNode;
  /** Channel fader */
  fader: GainNode;
  /** Output to crossfader */
  output: GainNode;
}

/** Mixer graph state */
interface MixerGraphState {
  /** Channel A nodes */
  channelA: ChannelNodes | null;
  /** Channel B nodes */
  channelB: ChannelNodes | null;
  /** Crossfader gain for channel A */
  crossfaderA: GainNode | null;
  /** Crossfader gain for channel B */
  crossfaderB: GainNode | null;
  /** Pre-master summing node */
  preMaster: GainNode | null;
  /** Analyser for metering */
  analyser: AnalyserNode | null;
  /** Is initialized */
  initialized: boolean;
}

/** Singleton mixer graph state */
let mixerGraph: MixerGraphState = {
  channelA: null,
  channelB: null,
  crossfaderA: null,
  crossfaderB: null,
  preMaster: null,
  analyser: null,
  initialized: false,
};

/** Clipping state */
interface ClippingState {
  isClipping: boolean;
  peakLevel: number;
}

let clippingState: ClippingState = {
  isClipping: false,
  peakLevel: 0,
};

/** Clipping listeners */
type ClippingListener = (state: ClippingState) => void;
const clippingListeners = new Set<ClippingListener>();

/**
 * Create a channel's audio nodes.
 */
function createChannelNodes(ctx: AudioContext): ChannelNodes {
  // Input gain (trim)
  const inputGain = ctx.createGain();
  inputGain.gain.value = 1.0;

  // 3-band EQ
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = EQ_FREQUENCIES.low;
  eqLow.gain.value = 0;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = EQ_FREQUENCIES.mid;
  eqMid.Q.value = EQ_Q.mid;
  eqMid.gain.value = 0;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = EQ_FREQUENCIES.high;
  eqHigh.gain.value = 0;

  // Channel fader
  const fader = ctx.createGain();
  fader.gain.value = 1.0;

  // Output
  const output = ctx.createGain();
  output.gain.value = 1.0;

  // Connect chain: inputGain → eqLow → eqMid → eqHigh → fader → output
  inputGain.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(fader);
  fader.connect(output);

  return { inputGain, eqLow, eqMid, eqHigh, fader, output };
}

/**
 * Initialize the mixer graph.
 * Call after AudioContext is created.
 */
export function initMixerGraph(): boolean {
  const ctx = getAudioContext();
  const masterGain = getMasterGain();

  if (!ctx || !masterGain) {
    console.warn("[mixer-graph] Cannot init: no AudioContext");
    return false;
  }

  if (mixerGraph.initialized) {
    return true;
  }

  console.log("[mixer-graph] Initializing...");

  // Create channels
  mixerGraph.channelA = createChannelNodes(ctx);
  mixerGraph.channelB = createChannelNodes(ctx);

  // Create crossfader gains - initialize at center position (0.5)
  // This matches the default state in state.ts: crossfader: 0.5
  // Using equal power crossfade: at 0.5, both channels are at ~0.707 (-3dB)
  const [initialGainA, initialGainB] = equalPowerCrossfade(0.5);

  mixerGraph.crossfaderA = ctx.createGain();
  mixerGraph.crossfaderA.gain.value = initialGainA;

  mixerGraph.crossfaderB = ctx.createGain();
  mixerGraph.crossfaderB.gain.value = initialGainB;

  // Create pre-master summing node
  mixerGraph.preMaster = ctx.createGain();
  mixerGraph.preMaster.gain.value = 1.0;

  // Create analyser for metering
  mixerGraph.analyser = ctx.createAnalyser();
  mixerGraph.analyser.fftSize = 256;
  mixerGraph.analyser.smoothingTimeConstant = 0.3;

  // Connect channels → crossfader gains → pre-master
  mixerGraph.channelA.output.connect(mixerGraph.crossfaderA);
  mixerGraph.channelB.output.connect(mixerGraph.crossfaderB);

  mixerGraph.crossfaderA.connect(mixerGraph.preMaster);
  mixerGraph.crossfaderB.connect(mixerGraph.preMaster);

  // Initialize FX manager and insert into signal path
  const fxNodes = initFXManager();
  
  if (fxNodes) {
    const [fxInput, fxOutput] = fxNodes;
    // Connect: pre-master → FX input → FX output → analyser → master
    mixerGraph.preMaster.connect(fxInput);
    fxOutput.connect(mixerGraph.analyser);
  } else {
    // No FX available, bypass directly
    mixerGraph.preMaster.connect(mixerGraph.analyser);
  }
  
  mixerGraph.analyser.connect(masterGain);

  mixerGraph.initialized = true;
  console.log("[mixer-graph] Initialized successfully (with FX)");

  // Start clipping detection
  startClippingDetection();

  return true;
}

/**
 * Get the input node for a deck to connect to.
 */
export function getDeckInput(deckId: "A" | "B"): GainNode | null {
  if (!mixerGraph.initialized) {
    initMixerGraph();
  }

  const channel = deckId === "A" ? mixerGraph.channelA : mixerGraph.channelB;
  return channel?.inputGain ?? null;
}

/**
 * Update channel EQ from state.
 */
function updateChannelEQ(channel: ChannelNodes, eq: EqState): void {
  // EQ values are -1 to 1, map to -12dB to +12dB
  const lowDb = clamp(eq.low, -1, 1) * EQ_MAX_DB;
  const midDb = clamp(eq.mid, -1, 1) * EQ_MAX_DB;
  const highDb = clamp(eq.high, -1, 1) * EQ_MAX_DB;

  setParamSmooth(channel.eqLow.gain, lowDb);
  setParamSmooth(channel.eqMid.gain, midDb);
  setParamSmooth(channel.eqHigh.gain, highDb);
}

/**
 * Update a channel from state.
 */
function updateChannel(channel: ChannelNodes, state: ChannelState): void {
  // Gain knob (-1 to 1 bipolar, maps to -12dB to +12dB)
  const gainMultiplier = bipolarToGain(state.gain, 12);
  setParamSmooth(channel.inputGain.gain, gainMultiplier);

  // Channel fader (0 to 1)
  setParamFast(channel.fader.gain, clamp(state.fader, 0, 1));

  // EQ
  updateChannelEQ(channel, state.eq);
}

/**
 * Update crossfader position.
 */
function updateCrossfader(position: number): void {
  if (!mixerGraph.crossfaderA || !mixerGraph.crossfaderB) {
    return;
  }

  const [gainA, gainB] = equalPowerCrossfade(position);
  
  setParamFast(mixerGraph.crossfaderA.gain, gainA);
  setParamFast(mixerGraph.crossfaderB.gain, gainB);
}

/**
 * Update master volume.
 */
function updateMasterVolume(volume: number): void {
  const masterGain = getMasterGain();
  if (masterGain) {
    setParamSmooth(masterGain.gain, clamp(volume, 0, 1));
  }
}

/**
 * Apply full mixer state to audio graph.
 */
export function applyMixerState(mixer: MixerState): void {
  if (!mixerGraph.initialized) {
    if (!initMixerGraph()) {
      return;
    }
  }

  // Update channels
  if (mixerGraph.channelA) {
    updateChannel(mixerGraph.channelA, mixer.channelA);
  }
  if (mixerGraph.channelB) {
    updateChannel(mixerGraph.channelB, mixer.channelB);
  }

  // Update crossfader
  updateCrossfader(mixer.crossfader);

  // Update master volume
  updateMasterVolume(mixer.masterVolume);

  // Update FX
  applyFXState(mixer.fx);
}

/**
 * Update a single mixer parameter.
 * controlId format: "channelA.gain", "channelB.eq.low", "crossfader", "masterVolume", "fx.wetDry", "fx.param"
 */
export function updateMixerParam(controlId: string, value: number): void {
  if (!mixerGraph.initialized) {
    return;
  }

  const parts = controlId.split(".");

  if (controlId === "crossfader") {
    updateCrossfader(value);
    return;
  }

  if (controlId === "masterVolume") {
    updateMasterVolume(value);
    return;
  }

  // Handle FX controls
  if (parts[0] === "fx") {
    const { setFXWetDry, setFXParam } = require("./fx/manager");
    if (parts[1] === "wetDry") {
      setFXWetDry(value);
    } else if (parts[1] === "param") {
      setFXParam(value);
    }
    return;
  }

  const channelId = parts[0];
  const channel = channelId === "channelA" ? mixerGraph.channelA : mixerGraph.channelB;
  
  if (!channel) return;

  const param = parts[1];

  if (param === "gain") {
    const gainMultiplier = bipolarToGain(value, 12);
    setParamSmooth(channel.inputGain.gain, gainMultiplier);
  } else if (param === "fader") {
    setParamFast(channel.fader.gain, clamp(value, 0, 1));
  } else if (param === "eq" && parts[2]) {
    const band = parts[2];
    const db = clamp(value, -1, 1) * EQ_MAX_DB;
    
    if (band === "low") {
      setParamSmooth(channel.eqLow.gain, db);
    } else if (band === "mid") {
      setParamSmooth(channel.eqMid.gain, db);
    } else if (band === "high") {
      setParamSmooth(channel.eqHigh.gain, db);
    }
  }
}

/**
 * Start clipping detection loop.
 */
let clippingDetectionId: number | null = null;

function startClippingDetection(): void {
  if (clippingDetectionId !== null) return;

  const detect = () => {
    if (!mixerGraph.analyser) {
      clippingDetectionId = null;
      return;
    }

    const dataArray = new Float32Array(mixerGraph.analyser.fftSize);
    mixerGraph.analyser.getFloatTimeDomainData(dataArray);

    // Find peak level
    let peak = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const abs = Math.abs(dataArray[i]!);
      if (abs > peak) peak = abs;
    }

    const wasClipping = clippingState.isClipping;
    clippingState.peakLevel = peak;
    clippingState.isClipping = peak > 0.99;

    // Notify if changed
    if (clippingState.isClipping !== wasClipping) {
      for (const listener of clippingListeners) {
        listener(clippingState);
      }
    }

    clippingDetectionId = requestAnimationFrame(detect);
  };

  clippingDetectionId = requestAnimationFrame(detect);
}

/**
 * Stop clipping detection.
 */
function stopClippingDetection(): void {
  if (clippingDetectionId !== null) {
    cancelAnimationFrame(clippingDetectionId);
    clippingDetectionId = null;
  }
}

/**
 * Subscribe to clipping state changes.
 */
export function subscribeToClipping(listener: ClippingListener): () => void {
  clippingListeners.add(listener);
  // Immediately notify of current state
  listener(clippingState);
  return () => clippingListeners.delete(listener);
}

/**
 * Get current clipping state.
 */
export function getClippingState(): ClippingState {
  return { ...clippingState };
}

/**
 * Get peak level (0-1+).
 */
export function getPeakLevel(): number {
  return clippingState.peakLevel;
}

/**
 * Check if mixer graph is initialized.
 */
export function isMixerGraphInitialized(): boolean {
  return mixerGraph.initialized;
}

/**
 * Dispose mixer graph (cleanup).
 */
export function disposeMixerGraph(): void {
  stopClippingDetection();

  if (mixerGraph.channelA) {
    mixerGraph.channelA.inputGain.disconnect();
    mixerGraph.channelA = null;
  }
  if (mixerGraph.channelB) {
    mixerGraph.channelB.inputGain.disconnect();
    mixerGraph.channelB = null;
  }
  if (mixerGraph.crossfaderA) {
    mixerGraph.crossfaderA.disconnect();
    mixerGraph.crossfaderA = null;
  }
  if (mixerGraph.crossfaderB) {
    mixerGraph.crossfaderB.disconnect();
    mixerGraph.crossfaderB = null;
  }
  if (mixerGraph.preMaster) {
    mixerGraph.preMaster.disconnect();
    mixerGraph.preMaster = null;
  }
  if (mixerGraph.analyser) {
    mixerGraph.analyser.disconnect();
    mixerGraph.analyser = null;
  }

  mixerGraph.initialized = false;
  clippingListeners.clear();
  
  console.log("[mixer-graph] Disposed");
}
