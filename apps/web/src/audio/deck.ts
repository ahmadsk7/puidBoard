/**
 * Deck - manages audio playback for a single deck.
 * 
 * Each deck can:
 * - Load a track (decode audio buffer)
 * - Play/pause/cue
 * - Track playhead position
 * - Connect to the mixer chain
 */

import { getAudioContext } from "./engine";
import { getDeckInput, initMixerGraph } from "./mixerGraph";

/** Deck play state */
export type DeckPlayState = "stopped" | "playing" | "paused" | "cued";

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
    };
  }

  /**
   * Get current deck state.
   */
  getState(): DeckState {
    return { ...this.state };
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
    
    this.notify();
  }

  /**
   * Get current playhead position in seconds.
   */
  getCurrentPlayhead(): number {
    if (this.state.playState === "playing" && this.state.startTime !== null) {
      const ctx = getAudioContext();
      if (ctx) {
        const elapsed = ctx.currentTime - this.state.startTime;
        return Math.min(this.state.startOffset + elapsed, this.state.durationSec);
      }
    }
    return this.state.playheadSec;
  }

  /**
   * Play from current position.
   */
  play(): void {
    const ctx = getAudioContext();
    const gainNode = this.ensureGainNode();
    
    if (!ctx || !gainNode || !this.state.buffer) {
      console.warn(`[deck-${this.state.deckId}] Cannot play: no audio context or buffer`);
      return;
    }

    // Stop existing source if any
    this.stopSource();

    // Create new buffer source
    const source = ctx.createBufferSource();
    source.buffer = this.state.buffer;
    source.connect(gainNode);

    // Handle track end
    source.onended = () => {
      if (this.state.playState === "playing") {
        this.state.playState = "stopped";
        this.state.playheadSec = 0;
        this.state.source = null;
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

    // Save current playhead position
    this.state.playheadSec = this.getCurrentPlayhead();
    
    // Stop source
    this.stopSource();
    
    this.state.playState = "paused";
    this.stopPlayheadUpdate();
    
    this.notify();
    console.log(`[deck-${this.state.deckId}] Paused at ${this.state.playheadSec.toFixed(2)}s`);
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    this.stopSource();
    this.state.playState = "stopped";
    this.state.playheadSec = 0;
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

    // Stop and jump to cue point
    this.stopSource();
    this.state.playheadSec = this.state.cuePointSec;
    this.state.playState = "cued";
    this.stopPlayheadUpdate();
    
    this.notify();
    console.log(`[deck-${this.state.deckId}] Cued at ${this.state.cuePointSec.toFixed(2)}s`);
  }

  /**
   * Seek to a specific position.
   */
  seek(positionSec: number): void {
    const wasPlaying = this.state.playState === "playing";
    
    this.stopSource();
    this.state.playheadSec = Math.max(0, Math.min(positionSec, this.state.durationSec));
    
    if (wasPlaying) {
      this.play();
    } else {
      this.state.playState = "paused";
      this.notify();
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
