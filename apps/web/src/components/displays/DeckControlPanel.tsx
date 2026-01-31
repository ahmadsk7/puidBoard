import React from "react";
import type { DeckPlayState } from "../../audio/deck";

export type DeckControlPanelProps = {
  bpm: number | null;
  playState: DeckPlayState;
  hasTrack: boolean;
  accentColor: string;
  onPlay: () => void;
  onPause: () => void;
  onCue: () => void;
  onSync?: () => void;
  isPlaying: boolean;
  audioEnabled: boolean;
};

/**
 * Deck Control Panel - Integrated LCD display with transport controls
 * Dimensions: 160x132px (matches SVG cutout exactly)
 */
export function DeckControlPanel({
  bpm,
  playState,
  hasTrack,
  accentColor,
  onPlay,
  onPause,
  onCue,
  onSync,
  isPlaying,
  audioEnabled,
}: DeckControlPanelProps) {
  // Status text based on play state
  const statusText =
    playState === "playing"
      ? "PLAYING"
      : playState === "paused"
      ? "PAUSED"
      : playState === "cued"
      ? "CUED"
      : hasTrack
      ? "READY"
      : "EMPTY";

  // LED color based on state
  const ledColor =
    playState === "playing"
      ? "#22c55e"
      : playState === "paused" || playState === "cued"
      ? "#f59e0b"
      : hasTrack
      ? "#3b82f6"
      : "#ef4444";

  return (
    <div
      style={{
        width: "160px",
        height: "132px",
        background: "#050508",
        border: "2px solid #1a1a1a",
        borderRadius: "16px",
        boxShadow: `
          inset 0 2px 4px rgba(0, 0, 0, 0.6),
          0 4px 12px rgba(0, 0, 0, 0.5),
          inset 0 0 20px ${accentColor}15
        `,
        padding: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        boxSizing: "border-box",
      }}
    >
      {/* BPM Display - Large and Prominent */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.4)",
          borderRadius: "6px",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: `1px solid ${bpm !== null ? accentColor : "#242424"}40`,
        }}
      >
        <div
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "#9ca3af",
          }}
        >
          BPM
        </div>
        <div
          style={{
            fontSize: "20px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: bpm !== null ? accentColor : "#6b7280",
            letterSpacing: "-0.02em",
          }}
        >
          {bpm !== null ? bpm : "---"}
        </div>
        {/* Status LED */}
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: ledColor,
            boxShadow: `0 0 8px ${ledColor}`,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Status and Pitch Info */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {/* Status */}
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: "#f0f0f0",
            letterSpacing: "0.05em",
            textAlign: "center",
          }}
        >
          {statusText}
        </div>

        {/* Pitch */}
        <div
          style={{
            fontSize: "9px",
            fontWeight: 600,
            fontFamily: "monospace",
            color: "#6b7280",
            textAlign: "center",
          }}
        >
          PITCH: +0.0%
        </div>
      </div>

      {/* Transport Controls - Integrated into LCD */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          justifyContent: "center",
          marginTop: "auto",
        }}
      >
        {/* Cue Button */}
        <button
          type="button"
          onClick={onCue}
          disabled={!hasTrack || !audioEnabled}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "6px",
            border: playState === "cued" ? `2px solid #ff6b35` : "2px solid #242424",
            background: playState === "cued" ? "rgba(255, 107, 53, 0.15)" : "rgba(0, 0, 0, 0.3)",
            cursor: hasTrack && audioEnabled ? "pointer" : "not-allowed",
            opacity: hasTrack && audioEnabled ? 1 : 0.4,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
            boxShadow: playState === "cued" ? `0 0 12px rgba(255, 107, 53, 0.3)` : "none",
          }}
          title="Cue"
        >
          <img
            src="/assets/dj-controls/buttons/cue-icon.svg"
            alt="Cue"
            style={{
              width: "28px",
              height: "28px",
              filter: playState === "cued" ? "brightness(1.2)" : "brightness(0.7)",
            }}
          />
        </button>

        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={!hasTrack || !audioEnabled}
          style={{
            width: "42px",
            height: "36px",
            borderRadius: "6px",
            border: isPlaying ? `2px solid #22c55e` : "2px solid #242424",
            background: isPlaying ? "rgba(34, 197, 94, 0.15)" : "rgba(0, 0, 0, 0.3)",
            cursor: hasTrack && audioEnabled ? "pointer" : "not-allowed",
            opacity: hasTrack && audioEnabled ? 1 : 0.4,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
            boxShadow: isPlaying ? `0 0 12px rgba(34, 197, 94, 0.3)` : "none",
          }}
          title={isPlaying ? "Pause" : "Play"}
        >
          <img
            src={
              isPlaying
                ? "/assets/dj-controls/buttons/pause-icon.svg"
                : "/assets/dj-controls/buttons/play-icon.svg"
            }
            alt={isPlaying ? "Pause" : "Play"}
            style={{
              width: "28px",
              height: "28px",
              filter: isPlaying ? "brightness(1.2)" : "brightness(0.7)",
            }}
          />
        </button>

        {/* Sync Button */}
        <button
          type="button"
          onClick={onSync}
          disabled={!hasTrack || !audioEnabled}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "6px",
            border: "2px solid #242424",
            background: "rgba(0, 0, 0, 0.3)",
            cursor: hasTrack && audioEnabled ? "pointer" : "not-allowed",
            opacity: hasTrack && audioEnabled ? 1 : 0.4,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
          }}
          title="Sync BPM"
        >
          <img
            src="/assets/dj-controls/buttons/sync-icon.svg"
            alt="Sync"
            style={{
              width: "28px",
              height: "28px",
              filter: "brightness(0.7)",
            }}
          />
        </button>
      </div>
    </div>
  );
}
