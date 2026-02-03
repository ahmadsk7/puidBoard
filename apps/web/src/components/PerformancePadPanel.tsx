"use client";

import { memo, useCallback, useEffect, useState, useRef } from "react";
import PerformancePadButton, { type PadFunction } from "./PerformancePadButton";
import { useDeck } from "@/audio/useDeck";

export type PerformancePadPanelProps = {
  deckId: "A" | "B";
  /** Keybinds for the 4 pads (top-left, top-right, bottom-left, bottom-right) */
  keybinds: [string, string, string, string];
};

// Pad functions in order: HOT CUE, LOOP, ROLL, JUMP
const PAD_FUNCTIONS: [PadFunction, PadFunction, PadFunction, PadFunction] = ["hotcue", "loop", "roll", "jump"];

// Colors for each pad
const PAD_COLORS: [string, string, string, string] = [
  "#FF3B3B", // Pad 1: Hot Cue - Red
  "#FF9F1C", // Pad 2: Loop - Orange
  "#3B82F6", // Pad 3: Roll - Blue
  "#8B5CF6", // Pad 4: Jump - Purple
];

/**
 * Performance pad panel with 4 pads in 2x2 grid.
 * Each pad has a fixed function: Hot Cue, Loop, Roll, Jump.
 */
const PerformancePadPanel = memo(function PerformancePadPanel({
  deckId,
  keybinds,
}: PerformancePadPanelProps) {
  const deck = useDeck(deckId);
  const [keyPressed, setKeyPressed] = useState<Record<string, boolean>>({});

  // Storage for hot cue points (pad index -> position in seconds)
  const hotCuesRef = useRef<Record<number, number | null>>({ 0: null });

  // Loop state
  const loopStateRef = useRef<{
    enabled: boolean;
    startPos: number | null;
    length: number; // in bars: 1, 2, 4, or 8
  }>({
    enabled: false,
    startPos: null,
    length: 4,
  });

  // Loop roll state
  const loopRollStateRef = useRef<{
    active: boolean;
    returnPos: number | null;
  }>({
    active: false,
    returnPos: null,
  });

  // --- PAD 1: HOT CUE ---
  const handleHotCueClick = useCallback(() => {
    if (!deck.isLoaded) return;

    const cuePos = hotCuesRef.current[0];
    if (cuePos !== null && cuePos !== undefined) {
      // Cue exists - jump to it
      console.log(`[PerformancePad-${deckId}] Hot Cue: Jump to ${cuePos.toFixed(2)}s`);
      deck.seek(cuePos);
    } else {
      // No cue set - set it at current position
      const currentPos = deck.playhead;
      hotCuesRef.current[0] = currentPos;
      console.log(`[PerformancePad-${deckId}] Hot Cue: Set at ${currentPos.toFixed(2)}s`);
    }
  }, [deck, deckId]);

  const handleHotCueHold = useCallback(() => {
    if (!deck.isLoaded) return;

    // Hold to override/re-set cue at current position (safer than delete)
    const currentPos = deck.playhead;
    hotCuesRef.current[0] = currentPos;
    console.log(`[PerformancePad-${deckId}] Hot Cue: Override/re-set at ${currentPos.toFixed(2)}s`);
  }, [deck, deckId]);

  const handleHotCueRelease = useCallback(() => {
    // No action on release for hot cue
  }, []);

  // --- PAD 2: LOOP ---
  const handleLoopClick = useCallback(() => {
    if (!deck.isLoaded) return;

    const loopState = loopStateRef.current;

    if (!loopState.enabled) {
      // Enable loop at current position
      loopState.enabled = true;
      loopState.startPos = deck.playhead;
      console.log(`[PerformancePad-${deckId}] Loop: Enabled at ${deck.playhead.toFixed(2)}s, length=${loopState.length} bars`);

      // TODO: Implement actual looping in Deck class
      // For now, this is a placeholder
    } else {
      // Disable loop
      loopState.enabled = false;
      loopState.startPos = null;
      console.log(`[PerformancePad-${deckId}] Loop: Disabled`);
    }
  }, [deck, deckId]);

  const handleLoopHold = useCallback(() => {
    // Cycle loop length: 1 -> 2 -> 4 -> 8 -> 1
    const loopState = loopStateRef.current;
    const lengths = [1, 2, 4, 8] as const;
    const currentIndex = lengths.indexOf(loopState.length as typeof lengths[number]);
    const nextIndex = (currentIndex + 1) % lengths.length;
    loopState.length = lengths[nextIndex]!;
    console.log(`[PerformancePad-${deckId}] Loop: Length set to ${loopState.length} bars`);
  }, [deckId]);

  const handleLoopRelease = useCallback(() => {
    // No action on release for loop
  }, []);

  // --- PAD 3: ROLL ---
  const handleRollClick = useCallback(() => {
    // Tap does nothing - roll is hold-based
  }, []);

  const handleRollHold = useCallback(() => {
    if (!deck.isLoaded || loopRollStateRef.current.active) return;

    // Start roll - save return position
    loopRollStateRef.current.active = true;
    loopRollStateRef.current.returnPos = deck.playhead;
    console.log(`[PerformancePad-${deckId}] Roll: Started at ${deck.playhead.toFixed(2)}s`);

    // TODO: Implement momentary roll in Deck class
  }, [deck, deckId]);

  const handleRollRelease = useCallback(() => {
    if (!loopRollStateRef.current.active) return;

    // Stop roll - snap back to saved position
    const returnPos = loopRollStateRef.current.returnPos;
    if (returnPos !== null && deck.isLoaded) {
      // NOTE: This would snap back in a real implementation
      // For now, just log
      console.log(`[PerformancePad-${deckId}] Roll: Released, would return to ${returnPos.toFixed(2)}s`);
    }

    loopRollStateRef.current.active = false;
    loopRollStateRef.current.returnPos = null;
  }, [deck, deckId]);

  // --- PAD 4: JUMP (±) ---
  const handleJumpClick = useCallback(() => {
    if (!deck.isLoaded || !deck.bpm) return;

    // Tap: jump BACK 1 beat
    const beatsPerSecond = deck.bpm / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const jumpAmount = -secondsPerBeat; // negative = back

    const newPos = Math.max(0, deck.playhead + jumpAmount);
    deck.seek(newPos);
    console.log(`[PerformancePad-${deckId}] Jump: ${jumpAmount.toFixed(2)}s (1 beat back) to ${newPos.toFixed(2)}s`);
  }, [deck, deckId]);

  const handleJumpHold = useCallback(() => {
    if (!deck.isLoaded || !deck.bpm) return;

    // Hold: jump FORWARD 1 bar (4 beats)
    const beatsPerSecond = deck.bpm / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const beatsPerBar = 4;
    const jumpAmount = secondsPerBeat * beatsPerBar; // positive = forward

    const newPos = Math.min(deck.playhead + jumpAmount, deck.duration);
    deck.seek(newPos);
    console.log(`[PerformancePad-${deckId}] Jump: +${jumpAmount.toFixed(2)}s (1 bar forward) to ${newPos.toFixed(2)}s`);
  }, [deck, deckId]);

  const handleJumpRelease = useCallback(() => {
    // No action on release for jump
  }, []);

  // Keyboard event handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyIndex = keybinds.indexOf(e.key);
      if (keyIndex === -1 || keyPressed[e.key]) return;

      e.preventDefault();
      setKeyPressed(prev => ({ ...prev, [e.key]: true }));

      // Call the appropriate handler based on pad index
      switch (keyIndex) {
        case 0: handleHotCueClick(); break;
        case 1: handleLoopClick(); break;
        case 2: handleRollClick(); break;
        case 3: handleJumpClick(); break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const keyIndex = keybinds.indexOf(e.key);
      if (keyIndex === -1) return;

      e.preventDefault();
      setKeyPressed(prev => ({ ...prev, [e.key]: false }));

      // Call the appropriate release handler based on pad index
      switch (keyIndex) {
        case 0: handleHotCueRelease(); break;
        case 1: handleLoopRelease(); break;
        case 2: handleRollRelease(); break;
        case 3: handleJumpRelease(); break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keybinds, keyPressed, handleHotCueClick, handleHotCueRelease, handleLoopClick, handleLoopRelease, handleRollClick, handleRollRelease, handleJumpClick, handleJumpRelease]);

  // Handlers array for rendering
  const handlers = [
    { onClick: handleHotCueClick, onHold: handleHotCueHold, onRelease: handleHotCueRelease },
    { onClick: handleLoopClick, onHold: handleLoopHold, onRelease: handleLoopRelease },
    { onClick: handleRollClick, onHold: handleRollHold, onRelease: handleRollRelease },
    { onClick: handleJumpClick, onHold: handleJumpHold, onRelease: handleJumpRelease },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gridTemplateRows: "repeat(2, 1fr)",
        gap: 0,
        width: "fit-content",
      }}
    >
      {keybinds.map((keybind, index) => {
        const handler = handlers[index];
        const padFunction = PAD_FUNCTIONS[index];
        const color = PAD_COLORS[index];

        if (!handler || !padFunction || !color) {
          console.error(`Missing handler/function/color for pad ${index}`);
          return null;
        }

        return (
          <PerformancePadButton
            key={index}
            keybind={keybind}
            padFunction={padFunction}
            color={color}
            onClick={handler.onClick}
            onHold={handler.onHold}
            onRelease={handler.onRelease}
            size={46}
            externalPressed={keyPressed[keybind]}
          />
        );
      })}
    </div>
  );
});

export default PerformancePadPanel;
