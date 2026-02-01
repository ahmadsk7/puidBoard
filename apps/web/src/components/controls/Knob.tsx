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

export type KnobProps = {
  controlId: string;
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
  /** Label text */
  label?: string;
  /** Size in pixels */
  size?: number;
  /** Min value (default 0) */
  min?: number;
  /** Max value (default 1) */
  max?: number;
  /** Whether the knob is bipolar (center = neutral) */
  bipolar?: boolean;
  /** Is this control being moved by a remote user (for interpolation) */
  isRemoteUpdate?: boolean;
};

// Triple-buffer state for smooth visual updates
interface KnobState {
  local: number;      // Raw input value (1:1 mapping, no lag)
  visual: number;     // For remote interpolation only
  network: number;    // Throttled network value
  target: number;     // Target for remote interpolation
  isDragging: boolean;
  isLocalUser: boolean;
  startY: number;     // Pointer Y at drag start
  startValue: number; // Value at drag start
}

/**
 * Professional-grade rotary knob with:
 * - LINEAR 1:1 mapping (no easing curves)
 * - GPU-accelerated transforms: translate3d(0,0,0) rotateZ(deg)
 * - Pointer event coalescing for high-precision tracking
 * - RAF-batched visual updates
 * - Local = immediate, Remote = interpolated
 * - touch-action: none for no browser interference
 * - Micro-animations for tactile feedback
 */
const Knob = memo(function Knob({
  controlId,
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
  label,
  size = 48,
  min = 0,
  max = 1,
  bipolar = false,
  isRemoteUpdate = false,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLImageElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<KnobState>({
    local: value,
    visual: value,
    network: value,
    target: value,
    isDragging: false,
    isLocalUser: true,
    startY: 0,
    startValue: 0,
  });

  // Pointer tracking refs
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastSendRef = useRef(0);
  const rafIdRef = useRef<string | null>(null);

  // Animation state for micro-feedback
  const isPressedRef = useRef(false);

  // Calculate rotation from value - LINEAR mapping
  const valueToRotation = useCallback((v: number): number => {
    const normalized = (v - min) / (max - min);
    return -135 + normalized * 270; // 270 degree range
  }, [min, max]);

  // Update DOM directly (bypass React for performance)
  const updateKnobRotation = useCallback((normalizedValue: number) => {
    if (indicatorRef.current) {
      const rotation = valueToRotation(normalizedValue);
      // GPU-accelerated transform with translate3d(0,0,0) hack
      indicatorRef.current.style.transform = `translate(-50%, -50%) translate3d(0, 0, 0) rotateZ(${rotation}deg)`;
    }
  }, [valueToRotation]);

  // RAF animation callback
  const animationCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;

    if (state.isDragging) {
      // LOCAL USER DRAGGING: immediate 1:1 mapping, no interpolation
      state.visual = state.local;
      updateKnobRotation(state.visual);
      return true;
    }

    if (!state.isLocalUser) {
      // REMOTE USER: smooth interpolation
      const diff = state.target - state.visual;
      if (Math.abs(diff) < 0.0001) {
        state.visual = state.target;
        updateKnobRotation(state.visual);
        return false; // Stop RAF
      }

      // Linear interpolation for remote users only
      const dt = deltaTime / 16.67;
      const smoothing = 0.25;
      state.visual += diff * smoothing * dt;
      updateKnobRotation(state.visual);
      return true;
    }

    // Local user, not dragging - snap to final position
    if (Math.abs(state.visual - state.target) > 0.0001) {
      state.visual = state.target;
      updateKnobRotation(state.visual);
    }
    return false;
  }, [updateKnobRotation]);

  // Start RAF loop
  const startAnimation = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = `knob-${controlId}-${Math.random().toString(36).slice(2)}`;
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
        updateKnobRotation(value);
      }
    }
  }, [value, isRemoteUpdate, startAnimation, updateKnobRotation]);

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

  // Handle pointer down
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const state = stateRef.current;
    state.isDragging = true;
    state.isLocalUser = true;
    state.startY = e.clientY;
    state.startValue = state.visual;

    lastPositionRef.current = { x: e.clientX, y: e.clientY };
    isPressedRef.current = true;

    sendGrab();

    // Set pointer capture
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startAnimation();

    // Apply press feedback via CSS class or direct style
    if (knobRef.current) {
      knobRef.current.style.transform = "scale(0.98)";
    }
  }, [sendGrab, startAnimation]);

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

    // Calculate cumulative delta from coalesced points
    let totalDeltaY = 0;
    if (data.points.length > 1) {
      for (let i = 1; i < data.points.length; i++) {
        totalDeltaY += data.points[i - 1].y - data.points[i].y;
      }
    } else {
      totalDeltaY = state.startY - data.y;
    }

    // LINEAR 1:1 mapping - delta pixels = delta value
    const sensitivity = 200; // pixels for full range
    const deltaValue = (totalDeltaY / sensitivity) * (max - min);
    const newValue = clamp(state.startValue + deltaValue, min, max);

    // Direct update - no prediction, no easing
    state.local = newValue;
    state.visual = newValue;
    state.target = newValue;

    updateKnobRotation(newValue);
    sendValue(newValue);
  }, [min, max, sendValue, updateKnobRotation]);

  // Handle pointer up
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    isPressedRef.current = false;
    sendRelease();

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    state.target = state.local;

    // Remove press feedback
    if (knobRef.current) {
      knobRef.current.style.transform = "scale(1)";
    }
  }, [sendRelease]);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    const resetValue = bipolar ? (min + max) / 2 : min;
    const state = stateRef.current;

    state.local = resetValue;
    state.visual = resetValue;
    state.target = resetValue;
    state.isLocalUser = true;

    updateKnobRotation(resetValue);
    sendGrab();
    sendValue(resetValue);
    sendRelease();
  }, [bipolar, min, max, sendGrab, sendValue, sendRelease, updateKnobRotation]);

  // Ownership styling
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  // Memoized styles
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    userSelect: "none",
    WebkitUserSelect: "none",
  }), []);

  const knobContainerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: size,
    height: size,
    borderRadius: "50%",
    background: "linear-gradient(145deg, #374151, #1f2937)",
    cursor: "pointer",
    touchAction: "none",
    willChange: "transform",
    transform: "scale(1)",
    transition: "transform 0.1s cubic-bezier(0.25, 0.1, 0.25, 1)",
    boxShadow: ownerColor
      ? isOwnedBySelf
        ? `0 0 8px 2px ${ownerColor}`
        : `0 0 12px 3px ${ownerColor}`
      : "0 2px 4px rgba(0,0,0,0.3)",
  }), [size, ownerColor, isOwnedBySelf]);

  const knobBaseStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: "10%",
    left: "10%",
    width: "80%",
    height: "80%",
    borderRadius: "50%",
    background: "linear-gradient(145deg, #4b5563, #374151)",
    pointerEvents: "none",
    willChange: "transform",
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
  }), []);

  const indicatorStyle = useMemo<React.CSSProperties>(() => {
    const initialRotation = valueToRotation(stateRef.current.visual);
    return {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "60%",
      height: "60%",
      transform: `translate(-50%, -50%) translate3d(0, 0, 0) rotateZ(${initialRotation}deg)`,
      transformOrigin: "center",
      pointerEvents: "none",
      willChange: "transform",
      backfaceVisibility: "hidden",
    };
  }, [valueToRotation]);

  const bipolarMarkerStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 2,
    left: "50%",
    width: 2,
    height: 6,
    background: "#9ca3af",
    transform: "translateX(-50%)",
    borderRadius: 1,
    pointerEvents: "none",
  }), []);

  const labelStyle = useMemo<React.CSSProperties>(() => ({
    fontSize: "0.625rem",
    color: "#6b7280",
    fontWeight: 500,
    pointerEvents: "none",
  }), []);

  return (
    <div style={containerStyle}>
      {label && <span style={labelStyle}>{label}</span>}
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={knobContainerStyle}
      >
        {/* Rotating knob base - GPU accelerated */}
        <div style={knobBaseStyle} />

        {/* SVG Indicator - rotates with value, updated via RAF */}
        <img
          ref={indicatorRef}
          src="/assets/dj-controls/knobs/knob-indicator.svg"
          alt=""
          draggable={false}
          style={indicatorStyle}
        />

        {/* Bipolar center marker */}
        {bipolar && <div style={bipolarMarkerStyle} />}
      </div>
    </div>
  );
});

export default Knob;
