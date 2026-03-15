"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import SamplerButton from "./SamplerButton";
import {
  playSample,
  SLOT_KEYBINDS,
  SLOT_COLORS,
  SLOT_ICONS,
  loadDefaultSamples,
  loadCustomSample,
  type SampleSlot,
} from "@/audio/sampler";
import type { ClientMutationEvent } from "@puid-board/shared";
import { getRealtimeClient } from "@/realtime/client";

export type SamplerPanelProps = {
  /** Optional: width to constrain the panel */
  width?: number;
  /** Room ID for sending events */
  roomId?: string;
  /** Client ID */
  clientId?: string;
  /** Send event function */
  sendEvent?: (e: ClientMutationEvent) => void;
  /** Get next sequence number */
  nextSeq?: () => number;
  /** Room sampler state from snapshot — for auto-loading custom sounds on join */
  samplerState?: { slots: Array<{ url: string | null; name: string; isCustom: boolean }> };
};

/**
 * Sampler panel with 4 performance pads.
 * Handles keyboard events for R, T, Y, U keys.
 * Positioned below the FX control panel.
 */
export default function SamplerPanel({ width = 184, roomId, clientId, sendEvent, nextSeq, samplerState }: SamplerPanelProps) {
  // Calculate button size to fit 4 buttons border-to-border (no gaps)
  // Width should be exactly 4 * buttonSize
  const gap = 0;
  const buttonSize = Math.floor(width / 4); // 46px each for 184px width

  // Track which slots are currently pressed (supports simultaneous local + remote)
  const [pressedSlots, setPressedSlots] = useState<Set<SampleSlot>>(new Set());
  const timersRef = useRef<Map<SampleSlot, ReturnType<typeof setTimeout>>>(new Map());

  const flashSlot = useCallback((slot: SampleSlot) => {
    // Clear any existing timer for this slot
    const existing = timersRef.current.get(slot);
    if (existing) clearTimeout(existing);

    setPressedSlots((prev) => new Set(prev).add(slot));
    const timer = setTimeout(() => {
      setPressedSlots((prev) => {
        const next = new Set(prev);
        next.delete(slot);
        return next;
      });
      timersRef.current.delete(slot);
    }, 150);
    timersRef.current.set(slot, timer);
  }, []);

  // Handle sample playback: play locally first (optimistic), then broadcast
  const handlePlaySample = useCallback((slot: SampleSlot) => {
    // Play locally immediately
    playSample(slot);
    // Visual feedback
    flashSlot(slot);
    // Broadcast to other clients
    if (sendEvent && roomId && clientId && nextSeq) {
      sendEvent({
        type: "SAMPLER_PLAY",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { slot },
      });
    }
  }, [sendEvent, roomId, clientId, nextSeq, flashSlot]);

  // Subscribe to remote sampler play events for visual feedback
  useEffect(() => {
    const client = getRealtimeClient();
    return client.onSamplerPlay((slot) => {
      flashSlot(slot);
    });
  }, [flashSlot]);

  // Load default samples on mount, then overlay any custom sounds from room state
  useEffect(() => {
    const init = async () => {
      await loadDefaultSamples();

      // Auto-load custom sounds from room snapshot
      if (samplerState) {
        for (let i = 0; i < samplerState.slots.length; i++) {
          const slot = samplerState.slots[i];
          if (slot && slot.isCustom && slot.url) {
            try {
              await loadCustomSample(i as 0 | 1 | 2 | 3, slot.url, slot.name);
            } catch (err) {
              console.warn(`[SamplerPanel] Failed to load custom sample for slot ${i}:`, err);
            }
          }
        }
      }
    };

    init().catch((error) => {
      console.error("[SamplerPanel] Failed to initialize samples:", error);
    });
  }, []); // Empty deps — only run on mount

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Use e.code for more reliable detection (KeyR, KeyT, KeyY, KeyU)
      const codeMap: Record<string, SampleSlot> = {
        KeyR: 0,
        KeyT: 1,
        KeyY: 2,
        KeyU: 3,
      };

      const slot = codeMap[e.code];

      if (slot !== undefined) {
        console.log(`[Sampler] Key pressed: ${e.code} -> Slot ${slot}`);
        e.preventDefault();
        handlePlaySample(slot);
      }
    };

    console.log("[Sampler] Keyboard listener attached");
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      console.log("[Sampler] Keyboard listener removed");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handlePlaySample]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const slots: SampleSlot[] = [0, 1, 2, 3];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap,
        width,
        paddingTop: 0,
      }}
    >
      {slots.map((slot) => (
        <SamplerButton
          key={slot}
          keybind={SLOT_KEYBINDS[slot]}
          color={SLOT_COLORS[slot]}
          onClick={() => handlePlaySample(slot)}
          size={buttonSize}
          externalPressed={pressedSlots.has(slot)}
          icon={SLOT_ICONS[slot]}
        />
      ))}
    </div>
  );
}
