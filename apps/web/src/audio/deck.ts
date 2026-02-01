/**
 * Deck - manages audio playback for a single deck.
 * 
 * Each deck can:
 * - Load a track (decode audio buffer)
 * - Play/pause/cue
 * - Track playhead position
 * - Connect to the mixer chain
 */

import { getAudioContext, initAudioEngine } from "./engine";
import { getDeckInput, initMixerGraph } from "./mixerGraph";
import { generateWaveform, WaveformData } from "./analysis/waveformGenerator";
import { detectBPM } from "./analysis/bpmDetector";

/** Deck play state */
export type DeckPlayState = "stopped" | "playing" | "paused" | "cued";

/** Analysis status */
export type AnalysisStatus = "idle" | "analyzing" | "complete" | "error";

/** Deck state */
export interface DeckState {
  deckId: "A" | "B";
  trackId: string | null;
  buffer: AudioBuffer | null;
  playState: DeckPlayState;
  /** Playhead position in seconds when paused/stopped */
  playheadSec: number;
  /** Start time (AudioContext.currentTime) when playback began */
  startTime: number | null;
  /** Offset from start of track when playback began */
  startOffset: number;
  /** Cue point position in seconds */
  cuePointSec: number;
  /** Track duration in seconds */
  durationSec: number;
  /** Gain node for this deck */
  gainNode: GainNode | null;
  /** Current buffer source (recreated on each play) */
  source: AudioBufferSourceNode | null;
  /** Current playback rate (1.0 = normal) */
  playbackRate: number;
  /** Audio analysis data */
  analysis: {
    waveform: WaveformData | null;
    bpm: number | null;
    status: AnalysisStatus;
  };
}

/** Track loading cache (avoid re-fetching) */
const trackCache = new Map<string, AudioBuffer>();

/** State listeners */
type DeckStateListener = (state: DeckState) => void;

/**
 * Deck class - manages a single deck's playback.
 */
export class Deck {
  private state: DeckState;
  private listeners = new Set<DeckStateListener>();
  private animationFrameId: number | null = null;
  private currentAnalysisId: number = 0;

  constructor(deckId: "A" | "B") {
    this.state = {
      deckId,
      trackId: null,
      buffer: null,
      playState: "stopped",
      playheadSec: 0,
      startTime: null,
      startOffset: 0,
      cuePointSec: 0,
      durationSec: 0,
      gainNode: null,
      source: null,
      playbackRate: 1.0,
      analysis: {
        waveform: null,
        bpm: null,
        status: "idle",
      },
    };
  }

  /**
   * Get current deck state.
   */
  getState(): DeckState {
    return {
      ...this.state,
      analysis: { ...this.state.analysis },
    };
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: DeckStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners of state change.
   */
  private notify(): void {
    const stateCopy = this.getState();
    for (const listener of this.listeners) {
      listener(stateCopy);
    }
  }

  /**
   * Initialize gain node (connect to mixer graph).
   */
  private ensureGainNode(): GainNode | null {
    const ctx = getAudioContext();
    
    if (!ctx) {
      return null;
    }

    // Ensure mixer graph is initialized
    initMixerGraph();

    // Get the mixer input for this deck
    const mixerInput = getDeckInput(this.state.deckId);
    
    if (!mixerInput) {
      console.warn(`[deck-${this.state.deckId}] No mixer input available`);
      return null;
    }

    if (!this.state.gainNode) {
      this.state.gainNode = ctx.createGain();
      this.state.gainNode.connect(mixerInput);
    }

    return this.state.gainNode;
  }

  /**
   * Load a track by URL.
   */
  async loadTrack(trackId: string, url: string): Promise<void> {
    const ctx = getAudioContext();
    if (!ctx) {
      throw new Error("AudioContext not initialized");
    }

    // Stop current playback
    this.stop();

    // Check cache first
    let buffer = trackCache.get(trackId);
    
    if (!buffer) {
      console.log(`[deck-${this.state.deckId}] Loading track: ${trackId}`);
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch track: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        buffer = await ctx.decodeAudioData(arrayBuffer);
        
        // Cache the decoded buffer
        trackCache.set(trackId, buffer);
        console.log(`[deck-${this.state.deckId}] Track loaded: ${trackId} (${buffer.duration.toFixed(1)}s)`);
      } catch (err) {
        console.error(`[deck-${this.state.deckId}] Failed to load track:`, err);
        throw err;
      }
    }

    this.state.trackId = trackId;
    this.state.buffer = buffer;
    this.state.durationSec = buffer.duration;
    this.state.playheadSec = 0;
    this.state.cuePointSec = 0;
    this.state.playState = "stopped";

    // Start audio analysis
    this.analyzeAudio(buffer);

    this.notify();
  }

  /**
   * Analyze audio buffer for waveform and BPM.
   */
  private async analyzeAudio(buffer: AudioBuffer): Promise<void> {
    // Cancel any previous analysis by incrementing the ID
    this.currentAnalysisId++;
    const analysisId = this.currentAnalysisId;

    console.log(`[deck-${this.state.deckId}] Starting analysis #${analysisId}`);

    // Set analyzing status
    this.state.analysis = {
      status: "analyzing",
      waveform: null,
      bpm: null,
    };
    this.notify();

    try {
      // Generate waveform (synchronous, fast)
      const waveform = generateWaveform(buffer, 480);

      // Check if this analysis was cancelled
      if (this.currentAnalysisId !== analysisId) {
        console.log(`[deck-${this.state.deckId}] Analysis #${analysisId} cancelled (waveform stage)`);
        return;
      }

      this.state.analysis = {
        ...this.state.analysis,
        waveform,
      };
      this.notify();
      console.log(`[deck-${this.state.deckId}] Waveform generated for analysis #${analysisId}`);

      // Detect BPM (async, slower)
      console.log(`[deck-${this.state.deckId}] Starting BPM detection for analysis #${analysisId}...`);
      const bpm = await detectBPM(buffer);

      // Check if this analysis was cancelled while BPM detection was running
      if (this.currentAnalysisId !== analysisId) {
        console.log(`[deck-${this.state.deckId}] Analysis #${analysisId} cancelled (BPM stage), got BPM=${bpm}`);
        return;
      }

      this.state.analysis = {
        ...this.state.analysis,
        bpm,
        status: "complete",
      };
      this.notify();

      console.log(`[deck-${this.state.deckId}] Analysis #${analysisId} complete: BPM=${bpm ?? "N/A"}`);
    } catch (error) {
      // Check if cancelled before setting error
      if (this.currentAnalysisId !== analysisId) {
        console.log(`[deck-${this.state.deckId}] Analysis #${analysisId} cancelled (error stage)`);
        return;
      }

      console.error(`[deck-${this.state.deckId}] Analysis #${analysisId} failed:`, error);
      this.state.analysis = {
        ...this.state.analysis,
        status: "error",
      };
      this.notify();
    }
  }

  /**
   * Get current playhead position in seconds.
   * Accounts for playback rate when calculating elapsed time.
   */
  getCurrentPlayhead(): number {
    if (this.state.playState === "playing" && this.state.startTime !== null) {
      const ctx = getAudioContext();
      if (ctx) {
        const elapsed = ctx.currentTime - this.state.startTime;
        // Playback rate affects how much audio time passes per real time
        const adjustedElapsed = elapsed * this.state.playbackRate;
        return Math.min(this.state.startOffset + adjustedElapsed, this.state.durationSec);
      }
    }
    return this.state.playheadSec;
  }

  /**
   * Get the current playback rate.
   */
  getPlaybackRate(): number {
    return this.state.playbackRate;
  }

  /**
   * Play from current position.
   */
  async play(): Promise<void> {
    // Auto-initialize audio on first interaction
    try {
      await initAudioEngine();
    } catch (err) {
      console.error(`[deck-${this.state.deckId}] Failed to initialize audio:`, err);
      return;
    }

    const ctx = getAudioContext();
    const gainNode = this.ensureGainNode();

    if (!ctx || !gainNode || !this.state.buffer) {
      console.warn(`[deck-${this.state.deckId}] Cannot play: no audio context or buffer`);
      return;
    }

    // Stop existing source if any (ensures single instance)
    this.stopSource();

    // Create new buffer source
    const source = ctx.createBufferSource();
    source.buffer = this.state.buffer;
    source.playbackRate.value = this.state.playbackRate;
    source.connect(gainNode);

    // Store reference for closure comparison
    const thisSource = source;

    // Handle track end
    // CRITICAL: Check that THIS source is still the current source
    // This prevents orphaned sources from affecting state
    source.onended = () => {
      if (this.state.playState === "playing" && this.state.source === thisSource) {
        this.state.playState = "stopped";
        this.state.playheadSec = 0;
        this.state.source = null;
        this.state.playbackRate = 1.0; // Reset rate on track end
        this.stopPlayheadUpdate();
        this.notify();
      }
    };

    // Start from current playhead
    const offset = this.state.playheadSec;
    source.start(0, offset);

    this.state.source = source;
    this.state.startTime = ctx.currentTime;
    this.state.startOffset = offset;
    this.state.playState = "playing";

    // Start playhead update loop
    this.startPlayheadUpdate();

    this.notify();
    console.log(`[deck-${this.state.deckId}] Playing from ${offset.toFixed(2)}s`);
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this.state.playState !== "playing") {
      return;
    }

    // Save current playhead position BEFORE changing state
    const savedPlayhead = this.getCurrentPlayhead();

    // CRITICAL: Change state BEFORE stopping source
    // This prevents the onended handler from interfering
    this.state.playState = "paused";
    this.state.playheadSec = savedPlayhead;

    // Now stop the source (onended will fire but check will fail)
    this.stopSource();

    this.stopPlayheadUpdate();

    this.notify();
    console.log(`[deck-${this.state.deckId}] Paused at ${this.state.playheadSec.toFixed(2)}s`);
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    // CRITICAL: Change state BEFORE stopping source
    // This prevents the onended handler from interfering
    this.state.playState = "stopped";
    this.state.playheadSec = 0;

    // Now stop the source (onended will fire but check will fail)
    this.stopSource();

    this.stopPlayheadUpdate();
    this.notify();
  }

  /**
   * Set or jump to cue point.
   */
  cue(cuePointSec?: number): void {
    if (cuePointSec !== undefined) {
      // Set new cue point
      this.state.cuePointSec = Math.max(0, Math.min(cuePointSec, this.state.durationSec));
    }

    // CRITICAL: Change state BEFORE stopping source
    // This prevents the onended handler from interfering
    this.state.playState = "cued";
    this.state.playheadSec = this.state.cuePointSec;

    // Now stop the source
    this.stopSource();

    this.stopPlayheadUpdate();

    this.notify();
    console.log(`[deck-${this.state.deckId}] Cued at ${this.state.cuePointSec.toFixed(2)}s`);
  }

  /**
   * Seek to a specific position.
   */
  seek(positionSec: number): void {
    const wasPlaying = this.state.playState === "playing";
    const currentRate = this.state.playbackRate;
    const targetPosition = Math.max(0, Math.min(positionSec, this.state.durationSec));

    // CRITICAL: Change state BEFORE stopping source if we were playing
    // This prevents the onended handler from interfering
    if (wasPlaying) {
      // Temporarily set to paused so onended doesn't reset playhead
      this.state.playState = "paused";
    }

    this.stopSource();
    this.state.playheadSec = targetPosition;

    if (wasPlaying) {
      // Preserve playback rate when resuming
      this.playWithRate(currentRate);
    } else {
      this.state.playState = "paused";
      this.notify();
    }
  }

  /**
   * Set the playback rate with a smooth transition.
   *
   * @param rate - Target playback rate (0.5 to 2.0, 1.0 = normal)
   * @param rampTimeMs - Time to ramp to the new rate (default 100ms)
   */
  setPlaybackRate(rate: number, rampTimeMs: number = 100): void {
    const ctx = getAudioContext();
    if (!ctx || !this.state.source) {
      // No source playing, just update state for next play
      this.state.playbackRate = rate;
      return;
    }

    // Clamp rate to reasonable bounds
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));

    // Update state immediately
    const previousRate = this.state.playbackRate;
    this.state.playbackRate = clampedRate;

    // If we're playing, we need to:
    // 1. Calculate current playhead based on old rate
    // 2. Update startTime and startOffset to maintain position
    // 3. Apply new rate to source
    if (this.state.playState === "playing" && this.state.startTime !== null) {
      // Calculate current position with old rate
      const elapsed = ctx.currentTime - this.state.startTime;
      const adjustedElapsed = elapsed * previousRate;
      const currentPosition = this.state.startOffset + adjustedElapsed;

      // Update timing references for new rate
      this.state.startTime = ctx.currentTime;
      this.state.startOffset = currentPosition;
      this.state.playheadSec = currentPosition;

      // Apply rate change with smooth ramp
      const rampTimeSec = rampTimeMs / 1000;
      this.state.source.playbackRate.setTargetAtTime(
        clampedRate,
        ctx.currentTime,
        rampTimeSec / 3 // Time constant (reaches ~95% in rampTimeSec)
      );
    }

    this.notify();
  }

  /**
   * Play from current position with a specific playback rate.
   * Used internally to preserve rate after seek.
   */
  private playWithRate(rate: number): void {
    const ctx = getAudioContext();
    const gainNode = this.ensureGainNode();

    if (!ctx || !gainNode || !this.state.buffer) {
      console.warn(`[deck-${this.state.deckId}] Cannot play: no audio context or buffer`);
      return;
    }

    // Stop existing source if any (ensures single instance)
    this.stopSource();

    // Create new buffer source
    const source = ctx.createBufferSource();
    source.buffer = this.state.buffer;
    source.playbackRate.value = rate;
    source.connect(gainNode);

    // Store reference for closure comparison
    const thisSource = source;

    // Handle track end
    // CRITICAL: Check that THIS source is still the current source
    source.onended = () => {
      if (this.state.playState === "playing" && this.state.source === thisSource) {
        this.state.playState = "stopped";
        this.state.playheadSec = 0;
        this.state.source = null;
        this.state.playbackRate = 1.0; // Reset rate on track end
        this.stopPlayheadUpdate();
        this.notify();
      }
    };

    // Start from current playhead
    const offset = this.state.playheadSec;
    source.start(0, offset);

    this.state.source = source;
    this.state.startTime = ctx.currentTime;
    this.state.startOffset = offset;
    this.state.playState = "playing";
    this.state.playbackRate = rate;

    // Start playhead update loop
    this.startPlayheadUpdate();

    this.notify();
  }

  /**
   * Seek to a position with a short crossfade for smooth correction.
   * Used for drift snap corrections to avoid audible artifacts.
   *
   * @param positionSec - Target position in seconds
   * @param crossfadeMs - Crossfade duration (default 50ms)
   */
  seekSmooth(positionSec: number, crossfadeMs: number = 50): void {
    if (this.state.playState !== "playing") {
      // If not playing, just do a normal seek
      this.seek(positionSec);
      return;
    }

    const ctx = getAudioContext();
    const gainNode = this.ensureGainNode();

    if (!ctx || !gainNode || !this.state.buffer) {
      return;
    }

    const currentRate = this.state.playbackRate;
    const crossfadeSec = crossfadeMs / 1000;
    const targetPosition = Math.max(0, Math.min(positionSec, this.state.durationSec));

    // Create a temporary gain node for crossfade
    const oldSource = this.state.source;
    const fadeOutGain = ctx.createGain();
    fadeOutGain.gain.value = 1;
    fadeOutGain.connect(gainNode);

    // Create new source at target position
    const newSource = ctx.createBufferSource();
    newSource.buffer = this.state.buffer;
    newSource.playbackRate.value = currentRate;

    const fadeInGain = ctx.createGain();
    fadeInGain.gain.value = 0;
    newSource.connect(fadeInGain);
    fadeInGain.connect(gainNode);

    // Reconnect old source through fade out gain
    if (oldSource) {
      try {
        oldSource.disconnect();
        oldSource.connect(fadeOutGain);
      } catch {
        // Source may already be disconnected
      }
    }

    // Start new source
    newSource.start(0, targetPosition);

    // Crossfade
    const now = ctx.currentTime;
    fadeOutGain.gain.setValueAtTime(1, now);
    fadeOutGain.gain.linearRampToValueAtTime(0, now + crossfadeSec);
    fadeInGain.gain.setValueAtTime(0, now);
    fadeInGain.gain.linearRampToValueAtTime(1, now + crossfadeSec);

    // Store reference for closure comparison
    const thisSource = newSource;

    // Handle track end for new source
    // CRITICAL: Check that THIS source is still the current source
    newSource.onended = () => {
      if (this.state.playState === "playing" && this.state.source === thisSource) {
        this.state.playState = "stopped";
        this.state.playheadSec = 0;
        this.state.source = null;
        this.state.playbackRate = 1.0;
        this.stopPlayheadUpdate();
        this.notify();
      }
    };

    // Cleanup old source after crossfade
    // Store newSource reference to check if it's still current when cleanup runs
    const sourceAtCleanupTime = newSource;
    setTimeout(() => {
      // Always clean up the old source
      if (oldSource) {
        try {
          oldSource.stop();
          oldSource.disconnect();
        } catch {
          // Ignore
        }
      }
      fadeOutGain.disconnect();

      // Only reconnect if newSource is still the current source
      // (prevents reconnecting orphaned sources if another operation happened)
      if (this.state.source === sourceAtCleanupTime) {
        try {
          newSource.disconnect();
          newSource.connect(gainNode);
          fadeInGain.disconnect();
        } catch {
          // Ignore
        }
      } else {
        // This source was replaced, stop it
        try {
          newSource.stop();
          newSource.disconnect();
          fadeInGain.disconnect();
        } catch {
          // Ignore
        }
      }
    }, crossfadeMs + 10);

    // Update state
    this.state.source = newSource;
    this.state.startTime = ctx.currentTime;
    this.state.startOffset = targetPosition;
    this.state.playheadSec = targetPosition;

    console.log(`[deck-${this.state.deckId}] Smooth seek to ${targetPosition.toFixed(2)}s`);
    this.notify();
  }

  /**
   * Reset playback rate to normal (1.0).
   */
  resetPlaybackRate(): void {
    this.setPlaybackRate(1.0);
  }

  /**
   * Scrub/scratch the audio - directly move the playhead.
   * Used for vinyl mode scratching on jog wheel center platter.
   *
   * @param deltaSec - Amount to move the playhead (positive = forward, negative = backward)
   */
  async scrub(deltaSec: number): Promise<void> {
    // Auto-initialize audio on first interaction
    try {
      await initAudioEngine();
    } catch (err) {
      console.error(`[deck-${this.state.deckId}] Failed to initialize audio:`, err);
      return;
    }

    const ctx = getAudioContext();
    const gainNode = this.ensureGainNode();

    if (!ctx || !gainNode || !this.state.buffer) {
      return;
    }

    // Calculate new position
    const currentPlayhead = this.getCurrentPlayhead();
    const newPosition = Math.max(0, Math.min(currentPlayhead + deltaSec, this.state.durationSec));

    // Update playhead
    this.state.playheadSec = newPosition;

    // If we're playing, we need to restart the source at the new position
    if (this.state.playState === "playing") {
      // Stop existing source (ensures single instance)
      this.stopSource();

      // Create new buffer source at new position
      const source = ctx.createBufferSource();
      source.buffer = this.state.buffer;
      source.playbackRate.value = this.state.playbackRate;
      source.connect(gainNode);

      // Store reference for closure comparison
      const thisSource = source;

      // Handle track end
      // CRITICAL: Check that THIS source is still the current source
      source.onended = () => {
        if (this.state.playState === "playing" && this.state.source === thisSource) {
          this.state.playState = "stopped";
          this.state.playheadSec = 0;
          this.state.source = null;
          this.state.playbackRate = 1.0;
          this.stopPlayheadUpdate();
          this.notify();
        }
      };

      // Start from new position
      source.start(0, newPosition);

      this.state.source = source;
      this.state.startTime = ctx.currentTime;
      this.state.startOffset = newPosition;
    }

    this.notify();
  }

  /**
   * Apply temporary pitch bend (nudge) for beat matching.
   * This temporarily adjusts the playback rate without modifying the base tempo.
   *
   * @param bendAmount - Amount to bend (-1 to 1, where 1 = +8% speed, -1 = -8% speed)
   */
  async nudge(bendAmount: number): Promise<void> {
    // Auto-initialize audio on first interaction
    try {
      await initAudioEngine();
    } catch (err) {
      console.error(`[deck-${this.state.deckId}] Failed to initialize audio:`, err);
      return;
    }

    // Clamp bend amount to reasonable range
    const clampedBend = Math.max(-1, Math.min(1, bendAmount));

    // Calculate temporary rate: 1.0 +/- 8% based on bend amount
    const bendRange = 0.08; // 8% max bend
    const tempRate = 1.0 + (clampedBend * bendRange);

    // Apply without ramp for immediate effect (nudging needs to be instant)
    const ctx = getAudioContext();
    if (ctx && this.state.source && this.state.playState === "playing") {
      this.state.source.playbackRate.setValueAtTime(tempRate, ctx.currentTime);
    }
  }

  /**
   * Release the pitch bend and return to normal playback rate.
   */
  releaseNudge(): void {
    const ctx = getAudioContext();
    if (ctx && this.state.source && this.state.playState === "playing") {
      // Smoothly return to base rate
      this.state.source.playbackRate.setTargetAtTime(
        this.state.playbackRate,
        ctx.currentTime,
        0.05 // Quick but smooth return
      );
    }
  }

  /**
   * Set deck volume (gain).
   */
  setVolume(volume: number): void {
    if (this.state.gainNode) {
      this.state.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Stop the buffer source node.
   */
  private stopSource(): void {
    if (this.state.source) {
      try {
        this.state.source.stop();
        this.state.source.disconnect();
      } catch {
        // Ignore errors (source may already be stopped)
      }
      this.state.source = null;
    }
    this.state.startTime = null;
  }

  /**
   * Start playhead update animation loop.
   */
  private startPlayheadUpdate(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    const update = () => {
      if (this.state.playState === "playing") {
        this.state.playheadSec = this.getCurrentPlayhead();
        this.notify();
        this.animationFrameId = requestAnimationFrame(update);
      }
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  /**
   * Stop playhead update animation loop.
   */
  private stopPlayheadUpdate(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Cleanup (disconnect and stop).
   */
  dispose(): void {
    this.stopSource();
    this.stopPlayheadUpdate();
    
    if (this.state.gainNode) {
      this.state.gainNode.disconnect();
      this.state.gainNode = null;
    }
    
    this.listeners.clear();
  }
}

/**
 * Clear the track cache.
 */
export function clearTrackCache(): void {
  trackCache.clear();
}
