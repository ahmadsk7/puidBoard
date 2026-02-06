import React, { useMemo } from "react";
import { WaveformData } from "../../audio/analysis/waveformGenerator";

export type WaveformDisplayProps = {
  waveform: WaveformData | null;
  progress: number; // 0-1
  accentColor: string;
  isPlaying: boolean;
  isLoading?: boolean;
  hotCuePosition?: number | null; // position in seconds, or null if no hot cue set
  duration?: number; // track duration in seconds, needed to calculate hot cue position
};

/**
 * Waveform Display - shows real audio waveform with playhead
 */
export function WaveformDisplay({
  waveform,
  progress,
  accentColor,
  isPlaying,
  isLoading = false,
  hotCuePosition = null,
  duration = 0,
}: WaveformDisplayProps) {
  // Calculate bar heights (memoized to prevent recalculation on every render)
  const bars = useMemo(() => {
    if (!waveform) {
      // Empty state: flat bars
      return Array(120).fill(0.1);
    }

    // Downsample to fit display width (120 bars for ~240px width with 2px bars)
    const displayBars = 120;
    const step = waveform.bucketCount / displayBars;
    const result: number[] = [];

    for (let i = 0; i < displayBars; i++) {
      const index = Math.floor(i * step);
      result.push(waveform.peaks[index] ?? 0);
    }

    return result;
  }, [waveform]);

  const playheadPosition = progress * bars.length;

  if (isLoading) {
    return (
      <div
        style={{
          width: "100%",
          height: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: "4px",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: `linear-gradient(90deg, transparent 0%, ${accentColor}20 50%, transparent 100%)`,
            animation: "shimmer 1.5s infinite",
          }}
        />
        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "60px",
        display: "flex",
        alignItems: "center",
        gap: "1px",
        background: "rgba(0, 0, 0, 0.3)",
        borderRadius: "4px",
        padding: "4px",
        position: "relative",
      }}
    >
      {bars.map((peak, index) => {
        const isPlayed = index < playheadPosition;
        const height = Math.max(peak * 100, 4); // Min 4% height
        const opacity = isPlayed ? 1 : 0.4;

        return (
          <div
            key={index}
            style={{
              flex: 1,
              height: `${height}%`,
              background: accentColor,
              opacity,
              borderRadius: "1px",
              transition: isPlaying ? "none" : "opacity 0.2s ease",
            }}
          />
        );
      })}

      {/* Hot Cue Marker */}
      {hotCuePosition !== null && duration > 0 && (
        <div
          style={{
            position: "absolute",
            left: `${(hotCuePosition / duration) * 100}%`,
            top: 0,
            bottom: 0,
            width: "3px",
            background: "#FF3B3B", // Red to match hot cue pad color
            boxShadow: `0 0 8px #FF3B3B, 0 0 4px #FF3B3B`,
            pointerEvents: "none",
            opacity: 0.85,
            zIndex: 1,
          }}
          title={`Hot Cue: ${hotCuePosition.toFixed(2)}s`}
        />
      )}

      {/* Playhead */}
      <div
        style={{
          position: "absolute",
          left: `${progress * 100}%`,
          top: 0,
          bottom: 0,
          width: "2px",
          background: "#ffffff",
          boxShadow: `0 0 8px #ffffff, 0 0 4px ${accentColor}`,
          pointerEvents: "none",
          transition: isPlaying ? "none" : "left 0.1s ease",
          zIndex: 2,
        }}
      />
    </div>
  );
}
