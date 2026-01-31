/**
 * FX Manager - handles FX processor lifecycle and routing.
 * 
 * Manages creating, switching, and disposing of FX processors.
 */

import type { FxType, FxState } from "@puid-board/shared";
import type { FXProcessor, FXParamInfo } from "./types";
import { EchoFX } from "./echo";
import { ReverbFX } from "./reverb";
import { FilterFX } from "./filter";
import { getAudioContext } from "../engine";

/**
 * Create an FX processor for the given type.
 */
function createFXProcessor(ctx: AudioContext, type: FxType): FXProcessor | null {
  switch (type) {
    case "echo":
      return new EchoFX(ctx);
    case "reverb":
      return new ReverbFX(ctx);
    case "filter":
      return new FilterFX(ctx);
    case "none":
      return null;
    default:
      return null;
  }
}

/**
 * FX Manager state.
 */
interface FXManagerState {
  processor: FXProcessor | null;
  currentType: FxType;
  input: GainNode | null;
  output: GainNode | null;
  bypassGain: GainNode | null;
}

/** Singleton FX manager state */
let fxManager: FXManagerState = {
  processor: null,
  currentType: "none",
  input: null,
  output: null,
  bypassGain: null,
};

/** State listeners */
type FXManagerListener = (state: { type: FxType; paramInfo: FXParamInfo | null }) => void;
const listeners = new Set<FXManagerListener>();

function notifyListeners(): void {
  const paramInfo = fxManager.processor?.getParamInfo() ?? null;
  for (const listener of listeners) {
    listener({ type: fxManager.currentType, paramInfo });
  }
}

/**
 * Initialize the FX manager.
 * Returns [input, output] nodes for routing.
 */
export function initFXManager(): [GainNode, GainNode] | null {
  const ctx = getAudioContext();
  if (!ctx) return null;

  // Already initialized
  if (fxManager.input && fxManager.output) {
    return [fxManager.input, fxManager.output];
  }

  // Create routing nodes
  fxManager.input = ctx.createGain();
  fxManager.output = ctx.createGain();
  fxManager.bypassGain = ctx.createGain();

  // Default bypass path (when no FX)
  fxManager.input.connect(fxManager.bypassGain);
  fxManager.bypassGain.connect(fxManager.output);

  console.log("[fx-manager] Initialized");

  return [fxManager.input, fxManager.output];
}

/**
 * Get the FX input node (for routing audio into FX chain).
 */
export function getFXInput(): GainNode | null {
  return fxManager.input;
}

/**
 * Get the FX output node (for routing audio out of FX chain).
 */
export function getFXOutput(): GainNode | null {
  return fxManager.output;
}

/**
 * Set the FX type (creates new processor if different).
 */
export function setFXType(type: FxType): void {
  if (type === fxManager.currentType) return;

  const ctx = getAudioContext();
  if (!ctx || !fxManager.input || !fxManager.output || !fxManager.bypassGain) {
    console.warn("[fx-manager] Not initialized");
    return;
  }

  // Dispose old processor
  if (fxManager.processor) {
    fxManager.input.disconnect(fxManager.processor.input);
    fxManager.processor.output.disconnect(fxManager.output);
    fxManager.processor.dispose();
    fxManager.processor = null;
  }

  // Reconnect bypass
  try {
    fxManager.input.disconnect(fxManager.bypassGain);
  } catch {
    // May not be connected
  }

  if (type === "none") {
    // No FX - use bypass
    fxManager.input.connect(fxManager.bypassGain);
    fxManager.bypassGain.connect(fxManager.output);
    fxManager.currentType = "none";
    console.log("[fx-manager] FX disabled (bypass)");
  } else {
    // Create new processor
    const processor = createFXProcessor(ctx, type);
    if (processor) {
      // Disconnect bypass from output
      try {
        fxManager.bypassGain.disconnect(fxManager.output);
      } catch {
        // May not be connected
      }

      // Connect through FX
      fxManager.input.connect(processor.input);
      processor.output.connect(fxManager.output);
      fxManager.processor = processor;
      fxManager.currentType = type;
      console.log(`[fx-manager] FX set to: ${type}`);
    }
  }

  notifyListeners();
}

/**
 * Apply full FX state.
 */
export function applyFXState(state: FxState): void {
  // Change type if needed
  setFXType(state.type);

  // Apply settings to processor
  if (fxManager.processor) {
    fxManager.processor.applyState(state);
  }

  notifyListeners();
}

/**
 * Set FX wet/dry.
 */
export function setFXWetDry(value: number): void {
  if (fxManager.processor) {
    fxManager.processor.setWetDry(value);
  }
}

/**
 * Set FX parameter.
 */
export function setFXParam(value: number): void {
  if (fxManager.processor) {
    fxManager.processor.setParam(value);
    notifyListeners();
  }
}

/**
 * Set FX enabled.
 */
export function setFXEnabled(enabled: boolean): void {
  if (fxManager.processor) {
    fxManager.processor.setEnabled(enabled);
  }
}

/**
 * Get current FX type.
 */
export function getCurrentFXType(): FxType {
  return fxManager.currentType;
}

/**
 * Get current FX parameter info.
 */
export function getFXParamInfo(): FXParamInfo | null {
  return fxManager.processor?.getParamInfo() ?? null;
}

/**
 * Subscribe to FX manager state changes.
 */
export function subscribeToFXManager(
  listener: FXManagerListener
): () => void {
  listeners.add(listener);
  // Immediately notify
  listener({
    type: fxManager.currentType,
    paramInfo: fxManager.processor?.getParamInfo() ?? null,
  });
  return () => listeners.delete(listener);
}

/**
 * Dispose FX manager.
 */
export function disposeFXManager(): void {
  if (fxManager.processor) {
    fxManager.processor.dispose();
    fxManager.processor = null;
  }
  if (fxManager.input) {
    fxManager.input.disconnect();
    fxManager.input = null;
  }
  if (fxManager.output) {
    fxManager.output.disconnect();
    fxManager.output = null;
  }
  if (fxManager.bypassGain) {
    fxManager.bypassGain.disconnect();
    fxManager.bypassGain = null;
  }
  fxManager.currentType = "none";
  listeners.clear();
  console.log("[fx-manager] Disposed");
}
