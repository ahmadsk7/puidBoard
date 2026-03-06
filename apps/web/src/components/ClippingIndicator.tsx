"use client";

import { useRef, useEffect } from "react";
import { useClipping } from "@/audio/useMixer";

/**
 * LED-style clipping indicator for the master output.
 * Green = normal, Orange = hot (>0.9), Red = clipping (>0.99).
 * Red holds for 500ms after last clip event.
 */
export default function ClippingIndicator() {
  const { isClipping, peakLevel } = useClipping();
  const lastClipRef = useRef(0);
  const holdingRedRef = useRef(false);

  useEffect(() => {
    if (isClipping) {
      lastClipRef.current = Date.now();
      holdingRedRef.current = true;
    }
  }, [isClipping]);

  // Determine if we're in red hold period
  const now = Date.now();
  const inRedHold = holdingRedRef.current && now - lastClipRef.current < 500;
  if (!inRedHold) {
    holdingRedRef.current = false;
  }

  const showRed = isClipping || inRedHold;
  const showOrange = !showRed && peakLevel > 0.9;

  const color = showRed ? "#ef4444" : showOrange ? "#f59e0b" : "#22c55e";
  const glow = showRed
    ? "0 0 8px 2px rgba(239, 68, 68, 0.6)"
    : showOrange
    ? "0 0 6px 1px rgba(245, 158, 11, 0.4)"
    : "0 0 4px 1px rgba(34, 197, 94, 0.3)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <div
        style={{
          fontSize: "7px",
          color: "#6b7280",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        CLIP
      </div>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          boxShadow: glow,
          transition: showRed ? "none" : "all 0.15s ease",
          border: "1px solid rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}
