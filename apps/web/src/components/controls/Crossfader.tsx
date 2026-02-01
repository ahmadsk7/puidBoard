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

export type CrossfaderProps = {
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
  /** Width of the crossfader track */
  width?: number;
  /** Is this control being moved by a remote user (for interpolation) */
  isRemoteUpdate?: boolean;
};

const CONTROL_ID = "crossfader";

// Triple-buffer state for smooth visual updates
interface CrossfaderState {
  local: number;      // Raw input value (1:1 mapping, no lag)
  visual: number;     // For remote interpolation only
  network: number;    // Throttled network value
  target: number;     // Target for remote interpolation
  isDragging: boolean;
  isLocalUser: boolean;
}

/**
 * Professional-grade crossfader with:
 * - LINEAR 1:1 mapping (no easing curves)
 * - GPU-accelerated transforms: translate3d(x, 0, 0)
 * - Pointer event coalescing for high-precision tracking
 * - RAF-batched visual updates
 * - Local = immediate, Remote = interpolated
 * - touch-action: none for no browser interference
 */
const Crossfader = memo(function Crossfader({
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
  width: _width = 200,
  isRemoteUpdate = false,
}: CrossfaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<CrossfaderState>({
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

  // Update DOM directly (bypass React for performance)
  const updateThumbPosition = useCallback((normalizedValue: number) => {
    if (thumbRef.current) {
      // GPU-accelerated transform: translate3d(x, 0, 0)
      const percent = normalizedValue * 100;
      thumbRef.current.style.transform = `translate3d(calc(${percent}% - 50%), -50%, 0)`;
    }
  }, []);

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

      // Linear interpolation for remote users (NOT for local)
      const dt = deltaTime / 16.67;
      const smoothing = 0.25; // Remote smoothing factor
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
      rafIdRef.current = `crossfader-${Math.random().toString(36).slice(2)}`;
    }
    rafManager.register(rafIdRef.current, animationCallback);
  }, [animationCallback]);

  // Sync external value changes when not dragging
  useEffect(() => {
    const state = stateRef.current;
    if (!state.isDragging) {
      state.target = value;
      state.isLocalUser = !isRemoteUpdate;

      if (isRemoteUpdate) {
        // Remote update: interpolate
        startAnimation();
      } else {
        // Local value change: immediate
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
      payload: { controlId: CONTROL_ID, value: newValue },
    });
  }, [roomId, clientId, sendEvent, nextSeq]);

  const sendGrab = useCallback(() => {
    sendEvent({
      type: "CONTROL_GRAB",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId: CONTROL_ID },
    });
  }, [roomId, clientId, sendEvent, nextSeq]);

  const sendRelease = useCallback(() => {
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId: CONTROL_ID },
    });
  }, [roomId, clientId, sendEvent, nextSeq]);

  // Calculate value from pointer position - LINEAR 1:1 mapping
  const calculateValue = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return stateRef.current.local;

    const rect = track.getBoundingClientRect();
    // Linear mapping: pointer position directly maps to value
    const ratio = (clientX - rect.left) / rect.width;
    return clamp(ratio, 0, 1);
  }, []);

  // Handle pointer down
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const state = stateRef.current;
    state.isDragging = true;
    state.isLocalUser = true;

    lastPositionRef.current = { x: e.clientX, y: e.clientY };

    // Immediate value update - no lag
    const newValue = calculateValue(e.clientX);
    state.local = newValue;
    state.visual = newValue;
    state.target = newValue;

    updateThumbPosition(newValue);
    sendGrab();
    sendValue(newValue);

    // Set pointer capture on the track
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    // Start animation loop
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
      // Process all intermediate points
      for (const point of data.points) {
        finalValue = calculateValue(point.x);
      }
    } else {
      finalValue = calculateValue(data.x);
    }

    // LINEAR 1:1 update - no easing, no prediction
    state.local = finalValue;
    state.visual = finalValue;
    state.target = finalValue;

    // Immediate visual update (DOM updated in RAF for batching)
    updateThumbPosition(finalValue);

    // Send throttled network update
    sendValue(finalValue);
  }, [calculateValue, sendValue, updateThumbPosition]);

  // Handle pointer up
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    sendRelease();

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Snap to final position
    state.target = state.local;
  }, [sendRelease]);

  // Ownership styling
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  // Memoized styles for performance
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: "100%",
    height: "100%",
    userSelect: "none",
    WebkitUserSelect: "none",
  }), []);

  const labelStyleA = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    left: 8,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "0.625rem",
    color: "#3b82f6",
    fontWeight: 600,
    zIndex: 1,
    pointerEvents: "none",
  }), []);

  const labelStyleB = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "0.625rem",
    color: "#8b5cf6",
    fontWeight: 600,
    zIndex: 1,
    pointerEvents: "none",
  }), []);

  const trackStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "linear-gradient(to bottom, #1a1a1a, #0f0f10)",
    borderRadius: 17,
    border: "1px solid #242424",
    cursor: "pointer",
    touchAction: "none",  // Critical: prevents browser scroll/zoom
    boxShadow: ownerColor
      ? isOwnedBySelf
        ? `inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03), 0 0 8px 2px ${ownerColor}`
        : `inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03), 0 0 12px 3px ${ownerColor}`
      : "inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
  }), [ownerColor, isOwnedBySelf]);

  const centerMarkerStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    background: "#3a3a3a",
    transform: "translateX(-50%)",
    pointerEvents: "none",
  }), []);

  // Initial thumb position
  const initialThumbStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    left: 0,
    top: "50%",
    transform: `translate3d(calc(${stateRef.current.visual * 100}% - 50%), -50%, 0)`,
    width: 60,
    height: 30,
    pointerEvents: "none",
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
    willChange: "transform",
    backfaceVisibility: "hidden",
  }), []);

  return (
    <div style={containerStyle}>
      {/* A label */}
      <span style={labelStyleA}>A</span>

      {/* B label */}
      <span style={labelStyleB}>B</span>

      {/* Crossfader track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={trackStyle}
      >
        {/* Center marker */}
        <div style={centerMarkerStyle} />

        {/* Thumb with SVG - GPU accelerated */}
        <img
          ref={thumbRef}
          src="/assets/dj-controls/faders/crossfader-handle.svg"
          alt=""
          draggable={false}
          style={initialThumbStyle}
        />
      </div>
    </div>
  );
});

export default Crossfader;
