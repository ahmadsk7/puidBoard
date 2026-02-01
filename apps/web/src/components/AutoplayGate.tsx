"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
 * AutoplayGate - auto-enables audio on first user interaction.
 * 
 * Web Audio requires user interaction before audio can play.
 * This component silently initializes audio on first click/keypress.
 */
export default function AutoplayGate({
  children,
}: AutoplayGateProps) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const attemptedRef = useRef(false);

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

  // Auto-enable audio on first user interaction
  const handleInteraction = useCallback(async () => {
    if (attemptedRef.current || audioEnabled) return;
    attemptedRef.current = true;

    try {
      await initAudioEngine();
      setAudioEnabled(true);
      console.log("[AutoplayGate] Audio enabled on user interaction");
    } catch (err) {
      console.warn("[AutoplayGate] Failed to init audio:", err);
      // Reset so user can try again
      attemptedRef.current = false;
    }
  }, [audioEnabled]);

  // Set up global listeners
  useEffect(() => {
    if (audioEnabled) return;

    const events = ["click", "keydown", "touchstart"];
    events.forEach((event) => {
      document.addEventListener(event, handleInteraction, { once: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleInteraction);
      });
    };
  }, [audioEnabled, handleInteraction]);

  // Always render children - audio will auto-enable on interaction
  return <>{children}</>;
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
