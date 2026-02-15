"use client";

import { useEffect, useCallback, useState } from "react";
import SamplerButton from "./SamplerButton";
import {
  playSample,
  SLOT_KEYBINDS,
  SLOT_COLORS,
  SLOT_ICONS,
  loadDefaultSamples,
  type SampleSlot,
} from "@/audio/sampler";

export type SamplerPanelProps = {
  /** Optional: width to constrain the panel */
  width?: number;
};

/**
 * Sampler panel with 4 performance pads.
 * Handles keyboard events for R, T, Y, U keys.
 * Positioned below the FX control panel.
 */
export default function SamplerPanel({ width = 184 }: SamplerPanelProps) {
  // Calculate button size to fit 4 buttons border-to-border (no gaps)
  // Width should be exactly 4 * buttonSize
  const gap = 0;
  const buttonSize = Math.floor(width / 4); // 46px each for 184px width

  // Track which slot is currently pressed via keyboard (for visual feedback)
  const [pressedSlot, setPressedSlot] = useState<SampleSlot | null>(null);

  // Handle sample playback
  const handlePlaySample = useCallback((slot: SampleSlot) => {
    playSample(slot);
  }, []);

  // Load default samples on mount
  useEffect(() => {
    loadDefaultSamples().catch((error) => {
      console.error("[SamplerPanel] Failed to load default samples:", error);
    });
  }, []);

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
        setPressedSlot(slot);
        playSample(slot);
        // Clear the pressed state after a brief delay for visual feedback
        setTimeout(() => setPressedSlot(null), 150);
      }
    };

    console.log("[Sampler] Keyboard listener attached");
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      console.log("[Sampler] Keyboard listener removed");
      window.removeEventListener("keydown", handleKeyDown);
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
          externalPressed={pressedSlot === slot}
          icon={SLOT_ICONS[slot]}
        />
      ))}
    </div>
  );
}
