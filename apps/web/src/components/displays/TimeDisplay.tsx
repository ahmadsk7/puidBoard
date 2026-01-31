import React from "react";

export type TimeDisplayProps = {
  currentTime: number; // in seconds
  duration: number; // in seconds
};

/**
 * Time Display - shows elapsed and remaining time
 */
export function TimeDisplay({ currentTime, duration }: TimeDisplayProps) {
  // Format time as M:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.floor(Math.abs(seconds) % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const elapsed = formatTime(currentTime);
  const remaining = duration > 0 ? `-${formatTime(duration - currentTime)}` : "-0:00";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        fontSize: "11px",
        fontFamily: "monospace",
        fontWeight: 500,
      }}
    >
      {/* Elapsed Time */}
      <div style={{ color: "#f0f0f0" }}>{elapsed}</div>

      {/* Remaining Time */}
      <div style={{ color: "#6b7280" }}>{remaining}</div>
    </div>
  );
}
