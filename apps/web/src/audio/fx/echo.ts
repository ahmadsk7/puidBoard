/**
 * Echo FX - simple delay with feedback.
 * 
 * Parameter maps to delay time (50ms - 500ms).
 */

import type { FxState } from "@puid-board/shared";
import type { FXProcessor, FXParamInfo } from "./types";
import { setParamSmooth } from "../params";

/** Delay time range in seconds */
const MIN_DELAY = 0.05;  // 50ms
const MAX_DELAY = 0.5;   // 500ms

/** Feedback amount (fixed for simplicity) */
const FEEDBACK = 0.4;

export class EchoFX implements FXProcessor {
  readonly type = "echo" as const;
  readonly input: GainNode;
  readonly output: GainNode;
  private delayNode: DelayNode;
  private feedbackGain: GainNode;
  private wetGain: GainNode;
  private dryGain: GainNode;
  private enabled = true;
  private currentParam = 0.5;
  private currentWetDry = 0.5; // Store wet/dry value for restoration

  constructor(ctx: AudioContext) {
    // Create nodes
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.delayNode = ctx.createDelay(MAX_DELAY + 0.1);
    this.feedbackGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.dryGain = ctx.createGain();

    // Set initial values
    this.delayNode.delayTime.value = this.paramToDelayTime(0.5);
    this.feedbackGain.gain.value = FEEDBACK;
    this.wetGain.gain.value = 0.5;
    this.dryGain.gain.value = 0.5;

    // Connect: input → dry → output (dry path)
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Connect: input → delay → wet → output (wet path)
    this.input.connect(this.delayNode);
    this.delayNode.connect(this.wetGain);
    this.wetGain.connect(this.output);

    // Feedback loop: delay → feedback → delay
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
  }

  private paramToDelayTime(param: number): number {
    return MIN_DELAY + param * (MAX_DELAY - MIN_DELAY);
  }

  setWetDry(value: number): void {
    const wet = Math.max(0, Math.min(1, value));
    const dry = 1 - wet;

    // Store the wet/dry value for restoration when re-enabling
    this.currentWetDry = wet;

    console.log(`[EchoFX] setWetDry called: value=${value}, wet=${wet}, dry=${dry}, enabled=${this.enabled}`);

    setParamSmooth(this.wetGain.gain, this.enabled ? wet : 0);
    setParamSmooth(this.dryGain.gain, this.enabled ? dry : 1);

    console.log(`[EchoFX] setWetDry result: wetGain=${this.enabled ? wet : 0}, dryGain=${this.enabled ? dry : 1}`);
  }

  setParam(value: number): void {
    this.currentParam = Math.max(0, Math.min(1, value));
    const delayTime = this.paramToDelayTime(this.currentParam);
    setParamSmooth(this.delayNode.delayTime, delayTime);
  }

  setEnabled(enabled: boolean): void {
    console.log(`[EchoFX] setEnabled called: enabled=${enabled}, currentWetDry=${this.currentWetDry}`);

    this.enabled = enabled;
    if (!enabled) {
      // Bypass: full dry, no wet
      console.log("[EchoFX] Bypassing - setting wetGain=0, dryGain=1");
      setParamSmooth(this.wetGain.gain, 0);
      setParamSmooth(this.dryGain.gain, 1);
    } else {
      // Re-enable: restore wet/dry mix
      const wet = this.currentWetDry;
      const dry = 1 - wet;
      console.log(`[EchoFX] Enabling - restoring wetGain=${wet}, dryGain=${dry}`);
      setParamSmooth(this.wetGain.gain, wet);
      setParamSmooth(this.dryGain.gain, dry);
    }
  }

  applyState(state: FxState): void {
    console.log(`[EchoFX] applyState called:`, { enabled: state.enabled, wetDry: state.wetDry, param: state.param });

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
    const delayMs = Math.round(this.paramToDelayTime(this.currentParam) * 1000);
    return {
      label: "Delay",
      displayValue: delayMs.toString(),
      unit: "ms",
    };
  }

  dispose(): void {
    this.input.disconnect();
    this.delayNode.disconnect();
    this.feedbackGain.disconnect();
    this.wetGain.disconnect();
    this.dryGain.disconnect();
    this.output.disconnect();
  }
}
