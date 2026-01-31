/**
 * FX module types and interfaces.
 */

import type { FxType, FxState } from "@puid-board/shared";

/**
 * Base interface for all FX processors.
 */
export interface FXProcessor {
  /** FX type identifier */
  readonly type: FxType;
  
  /** Input node to connect audio source */
  readonly input: AudioNode;
  
  /** Output node to connect to destination */
  readonly output: AudioNode;
  
  /** Set the wet/dry mix (0 = dry, 1 = wet) */
  setWetDry(value: number): void;
  
  /** Set the effect parameter (0-1, meaning depends on FX type) */
  setParam(value: number): void;
  
  /** Enable or bypass the effect */
  setEnabled(enabled: boolean): void;
  
  /** Apply full FX state */
  applyState(state: FxState): void;
  
  /** Get current parameter info for UI display */
  getParamInfo(): FXParamInfo;
  
  /** Dispose and cleanup audio nodes */
  dispose(): void;
}

/**
 * Parameter info for UI display.
 */
export interface FXParamInfo {
  /** Parameter label (e.g., "Delay Time", "Room Size", "Cutoff") */
  label: string;
  /** Current value formatted for display */
  displayValue: string;
  /** Unit (e.g., "ms", "%", "Hz") */
  unit: string;
}

/**
 * FX factory function type.
 */
export type FXFactory = (ctx: AudioContext) => FXProcessor;
