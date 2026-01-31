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
    
    setParamSmooth(this.wetGain.gain, this.enabled ? wet : 0);
    setParamSmooth(this.dryGain.gain, this.enabled ? dry : 1);
  }

  setParam(value: number): void {
    this.currentParam = Math.max(0, Math.min(1, value));
    const delayTime = this.paramToDelayTime(this.currentParam);
    setParamSmooth(this.delayNode.delayTime, delayTime);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // Bypass: full dry, no wet
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
