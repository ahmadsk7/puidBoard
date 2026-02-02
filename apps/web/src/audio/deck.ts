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
    console.log(`[deck-${this.state.deckId}] ╔════════════════════════════════════════════════════════════╗`);
    console.log(`[deck-${this.state.deckId}] ║  LOAD TRACK CALLED                                        ║`);
    console.log(`[deck-${this.state.deckId}] ╚════════════════════════════════════════════════════════════╝`);
    console.log(`[deck-${this.state.deckId}]   - trackId: ${trackId}`);
    console.log(`[deck-${this.state.deckId}]   - url: ${url}`);

    // Auto-initialize audio on track load
    try {
      console.log(`[deck-${this.state.deckId}]   - Initializing audio engine...`);
      await initAudioEngine();
      console.log(`[deck-${this.state.deckId}]   ✓ Audio engine initialized`);
    } catch (err) {
      console.error(`[deck-${this.state.deckId}] ✗ Failed to initialize audio:`, err);
      throw new Error("Failed to initialize audio context");
    }

    const ctx = getAudioContext();
    if (!ctx) {
      console.error(`[deck-${this.state.deckId}] ✗ AudioContext not initialized`);
      throw new Error("AudioContext not initialized");
    }
    console.log(`[deck-${this.state.deckId}]   ✓ AudioContext available, state=${ctx.state}`);

    // Stop current playback
    console.log(`[deck-${this.state.deckId}]   - Stopping current playback...`);
    this.stop();

    // Check cache first
    console.log(`[deck-${this.state.deckId}]   - Checking cache for trackId: ${trackId}`);
    let buffer = trackCache.get(trackId);
    if (buffer) {
      console.log(`[deck-${this.state.deckId}]   ✓ Found in cache`);
    } else {
      console.log(`[deck-${this.state.deckId}]   - Not in cache, will fetch`);
    }

    if (!buffer) {
      console.log(`[deck-${this.state.deckId}] ─────────────────────────────────────────────────────────────`);
      console.log(`[deck-${this.state.deckId}] FETCHING TRACK FROM URL`);
      console.log(`[deck-${this.state.deckId}]   - URL length: ${url.length} chars`);
      console.log(`[deck-${this.state.deckId}]   - URL: ${url}`);

      try {
        console.log(`[deck-${this.state.deckId}]   - Starting fetch...`);
        const response = await fetch(url);
        console.log(`[deck-${this.state.deckId}]   - Fetch complete: status=${response.status}`);

        if (!response.ok) {
          console.error(`[deck-${this.state.deckId}] ✗ Fetch failed: ${response.status}`);
          throw new Error(`Failed to fetch track: ${response.status}`);
        }

        console.log(`[deck-${this.state.deckId}]   - Converting to ArrayBuffer...`);
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[deck-${this.state.deckId}]   - ArrayBuffer size: ${arrayBuffer.byteLength} bytes`);

        console.log(`[deck-${this.state.deckId}]   - Decoding audio data...`);
        buffer = await ctx.decodeAudioData(arrayBuffer);
        console.log(`[deck-${this.state.deckId}]   ✓ Audio decoded successfully`);
        console.log(`[deck-${this.state.deckId}]   - Duration: ${buffer.duration.toFixed(2)}s`);
        console.log(`[deck-${this.state.deckId}]   - Sample rate: ${buffer.sampleRate} Hz`);
        console.log(`[deck-${this.state.deckId}]   - Channels: ${buffer.numberOfChannels}`);

        // CRITICAL: Check audio data immediately after decoding
        const checkChannel = buffer.getChannelData(0);
        let checkMax = 0;
        let checkMin = 0;
        const checkCount = Math.min(10000, checkChannel.length);
        for (let i = 0; i < checkCount; i++) {
          const sample = checkChannel[i] ?? 0;
          checkMax = Math.max(checkMax, sample);
          checkMin = Math.min(checkMin, sample);
        }
        console.log(`[deck-${this.state.deckId}]   🔍 POST-DECODE AUDIO CHECK (first ${checkCount} samples):`);
        console.log(`[deck-${this.state.deckId}]      - max: ${checkMax.toFixed(6)}`);
        console.log(`[deck-${this.state.deckId}]      - min: ${checkMin.toFixed(6)}`);
        console.log(`[deck-${this.state.deckId}]      - peak-to-peak: ${(checkMax - checkMin).toFixed(6)}`);
        if (checkMax < 0.001) {
          console.warn(`[deck-${this.state.deckId}]   ⚠️ Beginning of track appears very quiet (may be silent lead-in)`);
        }

        // Cache the decoded buffer
        trackCache.set(trackId, buffer);
        console.log(`[deck-${this.state.deckId}]   ✓ Cached buffer for future use`);
      } catch (err) {
        console.error(`[deck-${this.state.deckId}] ✗✗✗ TRACK LOAD FAILED ✗✗✗`);
        console.error(`[deck-${this.state.deckId}] Error:`, err);
        throw err;
      }
    }

    console.log(`[deck-${this.state.deckId}] ─────────────────────────────────────────────────────────────`);
    console.log(`[deck-${this.state.deckId}] UPDATING DECK STATE`);
    this.state.trackId = trackId;
    this.state.buffer = buffer;
    this.state.durationSec = buffer.duration;
    this.state.playheadSec = 0;
    this.state.cuePointSec = 0;
    this.state.playState = "stopped";
    console.log(`[deck-${this.state.deckId}]   ✓ State updated`);

    // Start audio analysis
    console.log(`[deck-${this.state.deckId}] ─────────────────────────────────────────────────────────────`);
    console.log(`[deck-${this.state.deckId}] STARTING AUDIO ANALYSIS`);
    console.log(`[deck-${this.state.deckId}]   - Calling analyzeAudio()...`);
    this.analyzeAudio(buffer);

    this.notify();
    console.log(`[deck-${this.state.deckId}] ╔════════════════════════════════════════════════════════════╗`);
    console.log(`[deck-${this.state.deckId}] ║  LOAD TRACK COMPLETE - ANALYSIS STARTED                   ║`);
    console.log(`[deck-${this.state.deckId}] ╚════════════════════════════════════════════════════════════╝`);
  }

  /**
   * Analyze audio buffer for waveform and BPM.
   */
  private async analyzeAudio(buffer: AudioBuffer): Promise<void> {
    // Cancel any previous analysis by incrementing the ID
    this.currentAnalysisId++;
    const analysisId = this.currentAnalysisId;

    console.log(`[deck-${this.state.deckId}] ========== STARTING AUDIO ANALYSIS #${analysisId} ==========`);
    console.log(`[deck-${this.state.deckId}] Buffer info: duration=${buffer.duration.toFixed(2)}s, sampleRate=${buffer.sampleRate}, channels=${buffer.numberOfChannels}`);
    console.log(`[deck-${this.state.deckId}] Buffer length: ${buffer.length} samples`);
    console.log(`[deck-${this.state.deckId}] Track ID: ${this.state.trackId}`);

    // Verify buffer has actual audio data
    const channel0 = buffer.getChannelData(0);
    let maxAmplitude = 0;
    let sumAmplitude = 0;
    const sampleCheckSize = Math.min(10000, channel0.length);
    for (let i = 0; i < sampleCheckSize; i++) {
      const amp = Math.abs(channel0[i] ?? 0);
      maxAmplitude = Math.max(maxAmplitude, amp);
      sumAmplitude += amp;
    }
    const avgAmplitude = sumAmplitude / sampleCheckSize;
    console.log(`[deck-${this.state.deckId}] Audio data check - max: ${maxAmplitude.toFixed(4)}, avg: ${avgAmplitude.toFixed(4)}`);

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
        // FIXED: Update status to idle when cancelled (if no newer analysis is running)
        if (this.state.analysis.status === "analyzing") {
          this.state.analysis = { ...this.state.analysis, status: "idle" };
          this.notify();
        }
        return;
      }

      this.state.analysis = {
        ...this.state.analysis,
        waveform,
      };
      this.notify();
      console.log(`[deck-${this.state.deckId}] Waveform generated for analysis #${analysisId}`);

      // Detect BPM (async, slower)
      console.log(`[deck-${this.state.deckId}] ========================================`);
      console.log(`[deck-${this.state.deckId}] STARTING BPM DETECTION for analysis #${analysisId}`);
      console.log(`[deck-${this.state.deckId}] About to call detectBPM() with buffer:`);
      console.log(`[deck-${this.state.deckId}]   - duration: ${buffer.duration}s`);
      console.log(`[deck-${this.state.deckId}]   - sampleRate: ${buffer.sampleRate}`);
      console.log(`[deck-${this.state.deckId}]   - numberOfChannels: ${buffer.numberOfChannels}`);
      console.log(`[deck-${this.state.deckId}] ========================================`);

      const bpm = await detectBPM(buffer);

      console.log(`[deck-${this.state.deckId}] ========================================`);
      console.log(`[deck-${this.state.deckId}] detectBPM() RETURNED:`);
      console.log(`[deck-${this.state.deckId}]   - value: ${bpm}`);
      console.log(`[deck-${this.state.deckId}]   - type: ${typeof bpm}`);
      console.log(`[deck-${this.state.deckId}]   - is null: ${bpm === null}`);
      console.log(`[deck-${this.state.deckId}]   - is undefined: ${bpm === undefined}`);
      console.log(`[deck-${this.state.deckId}]   - exact value: ${JSON.stringify(bpm)}`);
      console.log(`[deck-${this.state.deckId}] ========================================`);

      // Check if this analysis was cancelled while BPM detection was running
      if (this.currentAnalysisId !== analysisId) {
        console.log(`[deck-${this.state.deckId}] ⚠️ Analysis #${analysisId} cancelled (BPM stage), got BPM=${bpm}`);
        // Don't update status here - a newer analysis is in progress
        return;
      }

      console.log(`[deck-${this.state.deckId}] Setting analysis state with BPM=${bpm}`);
      console.log(`[deck-${this.state.deckId}] BEFORE setState: analysis.bpm = ${this.state.analysis.bpm}`);

      this.state.analysis = {
        ...this.state.analysis,
        bpm,
        status: "complete",
      };

      console.log(`[deck-${this.state.deckId}] AFTER setState: analysis.bpm = ${this.state.analysis.bpm}`);
      console.log(`[deck-${this.state.deckId}] AFTER setState: analysis.status = ${this.state.analysis.status}`);
      console.log(`[deck-${this.state.deckId}] Full analysis object:`, JSON.stringify(this.state.analysis));

      this.notify();
      console.log(`[deck-${this.state.deckId}] State notification sent to listeners`);

      console.log(`[deck-${this.state.deckId}] ========== ANALYSIS #${analysisId} COMPLETE: BPM=${bpm ?? "N/A"} ==========`);
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
   * Set the playback rate immediately.
   *
   * @param rate - Target playback rate (0.5 to 2.0, 1.0 = normal)
   */
  setPlaybackRate(rate: number): void {
    const ctx = getAudioContext();
    
    // Clamp rate to reasonable bounds
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));

    if (!ctx || !this.state.source) {
      // No source playing, just update state for next play
      this.state.playbackRate = clampedRate;
      this.notify();
      return;
    }

    // If we're playing, smoothly transition the playback rate
    // The audio continues from its current position, just at a different speed
    if (this.state.playState === "playing" && this.state.startTime !== null) {
      const previousRate = this.state.playbackRate;
      
      // Calculate current position using the OLD rate before we change it
      const elapsed = ctx.currentTime - this.state.startTime;
      const currentPosition = this.state.startOffset + (elapsed * previousRate);
      
      // Update our timing references so getCurrentPlayhead() works correctly with new rate
      // Reset startTime to now, and startOffset to current position
      this.state.startTime = ctx.currentTime;
      this.state.startOffset = currentPosition;
      
      // Now update the rate
      this.state.playbackRate = clampedRate;

      // Apply rate change immediately (no ramp - causes sync issues)
      this.state.source.playbackRate.value = clampedRate;
      
      console.log(`[deck-${this.state.deckId}] Rate changed: ${previousRate.toFixed(3)} -> ${clampedRate.toFixed(3)} at position ${currentPosition.toFixed(2)}s`);
    } else {
      this.state.playbackRate = clampedRate;
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
   * The nudge is relative to the current tempo fader setting, not to 1.0.
   *
   * IMPORTANT: This does NOT modify state.playbackRate, so BPM display stays stable.
   * Only the audio source's playbackRate is temporarily modified.
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

    // Calculate temporary rate: base rate +/- 8% based on bend amount
    // Use state.playbackRate as base to respect tempo fader position
    const bendRange = 0.08; // 8% max bend
    const tempRate = this.state.playbackRate + (clampedBend * bendRange);

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
