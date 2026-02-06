"use client";

import { memo, useCallback, useEffect, useState, useRef } from "react";
import PerformancePadButton, { type PadFunction } from "./PerformancePadButton";
import { useDeck } from "@/audio/useDeck";

export type PerformancePadPanelProps = {
  deckId: "A" | "B";
  /** Keybinds for the 4 pads (top-left, top-right, bottom-left, bottom-right) */
  keybinds: [string, string, string, string];
  /** Room ID for sending events */
  roomId: string;
  /** Client ID */
  clientId: string;
  /** Send event function */
  sendEvent: (e: import("@puid-board/shared").ClientMutationEvent) => void;
  /** Get next sequence number */
  nextSeq: () => number;
};

// Pad functions in order: HOT CUE, LOOP, ROLL, JUMP
const PAD_FUNCTIONS: [PadFunction, PadFunction, PadFunction, PadFunction] = ["hotcue", "loop", "roll", "jump"];

// Colors for each pad
const PAD_COLORS: [string, string, string, string] = [
  "#FF3B3B", // Pad 1: Hot Cue - Red
  "#FF3B3B", // Pad 2: Loop - Red
  "#FF3B3B", // Pad 3: Roll - Red
  "#FF3B3B", // Pad 4: Jump - Red
];

/**
 * Performance pad panel with 4 pads in 2x2 grid.
 * Each pad has a fixed function: Hot Cue, Loop, Roll, Jump.
 */
const PerformancePadPanel = memo(function PerformancePadPanel({
  deckId,
  keybinds,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
}: PerformancePadPanelProps) {
  const deck = useDeck(deckId);
  const [keyPressed, setKeyPressed] = useState<Record<string, boolean>>({});

  // Keyboard hold detection (track key down times for hold detection)
  const keyHoldTimersRef = useRef<Record<string, NodeJS.Timeout | null>>({});
  const keyHoldTriggeredRef = useRef<Record<string, boolean>>({});
  // Track which keys are currently down (for repeat guard) - using ref to avoid effect re-runs
  const keysDownRef = useRef<Record<string, boolean>>({});

  // Store handlers in refs to prevent useEffect from re-running on every frame
  // Initialize with no-op functions, will be updated after handlers are declared
  const handlersRef = useRef({
    hotCueClick: () => {},
    hotCueHold: () => {},
    hotCueRelease: () => {},
    loopClick: () => {},
    loopHold: () => {},
    loopRelease: () => {},
    rollClick: () => {},
    rollHold: () => {},
    rollRelease: () => {},
    jumpClick: () => {},
    jumpHold: () => {},
    jumpRelease: () => {},
  });

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
    console.log(`[HOT_CUE] Deck ${deckId}: Tap handler called, isLoaded=${deck.isLoaded}, hotCuePointSec=${deck.hotCuePointSec}`);

    if (!deck.isLoaded) {
      console.log(`[HOT_CUE] Deck ${deckId}: Blocked - no track loaded`);
      return;
    }

    // Tap: Jump to hot cue and play (if cue is set)
    if (deck.hotCuePointSec !== null) {
      console.log(`[HOT_CUE] Deck ${deckId}: Jumping to cue at ${deck.hotCuePointSec.toFixed(2)}s`);

      // CRITICAL FIX: Send DECK_SEEK event to server so all clients sync
      // Without this, only the local client jumps, then BEACON_TICK pulls it back
      sendEvent({
        type: "DECK_SEEK",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { deckId, positionSec: deck.hotCuePointSec },
      });
      console.log(`[HOT_CUE] Deck ${deckId}: DECK_SEEK event sent to server`);

      // Apply locally for immediate feedback (optimistic update)
      deck.jumpToHotCue();
    } else {
      console.log(`[HOT_CUE] Deck ${deckId}: No cue set - tap does nothing`);
    }
  }, [deck, deckId, sendEvent, roomId, clientId, nextSeq]);

  const handleHotCueHold = useCallback(() => {
    console.log(`[HOT_CUE] Deck ${deckId}: Hold handler called, isLoaded=${deck.isLoaded}, playhead=${deck.playhead.toFixed(2)}s`);

    if (!deck.isLoaded) {
      console.log(`[HOT_CUE] Deck ${deckId}: Blocked - no track loaded`);
      return;
    }

    // Hold: Set hot cue at current position
    console.log(`[HOT_CUE] Deck ${deckId}: Setting hot cue at ${deck.playhead.toFixed(2)}s`);
    deck.setHotCue();
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

  // Update handler refs with actual handlers (after they're declared)
  handlersRef.current = {
    hotCueClick: handleHotCueClick,
    hotCueHold: handleHotCueHold,
    hotCueRelease: handleHotCueRelease,
    loopClick: handleLoopClick,
    loopHold: handleLoopHold,
    loopRelease: handleLoopRelease,
    rollClick: handleRollClick,
    rollHold: handleRollHold,
    rollRelease: handleRollRelease,
    jumpClick: handleJumpClick,
    jumpHold: handleJumpHold,
    jumpRelease: handleJumpRelease,
  };

  // Keyboard event handling with hold detection
  // CRITICAL: Only depends on keybinds to avoid effect re-running on every frame
  useEffect(() => {
    const HOLD_THRESHOLD_MS = 300;
    const PAD_NAMES = ["HOT_CUE", "LOOP", "ROLL", "JUMP"];

    const handleKeyDown = (e: KeyboardEvent) => {
      const keyIndex = keybinds.indexOf(e.key);
      // Use ref for repeat guard to avoid effect re-runs
      if (keyIndex === -1 || keysDownRef.current[e.key]) return;

      const padName = PAD_NAMES[keyIndex];
      console.log(`[${padName}] Key down: "${e.key}" for Deck ${deckId}`);

      e.preventDefault();
      // Track in ref (for repeat guard)
      keysDownRef.current[e.key] = true;
      // Update state (for visual feedback)
      setKeyPressed(prev => ({ ...prev, [e.key]: true }));

      // Clear any existing timer for this key
      if (keyHoldTimersRef.current[e.key]) {
        clearTimeout(keyHoldTimersRef.current[e.key]!);
      }

      // Set hold detected flag to false initially
      keyHoldTriggeredRef.current[e.key] = false;

      // Get the hold handler for this pad from the ref (not stale)
      const holdHandlers = [
        handlersRef.current.hotCueHold,
        handlersRef.current.loopHold,
        handlersRef.current.rollHold,
        handlersRef.current.jumpHold
      ];
      const holdHandler = holdHandlers[keyIndex];

      // Set up hold detection (same as button)
      console.log(`[${padName}] Starting ${HOLD_THRESHOLD_MS}ms hold timer for Deck ${deckId}`);
      keyHoldTimersRef.current[e.key] = setTimeout(() => {
        console.log(`[${padName}] Hold timer FIRED for Deck ${deckId} - calling hold handler`);
        keyHoldTriggeredRef.current[e.key] = true;
        if (holdHandler) {
          holdHandler();
        }
      }, HOLD_THRESHOLD_MS);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const keyIndex = keybinds.indexOf(e.key);
      if (keyIndex === -1) return;

      const padName = PAD_NAMES[keyIndex];
      console.log(`[${padName}] Key up: "${e.key}" for Deck ${deckId}`);

      e.preventDefault();
      // Clear ref (for repeat guard)
      keysDownRef.current[e.key] = false;
      // Update state (for visual feedback)
      setKeyPressed(prev => ({ ...prev, [e.key]: false }));

      // If hold timer is still running, this was a quick tap
      const wasQuickTap = keyHoldTimersRef.current[e.key] !== null && !keyHoldTriggeredRef.current[e.key];

      // Clear hold timer
      if (keyHoldTimersRef.current[e.key]) {
        clearTimeout(keyHoldTimersRef.current[e.key]!);
        keyHoldTimersRef.current[e.key] = null;
      }

      // Get handlers for this pad from the ref (not stale)
      const clickHandlers = [
        handlersRef.current.hotCueClick,
        handlersRef.current.loopClick,
        handlersRef.current.rollClick,
        handlersRef.current.jumpClick
      ];
      const releaseHandlers = [
        handlersRef.current.hotCueRelease,
        handlersRef.current.loopRelease,
        handlersRef.current.rollRelease,
        handlersRef.current.jumpRelease
      ];
      const clickHandler = clickHandlers[keyIndex];
      const releaseHandler = releaseHandlers[keyIndex];

      // Fire onClick only if it was a quick tap (hold didn't trigger)
      if (wasQuickTap) {
        console.log(`[${padName}] Quick tap detected for Deck ${deckId} - calling click handler`);
        if (clickHandler) {
          clickHandler();
        }
      } else {
        console.log(`[${padName}] Hold was triggered for Deck ${deckId} - skipping click handler`);
      }

      // Always call release handler
      if (releaseHandler) {
        releaseHandler();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // DO NOT clear timers here - that was causing the bug!
      // Timers will complete naturally or be cleared by handleKeyUp
    };
  }, [keybinds, deckId]); // Only keybinds and deckId, NOT the handler functions!

  // Handlers array for rendering
  const handlers = [
    { onClick: handleHotCueClick, onHold: handleHotCueHold, onRelease: handleHotCueRelease },
    { onClick: handleLoopClick, onHold: handleLoopHold, onRelease: handleLoopRelease },
    { onClick: handleRollClick, onHold: handleRollHold, onRelease: handleRollRelease },
    { onClick: handleJumpClick, onHold: handleJumpHold, onRelease: handleJumpRelease },
  ];

  // Function labels in display format
  const FUNCTION_LABELS = ["HOT CUE", "LOOP", "ROLL", "JUMP"];

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
        const label = FUNCTION_LABELS[index];

        if (!handler || !padFunction || !color) {
          console.error(`Missing handler/function/color for pad ${index}`);
          return null;
        }

        // Determine label position based on grid position
        // Left column (index 0,2): labels go to left of button
        // Right column (index 1,3): labels go to right of button
        const isLeftColumn = index % 2 === 0;

        return (
          <div key={index} style={{ position: "relative" }}>
            <PerformancePadButton
              keybind={keybind}
              padFunction={padFunction}
              color={color}
              onClick={handler.onClick}
              onHold={handler.onHold}
              onRelease={handler.onRelease}
              size={46}
              externalPressed={keyPressed[keybind]}
            />
            {/* Etched function label (3-layer SVG effect matching board aesthetic) */}
            <svg
              viewBox="0 0 60 12"
              width="60"
              height="12"
              style={{
                position: "absolute",
                top: "50%",
                transform: "translateY(-50%)",
                left: isLeftColumn ? -62 : undefined,
                right: isLeftColumn ? undefined : -62,
                pointerEvents: "none",
                userSelect: "none",
              }}
              aria-hidden="true"
            >
              {/* Highlight layer */}
              <text
                x={isLeftColumn ? "58" : "2"}
                y="6"
                textAnchor={isLeftColumn ? "end" : "start"}
                dominantBaseline="central"
                fill="#ffffff"
                opacity="0.06"
                dx="-0.4"
                dy="-0.4"
                style={{
                  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
                  fontWeight: 700,
                  fontSize: "7px",
                  letterSpacing: "0.10em",
                }}
              >
                {label}
              </text>
              {/* Shadow layer */}
              <text
                x={isLeftColumn ? "58" : "2"}
                y="6"
                textAnchor={isLeftColumn ? "end" : "start"}
                dominantBaseline="central"
                fill="#000000"
                opacity="0.50"
                dx="0.5"
                dy="0.5"
                style={{
                  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
                  fontWeight: 700,
                  fontSize: "7px",
                  letterSpacing: "0.10em",
                }}
              >
                {label}
              </text>
              {/* Face layer */}
              <text
                x={isLeftColumn ? "58" : "2"}
                y="6"
                textAnchor={isLeftColumn ? "end" : "start"}
                dominantBaseline="central"
                fill="#00ff9f"
                opacity="0.30"
                style={{
                  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
                  fontWeight: 700,
                  fontSize: "7px",
                  letterSpacing: "0.10em",
                }}
              >
                {label}
              </text>
            </svg>
          </div>
        );
      })}
    </div>
  );
});

export default PerformancePadPanel;
