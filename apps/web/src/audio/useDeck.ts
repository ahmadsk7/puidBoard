"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Deck, DeckState } from "./deck";

/** Singleton deck instances */
const decks: { A: Deck | null; B: Deck | null } = { A: null, B: null };

/** Debounce helper for stable values */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Get or create a deck instance.
 */
export function getDeck(deckId: "A" | "B"): Deck {
  if (!decks[deckId]) {
    decks[deckId] = new Deck(deckId);
  }
  return decks[deckId]!;
}

/**
 * Hook to use a deck's state and controls.
 */
export function useDeck(deckId: "A" | "B") {
  const deckRef = useRef<Deck>(getDeck(deckId));
  const [state, setState] = useState<DeckState>(deckRef.current.getState());

  useEffect(() => {
    const deck = deckRef.current;
    console.log(`[useDeck-${deckId}] Subscribing to deck state changes`);

    // Track previous state for change detection (reduce log spam)
    let lastBpm: number | null = null;
    let lastStatus: string = "idle";
    let lastTrackId: string | null = null;

    // Subscribe to state changes
    const unsubscribe = deck.subscribe((newState) => {
      // Only log when significant values change (not on every playhead update)
      const bpmChanged = newState.analysis.bpm !== lastBpm;
      const statusChanged = newState.analysis.status !== lastStatus;
      const trackChanged = newState.trackId !== lastTrackId;

      if (bpmChanged || statusChanged || trackChanged) {
        console.log(`[useDeck-${deckId}] State update - BPM: ${newState.analysis.bpm}, status: ${newState.analysis.status}, trackId: ${newState.trackId}`);
        lastBpm = newState.analysis.bpm;
        lastStatus = newState.analysis.status;
        lastTrackId = newState.trackId;
      }

      setState(newState);
    });

    // Initial state
    const initialState = deck.getState();
    console.log(`[useDeck-${deckId}] Initial state - BPM: ${initialState.analysis.bpm}, status: ${initialState.analysis.status}`);
    lastBpm = initialState.analysis.bpm;
    lastStatus = initialState.analysis.status;
    lastTrackId = initialState.trackId;
    setState(initialState);

    return () => {
      console.log(`[useDeck-${deckId}] Unsubscribing from deck state changes`);
      unsubscribe();
    };
  }, [deckId]);

  const loadTrack = useCallback(
    async (trackId: string, url: string) => {
      await deckRef.current.loadTrack(trackId, url);
    },
    []
  );

  const play = useCallback(async () => {
    await deckRef.current.play();
  }, []);

  const pause = useCallback(() => {
    deckRef.current.pause();
  }, []);

  const stop = useCallback(() => {
    deckRef.current.stop();
  }, []);

  const cue = useCallback((cuePointSec?: number) => {
    deckRef.current.cue(cuePointSec);
  }, []);

  const seek = useCallback((positionSec: number) => {
    deckRef.current.seek(positionSec);
  }, []);

  const setVolume = useCallback((volume: number) => {
    deckRef.current.setVolume(volume);
  }, []);

  const scrub = useCallback(async (deltaSec: number) => {
    await deckRef.current.scrub(deltaSec);
  }, []);

  const nudge = useCallback(async (bendAmount: number) => {
    await deckRef.current.nudge(bendAmount);
  }, []);

  const releaseNudge = useCallback(() => {
    deckRef.current.releaseNudge();
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    deckRef.current.setPlaybackRate(rate);
  }, []);

  const resetPlaybackRate = useCallback(() => {
    deckRef.current.resetPlaybackRate();
  }, []);

  // Calculate current BPM (original BPM × playback rate)
  const originalBpm = state.analysis.bpm;
  const rawCurrentBpm = originalBpm !== null
    ? Math.round(originalBpm * state.playbackRate)
    : null;

  // IMPROVED: Debounce BPM display to prevent flickering during rapid tempo changes
  // Uses 150ms debounce which is fast enough to feel responsive but prevents flicker
  const debouncedBpm = useDebounce(rawCurrentBpm, 150);

  // Use raw value when not analyzing, debounced when adjusting tempo
  // This ensures BPM appears immediately after analysis but doesn't flicker during fader moves
  const currentBpm = state.analysis.status === "complete" ? debouncedBpm : rawCurrentBpm;

  return {
    state,
    loadTrack,
    play,
    pause,
    stop,
    cue,
    seek,
    setVolume,
    scrub,
    nudge,
    releaseNudge,
    setPlaybackRate,
    resetPlaybackRate,
    /** Current playhead in seconds */
    playhead: state.playheadSec,
    /** Track duration in seconds */
    duration: state.durationSec,
    /** Is currently playing */
    isPlaying: state.playState === "playing",
    /** Is track loaded */
    isLoaded: state.buffer !== null,
    /** Waveform data */
    waveform: state.analysis.waveform,
    /** Current BPM (adjusted for playback rate) */
    bpm: currentBpm,
    /** Current playback rate */
    playbackRate: state.playbackRate,
    /** Is analyzing audio */
    isAnalyzing: state.analysis.status === "analyzing",
  };
}

/** Result of a BPM sync operation */
export interface SyncResult {
  success: boolean;
  newRate?: number;
  sourceBpm?: number;
  targetBpm?: number;
  error?: string;
}

/**
 * Sync one deck's BPM to match the other deck.
 * Adjusts the source deck's playback rate to match the target deck's BPM.
 *
 * @param sourceDeckId - The deck to adjust (the one you pressed sync on)
 * @returns SyncResult with the new rate and details
 */
export function syncDeckBPM(sourceDeckId: "A" | "B"): SyncResult {
  const targetDeckId = sourceDeckId === "A" ? "B" : "A";

  const sourceDeck = decks[sourceDeckId];
  const targetDeck = decks[targetDeckId];

  if (!sourceDeck || !targetDeck) {
    console.warn(`[syncDeckBPM] Deck not initialized`);
    return { success: false, error: "Deck not initialized" };
  }

  const sourceState = sourceDeck.getState();
  const targetState = targetDeck.getState();

  const sourceBPM = sourceState.analysis.bpm;
  const targetBPM = targetState.analysis.bpm;

  if (!sourceBPM || !targetBPM) {
    console.warn(`[syncDeckBPM] BPM not detected - source: ${sourceBPM}, target: ${targetBPM}`);
    return {
      success: false,
      error: "BPM not detected",
      sourceBpm: sourceBPM ?? undefined,
      targetBpm: targetBPM ?? undefined,
    };
  }

  // Calculate the rate needed to match BPMs
  // If source is 120 BPM and target is 130 BPM, we need rate = 130/120 = 1.083
  const newRate = targetBPM / sourceBPM;

  // Check for extreme ratios that might indicate octave detection errors
  if (newRate > 1.5 || newRate < 0.67) {
    console.warn(`[syncDeckBPM] Extreme ratio detected (${newRate.toFixed(3)}), possible octave error`);
    // Still allow it but log warning
  }

  // Clamp to reasonable range (0.5x to 2.0x)
  const clampedRate = Math.max(0.5, Math.min(2.0, newRate));

  console.log(`[syncDeckBPM] Syncing Deck ${sourceDeckId} (${sourceBPM} BPM) to Deck ${targetDeckId} (${targetBPM} BPM) - rate: ${clampedRate.toFixed(3)}`);

  sourceDeck.setPlaybackRate(clampedRate);

  // Return the calculated rate so caller can use it immediately
  // This fixes the race condition where deck.playbackRate might not be updated yet
  return {
    success: true,
    newRate: clampedRate,
    sourceBpm: sourceBPM,
    targetBpm: targetBPM,
  };
}

/**
 * Dispose all deck instances (cleanup).
 */
export function disposeAllDecks(): void {
  if (decks.A) {
    decks.A.dispose();
    decks.A = null;
  }
  if (decks.B) {
    decks.B.dispose();
    decks.B = null;
  }
}
