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

  // Extract values for stable dependencies
  const localTrackId = deck.state.trackId;
  const { loadTrack } = deck;

  // Sync with server state - load track when server says to
  useEffect(() => {
    if (!audioEnabled) return;

    const serverTrackId = serverState.loadedTrackId;

    if (serverTrackId && serverTrackId !== localTrackId) {
      console.log(`[DeckTransport-${deckId}] Loading track ${serverTrackId} (current: ${localTrackId})`);

      // Fetch the track URL from the realtime server API
      const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

      fetch(`${realtimeUrl}/api/tracks/${serverTrackId}/url`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to get track URL: ${res.status}`);
          return res.json();
        })
        .then((data) => {
          // Load the track with the URL from the server
          console.log(`[DeckTransport-${deckId}] Fetched URL for ${serverTrackId}, loading...`);
          return loadTrack(serverTrackId, data.url);
        })
        .catch((err) => {
          console.error(`[DeckTransport-${deckId}] Failed to load track:`, err);
        });
    }
  }, [audioEnabled, serverState.loadedTrackId, localTrackId, loadTrack, deckId]);

  // Sync play state with server
  const isLoaded = deck.isLoaded;
  const isPlaying = deck.isPlaying;
  const { play, pause, stop } = deck;

  useEffect(() => {
    if (!audioEnabled || !isLoaded) return;

    if (serverState.playState === "playing" && !isPlaying) {
      console.log(`[DeckTransport-${deckId}] Syncing play state: playing`);
      play();
    } else if (serverState.playState === "paused" && isPlaying) {
      console.log(`[DeckTransport-${deckId}] Syncing play state: paused`);
      pause();
    } else if (serverState.playState === "stopped" && isPlaying) {
      console.log(`[DeckTransport-${deckId}] Syncing play state: stopped`);
      stop();
    }
  }, [audioEnabled, serverState.playState, isLoaded, isPlaying, play, pause, stop, deckId]);

  // Sync playhead position with server (for DECK_SEEK events from other clients)
  const playhead = deck.playhead;
  const { seek } = deck;

  useEffect(() => {
    if (!audioEnabled || !isLoaded) return;

    // Check if server playhead differs significantly from local playhead
    // Only sync if difference is > 0.5 seconds to avoid constant corrections
    const playheadDiff = Math.abs(serverState.playheadSec - playhead);
    const shouldSync = playheadDiff > 0.5;

    if (shouldSync && !isPlaying) {
      // Only auto-sync when paused/stopped to avoid disrupting playback
      console.log(`[DeckTransport-${deckId}] Syncing playhead: ${serverState.playheadSec.toFixed(2)}s (was ${playhead.toFixed(2)}s)`);
      seek(serverState.playheadSec);
    }
  }, [audioEnabled, serverState.playheadSec, isLoaded, isPlaying, playhead, seek, deckId]);

  // Send DECK_PLAY event
  const handlePlay = useCallback(async () => {
    sendEvent({
      type: "DECK_PLAY",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId },
    });
    // Also play locally for immediate feedback (auto-initializes audio)
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
