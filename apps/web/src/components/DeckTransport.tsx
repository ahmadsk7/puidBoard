"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeckState as ServerDeckState, ClientMutationEvent } from "@puid-board/shared";
import { useDeck, syncDeckBPM } from "@/audio/useDeck";
import { DeckControlPanel } from "./displays";
import { initAudioEngine } from "@/audio/engine";

export type DeckTransportProps = {
  /** Deck ID (A or B) */
  deckId: "A" | "B";
  /** Server deck state */
  serverState: ServerDeckState;
  /** Room ID for sending events */
  roomId: string;
  /** Client ID */
  clientId: string;
  /** Send event function */
  sendEvent: (e: ClientMutationEvent) => void;
  /** Get next sequence number */
  nextSeq: () => number;
  /** Accent color for this deck */
  accentColor: string;
  /** Queue items (for loading tracks) */
  queue: Array<{ id: string; trackId: string; title: string }>;
};

/**
 * Deck transport controls - integrated LCD panel with play/pause/cue controls
 */
export default function DeckTransport({
  deckId,
  serverState,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  accentColor,
}: DeckTransportProps) {
  const deck = useDeck(deckId);

  // Extract values for stable dependencies
  const localTrackId = deck.state.trackId;
  const { loadTrack } = deck;

  // Sync with server state - load track when server says to
  useEffect(() => {
    const serverTrackId = serverState.loadedTrackId;

    if (serverTrackId && serverTrackId !== localTrackId) {
      // Init audio first (will be no-op if already initialized)
      initAudioEngine().then(() => {
        // Fetch the track URL from the realtime server API
        const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

        fetch(`${realtimeUrl}/api/tracks/${serverTrackId}/url`)
          .then((res) => {
            if (!res.ok) throw new Error(`Failed to get track URL: ${res.status}`);
            return res.json();
          })
          .then((data) => {
            return loadTrack(serverTrackId, data.url);
          })
          .catch((err) => {
            console.error(`[DeckTransport-${deckId}] Failed to load track:`, err);
          });
      }).catch(() => {
        // Audio init failed, will retry on next user interaction
      });
    }
  }, [serverState.loadedTrackId, localTrackId, loadTrack, deckId]);

  // Sync play state with server
  const isLoaded = deck.isLoaded;
  const isPlaying = deck.isPlaying;
  const { play, pause, stop } = deck;

  useEffect(() => {
    if (!isLoaded) return;

    if (serverState.playState === "playing" && !isPlaying) {
      play();
    } else if (serverState.playState === "paused" && isPlaying) {
      pause();
    } else if (serverState.playState === "stopped" && isPlaying) {
      stop();
    }
  }, [serverState.playState, isLoaded, isPlaying, play, pause, stop]);

  // Sync playhead position with server (for DECK_SEEK events from other clients)
  const playhead = deck.playhead;
  const { seek, setPlaybackRate } = deck;

  useEffect(() => {
    if (!isLoaded) return;

    // Check if server playhead differs significantly from local playhead
    const playheadDiff = Math.abs(serverState.playheadSec - playhead);
    const shouldSync = playheadDiff > 0.5;

    if (shouldSync && !isPlaying) {
      seek(serverState.playheadSec);
    }
  }, [serverState.playheadSec, isLoaded, isPlaying, playhead, seek]);

  // Sync playback rate with server (for DECK_TEMPO_SET events from other clients)
  useEffect(() => {
    if (!isLoaded) return;

    // Only sync if server rate differs from local rate
    const localRate = deck.playbackRate;
    const serverRate = serverState.playbackRate;
    const rateDiff = Math.abs(serverRate - localRate);

    if (rateDiff > 0.001) {
      setPlaybackRate(serverRate);
    }
  }, [serverState.playbackRate, isLoaded, deck.playbackRate, setPlaybackRate]);

  // Send DECK_PLAY event
  const handlePlay = useCallback(async () => {
    sendEvent({
      type: "DECK_PLAY",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    // Play locally (auto-initializes audio on user interaction)
    if (deck.isLoaded) {
      await deck.play();
    }
  }, [sendEvent, roomId, clientId, nextSeq, deckId, deck]);

  // Send DECK_PAUSE event
  const handlePause = useCallback(() => {
    sendEvent({
      type: "DECK_PAUSE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    deck.pause();
  }, [sendEvent, roomId, clientId, nextSeq, deckId, deck]);

  // Send DECK_CUE event
  const handleCue = useCallback(async () => {
    sendEvent({
      type: "DECK_CUE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    deck.cue();
  }, [sendEvent, roomId, clientId, nextSeq, deckId, deck]);

  // Track if this deck is synced (rate !== 1.0)
  const [isSynced, setIsSynced] = useState(false);

  // Update sync state when playback rate changes
  useEffect(() => {
    const rate = deck.playbackRate;
    setIsSynced(Math.abs(rate - 1.0) > 0.001);
  }, [deck.playbackRate]);

  // Sync this deck's BPM to the other deck
  const handleSync = useCallback(() => {
    if (isSynced) {
      // Reset to 1.0 playback rate
      deck.resetPlaybackRate();
      setIsSynced(false);
      // Send tempo reset event to server
      sendEvent({
        type: "DECK_TEMPO_SET",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { deckId, playbackRate: 1.0 },
      });
    } else {
      const success = syncDeckBPM(deckId);
      if (success) {
        setIsSynced(true);
        // Send the new playback rate to server
        const newRate = deck.playbackRate;
        sendEvent({
          type: "DECK_TEMPO_SET",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: { deckId, playbackRate: newRate },
        });
      }
    }
  }, [deckId, isSynced, deck, sendEvent, roomId, clientId, nextSeq]);

  const hasTrack = deck.isLoaded || serverState.loadedTrackId !== null;

  return (
    <DeckControlPanel
      bpm={deck.bpm}
      playState={serverState.playState}
      hasTrack={hasTrack}
      accentColor={accentColor}
      onPlay={handlePlay}
      onPause={handlePause}
      onCue={handleCue}
      onSync={handleSync}
      isSynced={isSynced}
      isPlaying={isPlaying}
    />
  );
}
