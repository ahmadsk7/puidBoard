"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import type { DeckState as ServerDeckState, ClientMutationEvent } from "@puid-board/shared";
import { useDeck, syncDeckBPM, getDeck } from "@/audio/useDeck";
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
  queue: Array<{ id: string; trackId: string; title: string; url: string }>;
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
  queue,
}: DeckTransportProps) {
  const deck = useDeck(deckId);

  // Extract values for stable dependencies
  const localTrackId = deck.state.trackId;
  const { loadTrack } = deck;

  // Sync with server state - load track when server says to
  useEffect(() => {
    const serverTrackId = serverState.loadedTrackId;

    if (serverTrackId && serverTrackId !== localTrackId) {
      // Find the queue item to get the URL
      const queueItem = queue.find((q) => q.trackId === serverTrackId);

      if (!queueItem) {
        console.error(`[DeckTransport-${deckId}] Track ${serverTrackId} not found in queue`);
        return;
      }

      // Init audio first (will be no-op if already initialized)
      initAudioEngine().then(() => {
        // Use URL directly from queue item (no API call needed)
        console.log(`[DeckTransport-${deckId}] Loading track from queue: ${queueItem.title}`);
        return loadTrack(serverTrackId, queueItem.url);
      }).catch((err) => {
        console.error(`[DeckTransport-${deckId}] Failed to load track:`, err);
      });
    }
  }, [serverState.loadedTrackId, localTrackId, loadTrack, deckId, queue]);

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
  const { seek, setPlaybackRate } = deck;
  // Track the last server playhead we synced to (for SEEK events)
  const lastSyncedPlayheadRef = useRef(serverState.playheadSec);

  useEffect(() => {
    if (!isLoaded) return;

    // Detect if this is a SEEK event from another client
    // (server playhead jumped significantly from the last known server playhead)
    const serverPlayheadJumped = Math.abs(serverState.playheadSec - lastSyncedPlayheadRef.current) > 0.3;

    if (serverPlayheadJumped) {
      console.log(`[DeckTransport-${deckId}] Server playhead jumped: ${lastSyncedPlayheadRef.current.toFixed(2)}s -> ${serverState.playheadSec.toFixed(2)}s`);
      lastSyncedPlayheadRef.current = serverState.playheadSec;

      // IMPROVED: Sync during playback too, not just when paused
      // Use seekSmooth for playing tracks to avoid audio glitches
      if (isPlaying) {
        // Get the deck instance and use seekSmooth for smooth playback correction
        const deckInstance = getDeck(deckId);
        deckInstance.seekSmooth(serverState.playheadSec, 50);
      } else {
        seek(serverState.playheadSec);
      }
    }
  }, [serverState.playheadSec, isLoaded, isPlaying, seek, deckId]);

  // Track the last server playback rate we synced to
  // This prevents overriding local tempo changes while waiting for server confirmation
  const lastSyncedServerRateRef = useRef(serverState.playbackRate);

  // Sync playback rate with server (for DECK_TEMPO_SET events from OTHER clients)
  // FIXED: Only sync when SERVER rate actually changes, not when local rate changes
  // This prevents the race condition where local tempo changes get overwritten
  useEffect(() => {
    if (!isLoaded) return;

    const serverRate = serverState.playbackRate;
    const lastSyncedRate = lastSyncedServerRateRef.current;
    const localRate = deck.playbackRate;

    // Only sync if the SERVER rate has changed since our last sync
    // This ignores local rate changes and only responds to server updates
    const serverRateChanged = Math.abs(serverRate - lastSyncedRate) > 0.001;

    if (serverRateChanged) {
      console.log(`[DeckTransport-${deckId}] Server rate changed: ${lastSyncedRate.toFixed(3)} -> ${serverRate.toFixed(3)} (local: ${localRate.toFixed(3)})`);
      lastSyncedServerRateRef.current = serverRate;
      setPlaybackRate(serverRate);
    }
  }, [serverState.playbackRate, isLoaded, setPlaybackRate, deckId, deck.playbackRate]);

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
      // FIXED: Use the returned rate from syncDeckBPM to avoid race condition
      const result = syncDeckBPM(deckId);
      if (result.success && result.newRate !== undefined) {
        setIsSynced(true);
        // Use the rate returned by syncDeckBPM, not deck.playbackRate
        // This avoids the race condition where state hasn't updated yet
        sendEvent({
          type: "DECK_TEMPO_SET",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: { deckId, playbackRate: result.newRate },
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
      playbackRate={deck.playbackRate}
    />
  );
}
