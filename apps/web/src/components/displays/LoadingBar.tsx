import React from "react";
import type { LoadingState } from "../../audio/deck";

export type LoadingBarProps = {
  loading: LoadingState;
  accentColor: string;
};

/**
 * LoadingBar - displays YouTube track loading progress
 * Shows different stages: extracting, downloading, decoding, error
 */
export function LoadingBar({ loading, accentColor }: LoadingBarProps) {
  // Stage label mapping
  const stageLabels: Record<string, string> = {
    extracting: "Extracting audio...",
    downloading: `Downloading ${Math.round(loading.progress * 100)}%`,
    decoding: "Decoding audio...",
    analyzing: "Analyzing...",
    error: loading.error || "Error loading track",
  };

  const label = stageLabels[loading.stage] || "";
  const isIndeterminate = loading.stage === "extracting" || loading.stage === "decoding";
  const isError = loading.stage === "error";

  return (
    <>
      <style jsx>{`
        @keyframes loadingSlide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(400%);
          }
        }
      `}</style>

      <div style={{
        width: "100%",
        height: "60px", // Same height as WaveformDisplay
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.3)",
        borderRadius: "4px",
        gap: "8px",
      }}>
        {/* Stage label */}
        <div style={{
          fontSize: "11px",
          fontWeight: 600,
          color: isError ? "#ef4444" : "#9ca3af",
          fontFamily: "monospace",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {label}
        </div>

        {/* Progress bar track */}
        {!isError && (
          <div style={{
            width: "80%",
            height: "4px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "2px",
            overflow: "hidden",
            position: "relative",
          }}>
            <div style={{
              height: "100%",
              background: accentColor,
              borderRadius: "2px",
              width: isIndeterminate ? "30%" : `${loading.progress * 100}%`,
              transition: isIndeterminate ? "none" : "width 0.3s ease",
              animation: isIndeterminate ? "loadingSlide 1.5s infinite ease-in-out" : "none",
            }} />
          </div>
        )}
      </div>
    </>
  );
}
