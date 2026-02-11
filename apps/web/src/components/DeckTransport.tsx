"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import type { DeckState as ServerDeckState, ClientMutationEvent } from "@puid-board/shared";
import { useDeck, syncDeckBPM } from "@/audio/useDeck";
// DISABLED: getDeck was used for seekSmooth during playback, now handled by DeckEngine
// import { getDeck } from "@/audio/useDeck";
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
  queue: Array<{
    id: string;
    trackId: string;
    title: string;
    url: string;
    source?: "upload" | "youtube";
    youtubeVideoId?: string | null;
  }>;
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

  // Get realtime URL for YouTube audio refresh
  const realtimeUrl =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001"
      : "http://localhost:3001";

  // Sync with server state - load track when server says to
  useEffect(() => {
    console.log(`[DeckTransport-${deckId}] TRACK LOAD SYNC EFFECT`);
    console.log(`[DeckTransport-${deckId}]   - serverState.loadedTrackId: ${serverState.loadedTrackId}`);
    console.log(`[DeckTransport-${deckId}]   - localTrackId: ${localTrackId}`);
    console.log(`[DeckTransport-${deckId}]   - queue length: ${queue.length}`);

    const serverTrackId = serverState.loadedTrackId;

    if (serverTrackId && serverTrackId !== localTrackId) {
      console.log(`[DeckTransport-${deckId}]   ✓ Server has different track, need to load`);

      // Find the queue item to get the URL
      const queueItem = queue.find((q) => q.trackId === serverTrackId);

      if (!queueItem) {
        console.error(`[DeckTransport-${deckId}] ✗ Track ${serverTrackId} not found in queue`);
        console.error(`[DeckTransport-${deckId}]   Available queue items:`, queue.map(q => q.trackId));
        return;
      }

      console.log(`[DeckTransport-${deckId}]   - URL: ${queueItem.url}`);
      console.log(`[DeckTransport-${deckId}]   - Source: ${queueItem.source}`);
      console.log(`[DeckTransport-${deckId}]   - youtubeVideoId: ${queueItem.youtubeVideoId}`);
      console.log(`[DeckTransport-${deckId}]   - Full queueItem:`, JSON.stringify(queueItem, null, 2));

      // Helper function to get the audio URL (for YouTube, returns videoId format)
      const getAudioUrl = async (): Promise<string> => {
        // For YouTube tracks, return in format "youtube:VIDEO_ID"
        const isYouTube = queueItem.source === "youtube" && queueItem.youtubeVideoId;
        console.log(`[DeckTransport-${deckId}]   - isYouTube check: source="${queueItem.source}" videoId="${queueItem.youtubeVideoId}" => ${isYouTube}`);

        if (isYouTube) {
          const youtubeUrl = `youtube:${queueItem.youtubeVideoId}`;
          console.log(`[DeckTransport-${deckId}]   - Using YouTube IFrame Player: ${youtubeUrl}`);
          return youtubeUrl;
        }
        console.log(`[DeckTransport-${deckId}]   - Using direct URL: ${queueItem.url}`);
        return queueItem.url;
      };

      // Init audio first (will be no-op if already initialized)
      initAudioEngine()
        .then(() => getAudioUrl())
        .then((audioUrl) => loadTrack(serverTrackId, audioUrl))
        .then(() => {
          console.log(`[DeckTransport-${deckId}]   ✓✓✓ TRACK LOADED SUCCESSFULLY ✓✓✓`);
        })
        .catch((err) => {
          console.error(`[DeckTransport-${deckId}] ✗✗✗ TRACK LOAD FAILED ✗✗✗`);
          console.error(`[DeckTransport-${deckId}] Error:`, err);
        });
    } else {
      if (!serverTrackId) {
        console.log(`[DeckTransport-${deckId}]   - Server has no track loaded`);
      } else if (serverTrackId === localTrackId) {
        console.log(`[DeckTransport-${deckId}]   - Track already loaded (same as local)`);
      }
    }
  }, [serverState.loadedTrackId, localTrackId, loadTrack, deckId, queue, realtimeUrl]);

  // Sync play state with server
  const isLoaded = deck.isLoaded;
  const isPlaying = deck.isPlaying;
  const { play, pause, stop } = deck;

  // Track if the track was just loaded (to prevent auto-play)
  const justLoadedRef = useRef(false);
  const prevLoadedTrackIdRef = useRef<string | null>(null);

  // Detect when a new track is loaded
  useEffect(() => {
    if (serverState.loadedTrackId !== prevLoadedTrackIdRef.current) {
      prevLoadedTrackIdRef.current = serverState.loadedTrackId;
      if (serverState.loadedTrackId) {
        justLoadedRef.current = true;
        // Reset after a short delay - if server says play within 500ms of load, it's auto-play
        const timer = setTimeout(() => {
          justLoadedRef.current = false;
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [serverState.loadedTrackId]);

  useEffect(() => {
    if (!isLoaded) return;

    // FIXED: Prevent auto-play when track is first loaded.
    // Only respond to play commands that come AFTER the track is fully loaded.
    // This prevents the race condition where server state says "playing" but
    // the track was just added to the queue.
    if (serverState.playState === "playing" && !isPlaying) {
      // Skip auto-play if track was just loaded
      if (justLoadedRef.current) {
        console.log(`[DeckTransport-${deckId}] Skipping auto-play - track just loaded`);
        return;
      }
      // For streaming tracks, check if the audio element is actually paused
      // This prevents race conditions where stale server state could restart paused audio
      const deckState = deck.state;
      if (deckState.isStreaming && deckState.audioElement?.paused) {
        console.log(`[DeckTransport-${deckId}] Skipping play sync - streaming audio is paused locally`);
        return;
      }
      play();
    } else if (serverState.playState === "paused" && isPlaying) {
      pause();
    } else if (serverState.playState === "stopped" && isPlaying) {
      stop();
    }
  }, [serverState.playState, isLoaded, isPlaying, play, pause, stop, deckId, deck.state]);

  // DISABLED: This playhead sync effect was fighting with BEACON_TICK PLL-based sync.
  // DeckEngine now handles all playhead synchronization via BEACON_TICK (250ms).
  // Keeping the ref for potential future use but removing the seek calls.
  // See: https://github.com/puidBoard/issues/XXX - "Multiple sync systems fighting"
  const { seek } = deck;
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

      // DISABLED: These seek calls were causing constant skipping during playback.
      // DeckEngine handles sync via BEACON_TICK PLL-based corrections.
      // Only seek when NOT playing (e.g., user scrubbed while paused on another client)
      // if (isPlaying) {
      //   // Get the deck instance and use seekSmooth for smooth playback correction
      //   const deckInstance = getDeck(deckId);
      //   deckInstance.seekSmooth(serverState.playheadSec, 50);
      // } else {
      //   seek(serverState.playheadSec);
      // }
      if (!isPlaying) {
        // Only sync seek when paused/stopped (user scrubbed on another client)
        seek(serverState.playheadSec);
      }
    }
  }, [serverState.playheadSec, isLoaded, isPlaying, seek, deckId]);

  // NOTE: Playback rate sync is now handled by DeckEngine via BEACON_TICK.
  // The old rate sync effect has been removed to prevent race conditions.
  // DeckEngine is the single writer for transport state and applies rate changes
  // smoothly via PLL-based drift correction.

  // Send detected BPM to server when analysis completes
  useEffect(() => {
    const bpm = deck.state.analysis.bpm;
    const status = deck.state.analysis.status;


    // Only send when analysis is complete and we have a valid BPM
    if (status === "complete" && bpm !== null && bpm > 0) {
      console.log(`[DeckTransport-${deckId}]   - Sending DECK_BPM_DETECTED event`);
      sendEvent({
        type: "DECK_BPM_DETECTED",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { deckId, bpm },
      });
      console.log(`[DeckTransport-${deckId}] ✓ DECK_BPM_DETECTED event sent`);
    } else {
      if (status !== "complete") {
      }
      if (bpm === null) {
      }
      if (bpm !== null && bpm <= 0) {
      }
    }
  }, [deck.state.analysis.bpm, deck.state.analysis.status, deckId, roomId, clientId, sendEvent, nextSeq]);

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

  // Calculate display BPM - prefer local analysis, fall back to server state
  const displayBpm = useMemo(() => {
    console.log(`[DeckTransport-${deckId}]   - deck.bpm (local): ${deck.bpm}`);
    console.log(`[DeckTransport-${deckId}]   - serverState.detectedBpm: ${serverState.detectedBpm}`);
    console.log(`[DeckTransport-${deckId}]   - deck.playbackRate: ${deck.playbackRate}`);

    // Local analysis is complete - use it (most accurate for this client)
    if (deck.bpm !== null) {
      console.log(`[DeckTransport-${deckId}]   ✓ Using local BPM: ${deck.bpm}`);
      return deck.bpm;
    }

    // Fall back to server-stored BPM (from another client's analysis)
    const serverBpm = serverState.detectedBpm;
    if (serverBpm !== null) {
      // Apply current playback rate to server BPM
      const adjustedBpm = Math.round(serverBpm * deck.playbackRate);
      console.log(`[DeckTransport-${deckId}]   ✓ Using server BPM: ${serverBpm} × ${deck.playbackRate} = ${adjustedBpm}`);
      return adjustedBpm;
    }

    console.log(`[DeckTransport-${deckId}]   ✗ No BPM available (local or server)`);
    return null;
  }, [deck.bpm, serverState.detectedBpm, deck.playbackRate, deckId]);

  return (
    <DeckControlPanel
      bpm={displayBpm}
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
