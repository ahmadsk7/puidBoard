/**
 * Reverb FX - convolution-style reverb using feedback delay network.
 * 
 * Parameter maps to decay time / room size.
 * Uses a simple algorithmic approach (multiple delays with feedback).
 */

import type { FxState } from "@puid-board/shared";
import type { FXProcessor, FXParamInfo } from "./types";
import { setParamSmooth } from "../params";

/** Delay times for pseudo-reverb (in seconds) */
const DELAY_TIMES = [0.029, 0.037, 0.041, 0.043];

/** Base feedback for reverb tail */
const BASE_FEEDBACK = 0.5;

export class ReverbFX implements FXProcessor {
  readonly type = "reverb" as const;
  readonly input: GainNode;
  readonly output: GainNode;
  private delays: DelayNode[] = [];
  private feedbacks: GainNode[] = [];
  private wetGain: GainNode;
  private dryGain: GainNode;
  private reverbMix: GainNode;
  private enabled = true;
  private currentParam = 0.5;
  private currentWetDry = 0.5; // Store wet/dry value for restoration

  constructor(ctx: AudioContext) {
    // Create main nodes
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.reverbMix = ctx.createGain();

    // Set initial values
    this.wetGain.gain.value = 0.5;
    this.dryGain.gain.value = 0.5;
    this.reverbMix.gain.value = 0.25; // Scale down reverb to avoid buildup

    // Create delay network
    for (let i = 0; i < DELAY_TIMES.length; i++) {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = DELAY_TIMES[i]!;

      const feedback = ctx.createGain();
      feedback.gain.value = BASE_FEEDBACK;

      this.delays.push(delay);
      this.feedbacks.push(feedback);

      // Connect: input → delay → feedback → delay (loop)
      this.input.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);

      // Connect delay output to reverb mix
      delay.connect(this.reverbMix);
    }

    // Dry path: input → dryGain → output
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Wet path: reverbMix → wetGain → output
    this.reverbMix.connect(this.wetGain);
    this.wetGain.connect(this.output);
  }

  setWetDry(value: number): void {
    const wet = Math.max(0, Math.min(1, value));
    const dry = 1 - wet;

    // Store the wet/dry value for restoration when re-enabling
    this.currentWetDry = wet;

    console.log(`[ReverbFX] setWetDry called: value=${value}, wet=${wet}, dry=${dry}, enabled=${this.enabled}`);

    setParamSmooth(this.wetGain.gain, this.enabled ? wet : 0);
    setParamSmooth(this.dryGain.gain, this.enabled ? dry : 1);

    console.log(`[ReverbFX] setWetDry result: wetGain=${this.enabled ? wet : 0}, dryGain=${this.enabled ? dry : 1}`);
  }

  setParam(value: number): void {
    this.currentParam = Math.max(0, Math.min(1, value));
    
    // Map param to feedback amount (controls decay/room size)
    // 0 = small room (low feedback), 1 = large hall (high feedback)
    const feedback = BASE_FEEDBACK + this.currentParam * 0.35; // 0.5 to 0.85

    for (const fb of this.feedbacks) {
      setParamSmooth(fb.gain, feedback);
    }
  }

  setEnabled(enabled: boolean): void {
    console.log(`[ReverbFX] setEnabled called: enabled=${enabled}, currentWetDry=${this.currentWetDry}`);

    this.enabled = enabled;
    if (!enabled) {
      // Bypass: full dry, no wet
      console.log("[ReverbFX] Bypassing - setting wetGain=0, dryGain=1");
      setParamSmooth(this.wetGain.gain, 0);
      setParamSmooth(this.dryGain.gain, 1);
    } else {
      // Re-enable: restore wet/dry mix
      const wet = this.currentWetDry;
      const dry = 1 - wet;
      console.log(`[ReverbFX] Enabling - restoring wetGain=${wet}, dryGain=${dry}`);
      setParamSmooth(this.wetGain.gain, wet);
      setParamSmooth(this.dryGain.gain, dry);
    }
  }

  applyState(state: FxState): void {
    console.log(`[ReverbFX] applyState called:`, { enabled: state.enabled, wetDry: state.wetDry, param: state.param });

    // Always update the stored wet/dry value first, even when disabled
    this.currentWetDry = state.wetDry;

    this.setEnabled(state.enabled);
    this.setParam(state.param);
    // Note: setEnabled now handles restoring wet/dry when enabling
    // But we still call setWetDry when enabled to ensure consistency
    if (state.enabled) {
      this.setWetDry(state.wetDry);
    }
  }

  getParamInfo(): FXParamInfo {
    // Map param to room size description
    const sizePercent = Math.round(this.currentParam * 100);
    return {
      label: "Size",
      displayValue: sizePercent.toString(),
      unit: "%",
    };
  }

  dispose(): void {
    this.input.disconnect();
    for (const delay of this.delays) {
      delay.disconnect();
    }
    for (const feedback of this.feedbacks) {
      feedback.disconnect();
    }
    this.reverbMix.disconnect();
    this.wetGain.disconnect();
    this.dryGain.disconnect();
    this.output.disconnect();
  }
}
