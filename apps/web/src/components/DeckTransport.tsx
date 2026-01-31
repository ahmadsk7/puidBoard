"use client";

import { useCallback, useEffect } from "react";
import type { DeckState as ServerDeckState, ClientMutationEvent } from "@puid-board/shared";
import { useDeck } from "@/audio/useDeck";
import { useAudioEnabled } from "./AutoplayGate";
import { DeckControlPanel } from "./displays";

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
  const audioEnabled = useAudioEnabled();
  const deck = useDeck(deckId);

  // Sync with server state - load track when server says to
  useEffect(() => {
    if (!audioEnabled) return;

    const serverTrackId = serverState.loadedTrackId;
    const localTrackId = deck.state.trackId;

    if (serverTrackId && serverTrackId !== localTrackId) {
      // Fetch the track URL from the realtime server API
      const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

      fetch(`${realtimeUrl}/api/tracks/${serverTrackId}/url`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to get track URL: ${res.status}`);
          return res.json();
        })
        .then((data) => {
          // Load the track with the URL from the server
          return deck.loadTrack(serverTrackId, data.url);
        })
        .catch((err) => {
          console.error(`[DeckTransport-${deckId}] Failed to load track:`, err);
        });
    }
  }, [audioEnabled, serverState.loadedTrackId, deck, deckId]);

  // Sync play state with server
  useEffect(() => {
    if (!audioEnabled || !deck.isLoaded) return;

    if (serverState.playState === "playing" && !deck.isPlaying) {
      deck.play();
    } else if (serverState.playState === "paused" && deck.isPlaying) {
      deck.pause();
    } else if (serverState.playState === "stopped" && deck.isPlaying) {
      deck.stop();
    }
  }, [audioEnabled, serverState.playState, deck]);

  // Send DECK_PLAY event
  const handlePlay = useCallback(() => {
    sendEvent({
      type: "DECK_PLAY",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    // Also play locally for immediate feedback
    if (deck.isLoaded) {
      deck.play();
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
  const handleCue = useCallback(() => {
    sendEvent({
      type: "DECK_CUE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    deck.cue();
  }, [sendEvent, roomId, clientId, nextSeq, deckId, deck]);

  // Sync handler (placeholder for future BPM sync functionality)
  const handleSync = useCallback(() => {
    // TODO: Implement BPM sync between decks
    console.log(`[DeckTransport-${deckId}] Sync not yet implemented`);
  }, [deckId]);

  const hasTrack = deck.isLoaded || serverState.loadedTrackId !== null;
  const isPlaying = deck.isPlaying;

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
      isPlaying={isPlaying}
      audioEnabled={audioEnabled}
    />
  );
}
