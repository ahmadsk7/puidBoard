"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { MixerState } from "@puid-board/shared";
import {
  applyMixerState,
  updateMixerParam,
  subscribeToClipping,
  initMixerGraph,
  isMixerGraphInitialized,
} from "./mixerGraph";
import { isAutoplayAllowed } from "./engine";

/**
 * Hook to sync MixerState from realtime server to audio graph.
 * 
 * This ensures that remote mixer changes (from other users)
 * are reflected in the local audio output.
 */
export function useMixerSync(mixerState: MixerState | null) {
  const lastJsonRef = useRef<string>("");

  useEffect(() => {
    if (!mixerState) return;
    if (!isAutoplayAllowed()) return;

    // Initialize mixer graph if needed
    if (!isMixerGraphInitialized()) {
      initMixerGraph();
    }

    // Apply state when it changes (compare JSON for deep equality)
    const json = JSON.stringify(mixerState);
    if (json !== lastJsonRef.current) {
      applyMixerState(mixerState);
      lastJsonRef.current = json;
    }
  }, [mixerState]);
}

/**
 * Hook to get clipping state.
 */
export function useClipping() {
  const [isClipping, setIsClipping] = useState(false);
  const [peakLevel, setPeakLevel] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToClipping((state) => {
      setIsClipping(state.isClipping);
      setPeakLevel(state.peakLevel);
    });

    return unsubscribe;
  }, []);

  return { isClipping, peakLevel };
}

/**
 * Hook to update a single mixer parameter.
 * Use for local optimistic updates before server ack.
 */
export function useMixerParam() {
  const updateParam = useCallback((controlId: string, value: number) => {
    if (!isMixerGraphInitialized()) {
      initMixerGraph();
    }
    updateMixerParam(controlId, value);
  }, []);

  return updateParam;
}
