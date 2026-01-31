"use client";

import { useCallback, useEffect } from "react";
import type { DeckState as ServerDeckState, ClientMutationEvent } from "@puid-board/shared";
import { useDeck } from "@/audio/useDeck";
import { useAudioEnabled } from "./AutoplayGate";

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

/** Format time as M:SS */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Deck transport controls (play/pause/cue + playhead display).
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

  // Sync play state with server (simplified - full sync requires PR 4.2)
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

  // Load first track from queue (demo)
  const handleLoadFromQueue = useCallback(() => {
    const firstQueued = queue.find((item) => 
      item.id !== serverState.loadedQueueItemId
    );
    
    if (firstQueued) {
      sendEvent({
        type: "DECK_LOAD",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: {
          deckId,
          trackId: firstQueued.trackId,
          queueItemId: firstQueued.id,
        },
      });
    }
  }, [queue, serverState.loadedQueueItemId, sendEvent, roomId, clientId, nextSeq, deckId]);

  const hasTrack = deck.isLoaded || serverState.loadedTrackId !== null;
  const isPlaying = deck.isPlaying;
  const playhead = deck.playhead;
  const duration = deck.duration || serverState.durationSec || 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        width: "100%",
      }}
    >
      {/* Playhead display */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          padding: "0 4px",
          fontFamily: "monospace",
          fontSize: "0.875rem",
        }}
      >
        <span style={{ color: "#fff" }}>{formatTime(playhead)}</span>
        <span style={{ color: "#6b7280" }}>{formatTime(duration)}</span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          height: 4,
          background: "#374151",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${duration > 0 ? (playhead / duration) * 100 : 0}%`,
            height: "100%",
            background: accentColor,
            transition: "width 0.1s linear",
          }}
        />
      </div>

      {/* Transport controls */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 4,
        }}
      >
        {/* Cue button */}
        <button
          type="button"
          onClick={handleCue}
          disabled={!hasTrack || !audioEnabled}
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            border: "none",
            background: serverState.playState === "cued" ? "#1a1a1a" : "#1f1f1f",
            cursor: hasTrack && audioEnabled ? "pointer" : "not-allowed",
            opacity: hasTrack && audioEnabled ? 1 : 0.5,
            padding: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src="/assets/dj-controls/buttons/cue-icon.svg"
            alt="Cue"
            style={{
              width: "100%",
              height: "100%",
              filter: serverState.playState === "cued" ? "brightness(1.2)" : "brightness(0.8)",
            }}
          />
        </button>

        {/* Play/Pause button */}
        <button
          type="button"
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={!hasTrack || !audioEnabled}
          style={{
            width: 48,
            height: 36,
            borderRadius: 4,
            border: "none",
            background: "#1f1f1f",
            cursor: hasTrack && audioEnabled ? "pointer" : "not-allowed",
            opacity: hasTrack && audioEnabled ? 1 : 0.5,
            padding: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={isPlaying ? "/assets/dj-controls/buttons/pause-icon.svg" : "/assets/dj-controls/buttons/play-icon.svg"}
            alt={isPlaying ? "Pause" : "Play"}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        </button>

        {/* Load button */}
        <button
          type="button"
          onClick={handleLoadFromQueue}
          disabled={queue.length === 0 || !audioEnabled}
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            border: "none",
            background: "#3b82f6",
            color: "#fff",
            fontSize: "0.625rem",
            fontWeight: 600,
            cursor: queue.length > 0 && audioEnabled ? "pointer" : "not-allowed",
            opacity: queue.length > 0 && audioEnabled ? 1 : 0.5,
          }}
          title="Load track from queue"
        >
          LOAD
        </button>
      </div>

      {/* Audio disabled warning */}
      {!audioEnabled && (
        <div
          style={{
            fontSize: "0.625rem",
            color: "#f59e0b",
            textAlign: "center",
          }}
        >
          Enable audio to play
        </div>
      )}
    </div>
  );
}
