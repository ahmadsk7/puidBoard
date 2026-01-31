/**
 * Filter FX - resonant low-pass filter.
 * 
 * Parameter maps to cutoff frequency (200Hz - 15kHz).
 * Classic DJ filter sweep effect.
 */

import type { FxState } from "@puid-board/shared";
import type { FXProcessor, FXParamInfo } from "./types";
import { setParamSmooth } from "../params";

/** Cutoff frequency range in Hz */
const MIN_FREQ = 200;
const MAX_FREQ = 15000;

/** Resonance (Q factor) */
const RESONANCE = 2.5;

export class FilterFX implements FXProcessor {
  readonly type = "filter" as const;
  readonly input: GainNode;
  readonly output: GainNode;
  private filter: BiquadFilterNode;
  private wetGain: GainNode;
  private dryGain: GainNode;
  private enabled = true;
  private currentParam = 1.0; // Start fully open

  constructor(ctx: AudioContext) {
    // Create nodes
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.wetGain = ctx.createGain();
    this.dryGain = ctx.createGain();

    // Configure filter
    this.filter.type = "lowpass";
    this.filter.frequency.value = MAX_FREQ;
    this.filter.Q.value = RESONANCE;

    // Set initial values
    this.wetGain.gain.value = 1;
    this.dryGain.gain.value = 0;

    // Dry path: input → dryGain → output
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Wet path: input → filter → wetGain → output
    this.input.connect(this.filter);
    this.filter.connect(this.wetGain);
    this.wetGain.connect(this.output);
  }

  private paramToFrequency(param: number): number {
    // Exponential mapping for more musical response
    // param 0 = MIN_FREQ, param 1 = MAX_FREQ
    const minLog = Math.log(MIN_FREQ);
    const maxLog = Math.log(MAX_FREQ);
    return Math.exp(minLog + param * (maxLog - minLog));
  }

  setWetDry(value: number): void {
    const wet = Math.max(0, Math.min(1, value));
    const dry = 1 - wet;

    setParamSmooth(this.wetGain.gain, this.enabled ? wet : 0);
    setParamSmooth(this.dryGain.gain, this.enabled ? dry : 1);
  }

  setParam(value: number): void {
    this.currentParam = Math.max(0, Math.min(1, value));
    const freq = this.paramToFrequency(this.currentParam);
    setParamSmooth(this.filter.frequency, freq);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      setParamSmooth(this.wetGain.gain, 0);
      setParamSmooth(this.dryGain.gain, 1);
    }
  }

  applyState(state: FxState): void {
    this.setEnabled(state.enabled);
    this.setParam(state.param);
    if (state.enabled) {
      this.setWetDry(state.wetDry);
    }
  }

  getParamInfo(): FXParamInfo {
    const freq = this.paramToFrequency(this.currentParam);
    let displayValue: string;
    let unit: string;

    if (freq >= 1000) {
      displayValue = (freq / 1000).toFixed(1);
      unit = "kHz";
    } else {
      displayValue = Math.round(freq).toString();
      unit = "Hz";
    }

    return {
      label: "Cutoff",
      displayValue,
      unit,
    };
  }

  dispose(): void {
    this.input.disconnect();
    this.filter.disconnect();
    this.wetGain.disconnect();
    this.dryGain.disconnect();
    this.output.disconnect();
  }
}
