"use client";

import { useRef, useCallback, useEffect, useMemo, memo } from "react";
import type { ClientMutationEvent, ControlOwnership } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";
import {
  rafManager,
  getCoalescedPointerData,
  clamp,
  type CoalescedPointerData,
} from "../../audio/controlOptimizer";

export type FaderProps = {
  controlId: string;
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info (if someone owns this control) */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
  /** Label text */
  label?: string;
  /** Height in pixels */
  height?: number;
  /** Orientation */
  orientation?: "vertical" | "horizontal";
  /** Is this control being moved by a remote user (for interpolation) */
  isRemoteUpdate?: boolean;
};

// Triple-buffer state for smooth visual updates
interface FaderState {
  local: number;      // Raw input value (1:1 mapping, no lag)
  visual: number;     // For remote interpolation only
  network: number;    // Throttled network value
  target: number;     // Target for remote interpolation
  isDragging: boolean;
  isLocalUser: boolean;
}

/**
 * Professional-grade fader with:
 * - LINEAR 1:1 mapping (no easing curves)
 * - GPU-accelerated transforms: translate3d(0, y, 0)
 * - Pointer event coalescing for high-precision tracking
 * - RAF-batched visual updates
 * - Local = immediate, Remote = interpolated
 * - touch-action: none for no browser interference
 * - LED updates batched in RAF
 */
const Fader = memo(function Fader({
  controlId,
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
  label,
  height = 120,
  orientation = "vertical",
  isRemoteUpdate = false,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);
  const ledsRef = useRef<HTMLDivElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<FaderState>({
    local: value,
    visual: value,
    network: value,
    target: value,
    isDragging: false,
    isLocalUser: true,
  });

  // Pointer tracking refs
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastSendRef = useRef(0);
  const rafIdRef = useRef<string | null>(null);

  const isVertical = orientation === "vertical";
  const trackSize = isVertical ? height : 120;
  const LED_COUNT = 10;

  // Update DOM directly (bypass React for performance)
  const updateThumbPosition = useCallback((normalizedValue: number) => {
    if (thumbRef.current) {
      if (isVertical) {
        // Vertical: bottom = 0, top = 1
        const percent = (1 - normalizedValue) * 100;
        thumbRef.current.style.transform = `translate3d(-50%, calc(${percent}% - 50%), 0)`;
      } else {
        // Horizontal
        const percent = normalizedValue * 100;
        thumbRef.current.style.transform = `translate3d(calc(${percent}% - 50%), -50%, 0) rotate(90deg)`;
      }
    }

    // Update LEDs in same RAF batch
    if (ledsRef.current && isVertical) {
      const activeLeds = Math.ceil(normalizedValue * LED_COUNT);
      const ledElements = ledsRef.current.children;
      for (let i = 0; i < ledElements.length; i++) {
        const led = ledElements[i] as HTMLElement;
        const isActive = LED_COUNT - i <= activeLeds;
        if (isActive) {
          led.style.background = "linear-gradient(90deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)";
          led.style.boxShadow = "0 0 2px #3b82f6, 0 0 4px rgba(59, 130, 246, 0.6), inset 0 1px 1px rgba(96, 165, 250, 0.8), inset 0 -1px 1px rgba(30, 64, 175, 0.8)";
          led.style.opacity = "1";
          led.style.border = "0.5px solid rgba(96, 165, 250, 0.3)";
        } else {
          led.style.background = "#0a0a0a";
          led.style.boxShadow = "inset 0 1px 1px rgba(0, 0, 0, 0.8)";
          led.style.opacity = "0.3";
          led.style.border = "0.5px solid #0a0a0a";
        }
      }
    }
  }, [isVertical]);

  // RAF animation callback
  const animationCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;

    if (state.isDragging) {
      // LOCAL USER DRAGGING: immediate 1:1 mapping, no interpolation
      state.visual = state.local;
      updateThumbPosition(state.visual);
      return true;
    }

    if (!state.isLocalUser) {
      // REMOTE USER: smooth interpolation
      const diff = state.target - state.visual;
      if (Math.abs(diff) < 0.0001) {
        state.visual = state.target;
        updateThumbPosition(state.visual);
        return false; // Stop RAF
      }

      // Linear interpolation for remote users only
      const dt = deltaTime / 16.67;
      const smoothing = 0.25;
      state.visual += diff * smoothing * dt;
      updateThumbPosition(state.visual);
      return true;
    }

    // Local user, not dragging - snap to final position
    if (Math.abs(state.visual - state.target) > 0.0001) {
      state.visual = state.target;
      updateThumbPosition(state.visual);
    }
    return false;
  }, [updateThumbPosition]);

  // Start RAF loop
  const startAnimation = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = `fader-${controlId}-${Math.random().toString(36).slice(2)}`;
    }
    rafManager.register(rafIdRef.current, animationCallback);
  }, [controlId, animationCallback]);

  // Sync external value changes when not dragging
  useEffect(() => {
    const state = stateRef.current;
    if (!state.isDragging) {
      state.target = value;
      state.isLocalUser = !isRemoteUpdate;

      if (isRemoteUpdate) {
        startAnimation();
      } else {
        state.local = value;
        state.visual = value;
        updateThumbPosition(value);
      }
    }
  }, [value, isRemoteUpdate, startAnimation, updateThumbPosition]);

  // Send network event with throttling
  const sendValue = useCallback((newValue: number) => {
    const now = performance.now();
    if (now - lastSendRef.current < THROTTLE.CONTROL_MS) {
      return;
    }
    lastSendRef.current = now;
    stateRef.current.network = newValue;

    sendEvent({
      type: "MIXER_SET",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId, value: newValue },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  const sendGrab = useCallback(() => {
    sendEvent({
      type: "CONTROL_GRAB",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  const sendRelease = useCallback(() => {
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  // Calculate value from pointer position - LINEAR 1:1 mapping
  const calculateValue = useCallback((clientX: number, clientY: number): number => {
    const track = trackRef.current;
    if (!track) return stateRef.current.local;

    const rect = track.getBoundingClientRect();
    let ratio: number;

    if (isVertical) {
      // Vertical: top = 1, bottom = 0 (inverted)
      ratio = 1 - (clientY - rect.top) / rect.height;
    } else {
      ratio = (clientX - rect.left) / rect.width;
    }

    return clamp(ratio, 0, 1);
  }, [isVertical]);

  // Handle pointer down
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const state = stateRef.current;
    state.isDragging = true;
    state.isLocalUser = true;

    lastPositionRef.current = { x: e.clientX, y: e.clientY };

    // Immediate value update - no lag
    const newValue = calculateValue(e.clientX, e.clientY);
    state.local = newValue;
    state.visual = newValue;
    state.target = newValue;

    updateThumbPosition(newValue);
    sendGrab();
    sendValue(newValue);

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startAnimation();
  }, [calculateValue, sendGrab, sendValue, startAnimation, updateThumbPosition]);

  // Handle pointer move with coalescing
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    // Get coalesced events for high-precision tracking
    const data: CoalescedPointerData = getCoalescedPointerData(
      e.nativeEvent,
      lastPositionRef.current
    );
    lastPositionRef.current = { x: data.x, y: data.y };

    // Process coalesced points for smoother tracking
    let finalValue = state.local;
    if (data.points.length > 1) {
      for (const point of data.points) {
        finalValue = calculateValue(point.x, point.y);
      }
    } else {
      finalValue = calculateValue(data.x, data.y);
    }

    // LINEAR 1:1 update - no easing, no prediction
    state.local = finalValue;
    state.visual = finalValue;
    state.target = finalValue;

    updateThumbPosition(finalValue);
    sendValue(finalValue);
  }, [calculateValue, sendValue, updateThumbPosition]);

  // Handle pointer up
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    sendRelease();

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    state.target = state.local;
  }, [sendRelease]);

  // Ownership styling
  const isOwnedByOther = ownership && ownership.clientId !== clientId;
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  // Memoized styles
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    userSelect: "none",
    WebkitUserSelect: "none",
  }), []);

  const labelStyle = useMemo<React.CSSProperties>(() => ({
    fontSize: "0.625rem",
    color: "#6b7280",
    fontWeight: 500,
    pointerEvents: "none",
  }), []);

  const valueDisplayStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: -20,
    left: "50%",
    transform: "translateX(-50%)",
    background: "linear-gradient(135deg, #050508 0%, #0a0a0c 100%)",
    border: "1px solid #1a1a1a",
    borderRadius: "3px",
    boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.8), 0 1px 4px rgba(0, 0, 0, 0.6), inset 0 0 8px rgba(59, 130, 246, 0.1)",
    padding: "2px 4px",
    minWidth: "24px",
    zIndex: 10,
    pointerEvents: "none",
  }), []);

  const valueTextStyle = useMemo<React.CSSProperties>(() => ({
    fontSize: "0.5rem",
    fontWeight: 700,
    fontFamily: "monospace",
    color: "#60a5fa",
    textAlign: "center",
    letterSpacing: "0.03em",
    textShadow: "0 0 4px rgba(96, 165, 250, 0.3)",
  }), []);

  const trackStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: isVertical ? 24 : trackSize,
    height: isVertical ? trackSize : 24,
    background: "linear-gradient(to bottom, #1a1a1a, #0f0f10)",
    borderRadius: 4,
    border: "1px solid #242424",
    cursor: isOwnedByOther ? "not-allowed" : "pointer",
    touchAction: "none",
    boxShadow: ownerColor
      ? isOwnedBySelf
        ? `inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03), 0 0 8px 2px ${ownerColor}`
        : `inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03), 0 0 12px 3px ${ownerColor}`
      : "inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
  }), [isVertical, trackSize, isOwnedByOther, ownerColor, isOwnedBySelf]);

  const thumbStyle = useMemo<React.CSSProperties>(() => {
    const initialValue = stateRef.current.visual;
    const transform = isVertical
      ? `translate3d(-50%, calc(${(1 - initialValue) * 100}% - 50%), 0)`
      : `translate3d(calc(${initialValue * 100}% - 50%), -50%, 0) rotate(90deg)`;

    return {
      position: "absolute",
      left: isVertical ? "50%" : 0,
      top: isVertical ? 0 : "50%",
      transform,
      width: isVertical ? 28 : 42,
      height: isVertical ? 42 : 28,
      pointerEvents: "none",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      willChange: "transform",
      backfaceVisibility: "hidden",
    };
  }, [isVertical]);

  // Generate LED elements
  const ledElements = useMemo(() => {
    if (!isVertical) return null;

    return Array.from({ length: LED_COUNT }).map((_, i) => {
      const isActive = LED_COUNT - i <= Math.ceil(stateRef.current.visual * LED_COUNT);
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            bottom: `${(i / LED_COUNT) * 100}%`,
            left: "50%",
            transform: "translateX(-50%)",
            width: 3,
            height: `${100 / LED_COUNT - 1}%`,
            background: isActive
              ? "linear-gradient(90deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)"
              : "#0a0a0a",
            borderRadius: "1px",
            boxShadow: isActive
              ? "0 0 2px #3b82f6, 0 0 4px rgba(59, 130, 246, 0.6), inset 0 1px 1px rgba(96, 165, 250, 0.8), inset 0 -1px 1px rgba(30, 64, 175, 0.8)"
              : "inset 0 1px 1px rgba(0, 0, 0, 0.8)",
            border: isActive ? "0.5px solid rgba(96, 165, 250, 0.3)" : "0.5px solid #0a0a0a",
            pointerEvents: "none",
            opacity: isActive ? 1 : 0.3,
          }}
        />
      );
    });
  }, [isVertical]);

  return (
    <div style={containerStyle}>
      {label && <span style={labelStyle}>{label}</span>}

      {/* LCD Value Display */}
      <div style={valueDisplayStyle}>
        <div style={valueTextStyle}>
          {Math.round(stateRef.current.visual * 100)}
        </div>
      </div>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={trackStyle}
      >
        {/* LED Light Strip */}
        <div ref={ledsRef}>
          {ledElements}
        </div>

        {/* Thumb - GPU accelerated */}
        <img
          ref={thumbRef}
          src="/assets/dj-controls/faders/fader-handle.svg"
          alt=""
          draggable={false}
          style={thumbStyle}
        />
      </div>
    </div>
  );
});

export default Fader;
