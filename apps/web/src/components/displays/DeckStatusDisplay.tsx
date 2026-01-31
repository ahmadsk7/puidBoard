import React from "react";
import type { DeckPlayState } from "../../audio/deck";

export type DeckStatusDisplayProps = {
  bpm: number | null;
  playState: DeckPlayState;
  hasTrack: boolean;
  accentColor: string;
};

/**
 * Deck Status LCD Display - shows BPM, sync status, and playback mode
 */
export function DeckStatusDisplay({
  bpm,
  playState,
  hasTrack,
  accentColor,
}: DeckStatusDisplayProps) {
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
        background: "#050508",
        border: "2px solid #1a1a1a",
        borderRadius: "6px",
        boxShadow: `
          inset 0 2px 4px rgba(0, 0, 0, 0.6),
          0 4px 12px rgba(0, 0, 0, 0.5),
          inset 0 0 20px ${accentColor}15
        `,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: "100%",
      }}
    >
      {/* BPM Display */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
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
            fontSize: "16px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: bpm !== null ? accentColor : "#6b7280",
          }}
        >
          {bpm !== null ? bpm : "---"}
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          height: "1px",
          background: "#242424",
          margin: "2px 0",
        }}
      />

      {/* Status Display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: "#f0f0f0",
            letterSpacing: "0.05em",
          }}
        >
          {statusText}
        </div>
        {/* Status LED */}
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: ledColor,
            boxShadow: `0 0 8px ${ledColor}`,
          }}
        />
      </div>

      {/* Tempo/Pitch Display */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: "4px",
          padding: "3px 6px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: "#6b7280",
          }}
        >
          PITCH: +0.0%
        </div>
      </div>
    </div>
  );
}
