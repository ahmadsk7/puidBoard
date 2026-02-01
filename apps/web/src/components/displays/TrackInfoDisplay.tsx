import React from "react";
import { DeckPlayState } from "../../audio/deck";

export type TrackInfoDisplayProps = {
  deckId: "A" | "B";
  title: string | null;
  playState: DeckPlayState;
  accentColor: string;
};

/**
 * Track Info Display - shows deck badge, track title, and status LED
 */
export function TrackInfoDisplay({
  deckId,
  title,
  playState,
  accentColor,
}: TrackInfoDisplayProps) {
  // Determine LED color based on play state
  const ledColor =
    playState === "playing"
      ? "#22c55e" // Green
      : playState === "paused" || playState === "cued"
      ? "#f59e0b" // Orange
      : title
      ? "#f59e0b" // Orange (loaded)
      : "#ef4444"; // Red (empty)

  // Truncate title to ~40 characters (more space without BPM)
  const displayTitle = title
    ? title.length > 40
      ? `${title.slice(0, 40)}...`
      : title
    : "No Track Loaded";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        minHeight: "24px",
      }}
    >
      {/* Deck Badge */}
      <div
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          background: accentColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#000000",
          fontWeight: 700,
          fontSize: "12px",
          flexShrink: 0,
        }}
      >
        {deckId}
      </div>

      {/* Track Title */}
      <div
        style={{
          flex: 1,
          fontSize: "12px",
          fontWeight: 500,
          color: title ? "#f0f0f0" : "#6b7280",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayTitle}
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
  );
}
