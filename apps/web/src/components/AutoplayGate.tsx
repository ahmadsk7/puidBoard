"use client";

import { useState, useEffect, useCallback } from "react";
import {
  initAudioEngine,
  getAudioEngineState,
  subscribeToAudioEngine,
  isAutoplayAllowed,
} from "@/audio/engine";

export type AutoplayGateProps = {
  children: React.ReactNode;
  /** Custom message to show when blocked */
  message?: string;
};

/**
 * AutoplayGate - wraps content and shows an "Enable Audio" prompt if needed.
 * 
 * Web Audio requires user interaction before audio can play.
 * This component handles that UX by showing a button to unlock audio.
 */
export default function AutoplayGate({
  children,
  message = "Audio is blocked by your browser. Click to enable.",
}: AutoplayGateProps) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check initial autoplay state
  useEffect(() => {
    const state = getAudioEngineState();
    if (state.context?.state === "running") {
      setAudioEnabled(true);
    }

    // Subscribe to changes
    const unsubscribe = subscribeToAudioEngine((newState) => {
      setAudioEnabled(newState.context?.state === "running");
    });

    return unsubscribe;
  }, []);

  const handleEnableAudio = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await initAudioEngine();
      setAudioEnabled(true);
    } catch (err) {
      setError("Failed to enable audio. Please try again.");
      console.error("[AutoplayGate] Failed to init audio:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // If audio is already enabled, just render children
  if (audioEnabled) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "rgba(0, 0, 0, 0.8)",
        borderRadius: 12,
        textAlign: "center",
        maxWidth: 400,
        margin: "2rem auto",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#3b82f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "1rem",
          fontSize: "2rem",
        }}
      >
        🔊
      </div>

      <h2
        style={{
          margin: "0 0 0.5rem 0",
          color: "#fff",
          fontSize: "1.25rem",
          fontWeight: 600,
        }}
      >
        Enable Audio
      </h2>

      <p
        style={{
          margin: "0 0 1.5rem 0",
          color: "#9ca3af",
          fontSize: "0.875rem",
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>

      {error && (
        <p
          style={{
            margin: "0 0 1rem 0",
            color: "#ef4444",
            fontSize: "0.75rem",
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleEnableAudio}
        disabled={loading}
        style={{
          padding: "0.75rem 2rem",
          fontSize: "1rem",
          fontWeight: 600,
          background: loading ? "#6b7280" : "#22c55e",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {loading ? "Enabling..." : "Enable Audio"}
      </button>

      <p
        style={{
          marginTop: "1rem",
          color: "#6b7280",
          fontSize: "0.625rem",
        }}
      >
        This is required by your browser&apos;s autoplay policy.
      </p>
    </div>
  );
}

/**
 * Hook to check if audio is enabled.
 */
export function useAudioEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isAutoplayAllowed());

    const unsubscribe = subscribeToAudioEngine(() => {
      setEnabled(isAutoplayAllowed());
    });

    return unsubscribe;
  }, []);

  return enabled;
}
