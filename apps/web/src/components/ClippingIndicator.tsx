"use client";

import { useClipping } from "@/audio/useMixer";

export type ClippingIndicatorProps = {
  /** Show as compact indicator or full meter */
  compact?: boolean;
};

/**
 * Visual indicator for audio clipping/headroom.
 * Shows when audio is approaching or exceeding 0dBFS.
 */
export default function ClippingIndicator({ compact = true }: ClippingIndicatorProps) {
  const { isClipping, peakLevel } = useClipping();

  // Convert peak to percentage (0-100, can exceed 100)
  const levelPercent = Math.min(peakLevel * 100, 120);

  // Color based on level
  const getColor = () => {
    if (isClipping || peakLevel > 0.99) return "#ef4444"; // Red - clipping
    if (peakLevel > 0.85) return "#f59e0b"; // Orange - warning
    if (peakLevel > 0.5) return "#22c55e"; // Green - good
    return "#6b7280"; // Gray - low
  };

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* Clip indicator dot */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isClipping ? "#ef4444" : "#374151",
            boxShadow: isClipping ? "0 0 8px #ef4444" : "none",
            transition: "all 0.1s",
          }}
          title={isClipping ? "CLIPPING!" : "No clipping"}
        />
        
        {/* Mini level bar */}
        <div
          style={{
            width: 40,
            height: 4,
            background: "#374151",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(levelPercent, 100)}%`,
              height: "100%",
              background: getColor(),
              transition: "width 0.05s, background 0.1s",
            }}
          />
        </div>
      </div>
    );
  }

  // Full meter display
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "0.5rem",
        background: "#1f2937",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: "0.625rem",
          color: "#9ca3af",
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        Level
      </div>

      {/* Vertical meter */}
      <div
        style={{
          width: 16,
          height: 60,
          background: "#374151",
          borderRadius: 2,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column-reverse",
        }}
      >
        <div
          style={{
            width: "100%",
            height: `${Math.min(levelPercent, 100)}%`,
            background: getColor(),
            transition: "height 0.05s, background 0.1s",
          }}
        />
      </div>

      {/* Clip indicator */}
      <div
        style={{
          width: 16,
          height: 6,
          borderRadius: 2,
          background: isClipping ? "#ef4444" : "#374151",
          boxShadow: isClipping ? "0 0 6px #ef4444" : "none",
          transition: "all 0.1s",
        }}
        title={isClipping ? "CLIPPING!" : "OK"}
      />

      {/* dB label */}
      <div
        style={{
          fontSize: "0.5rem",
          color: isClipping ? "#ef4444" : "#6b7280",
          fontFamily: "monospace",
        }}
      >
        {isClipping ? "CLIP" : "OK"}
      </div>
    </div>
  );
}
