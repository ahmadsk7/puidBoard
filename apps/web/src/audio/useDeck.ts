"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Deck, DeckState } from "./deck";

/** Singleton deck instances */
const decks: { A: Deck | null; B: Deck | null } = { A: null, B: null };

/**
 * Get or create a deck instance.
 */
function getDeck(deckId: "A" | "B"): Deck {
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
    
    // Subscribe to state changes
    const unsubscribe = deck.subscribe((newState) => {
      setState(newState);
    });

    // Initial state
    setState(deck.getState());

    return () => {
      unsubscribe();
    };
  }, [deckId]);

  const loadTrack = useCallback(
    async (trackId: string, url: string) => {
      await deckRef.current.loadTrack(trackId, url);
    },
    []
  );

  const play = useCallback(() => {
    deckRef.current.play();
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

  return {
    state,
    loadTrack,
    play,
    pause,
    stop,
    cue,
    seek,
    setVolume,
    /** Current playhead in seconds */
    playhead: state.playheadSec,
    /** Track duration in seconds */
    duration: state.durationSec,
    /** Is currently playing */
    isPlaying: state.playState === "playing",
    /** Is track loaded */
    isLoaded: state.buffer !== null,
    /** Waveform data */
    waveform: state.analysis?.waveform ?? null,
    /** Detected BPM */
    bpm: state.analysis?.bpm ?? null,
    /** Is analyzing audio */
    isAnalyzing: state.analysis?.status === "analyzing",
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
