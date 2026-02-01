"use client";

import { useRef, useCallback, useEffect, useState, useMemo, memo } from "react";
import type { ClientMutationEvent, ControlOwnership } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";
import {
  rafManager,
  getCoalescedPointerData,
  createVelocityPredictor,
  predictValue,
  resetPredictor,
  expLerp,
  clamp,
  approxEqual,
  SMOOTHING,
  rotate3d,
  combineTransforms,
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
};

// Triple-buffer state for smooth visual updates
interface KnobState {
  visual: number;     // Smoothed value for rendering
  local: number;      // Raw input value
  network: number;    // Throttled network value
  target: number;     // Target for interpolation
  isDragging: boolean;
}

/**
 * Professional-grade rotary knob control with:
 * - RAF-batched visual updates at 60fps
 * - Pointer event coalescing for high-precision tracking
 * - Triple-buffer state management
 * - GPU-accelerated transforms
 * - Predictive smoothing for reduced latency
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
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLImageElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<KnobState>({
    visual: value,
    local: value,
    network: value,
    target: value,
    isDragging: false,
  });

  // Pointer tracking refs
  const startYRef = useRef(0);
  const startValueRef = useRef(0);
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const predictorRef = useRef(createVelocityPredictor(5));
  const lastSendRef = useRef(0);
  const rafIdRef = useRef<string | null>(null);

  // Visual rotation state (only this triggers re-render when needed)
  const [visualRotation, setVisualRotation] = useState(() => {
    const normalized = (value - min) / (max - min);
    return -135 + normalized * 270;
  });

  // Animation state for micro-feedback
  const [isPressed, setIsPressed] = useState(false);

  // Calculate rotation from value
  const valueToRotation = useCallback((v: number) => {
    const normalized = (v - min) / (max - min);
    return -135 + normalized * 270;
  }, [min, max]);

  // RAF animation loop for smooth visual updates
  const animationCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;

    // If not dragging and at target, stop animation
    if (!state.isDragging && approxEqual(state.visual, state.target, 0.0001)) {
      state.visual = state.target;
      // Update DOM directly for final position
      if (indicatorRef.current) {
        const rotation = valueToRotation(state.visual);
        indicatorRef.current.style.transform =
          combineTransforms('translate(-50%, -50%)', rotate3d(rotation));
      }
      return false; // Stop RAF
    }

    // Calculate smoothing factor based on delta time
    const dt = deltaTime / 16.67; // Normalize to 60fps
    const smoothing = state.isDragging ? SMOOTHING.INSTANT : SMOOTHING.FAST;

    // Smooth interpolation towards target
    state.visual = expLerp(state.visual, state.target, smoothing * dt);

    // Update DOM directly (bypass React for performance)
    if (indicatorRef.current) {
      const rotation = valueToRotation(state.visual);
      indicatorRef.current.style.transform =
        combineTransforms('translate(-50%, -50%)', rotate3d(rotation));
    }

    return true; // Continue RAF
  }, [valueToRotation]);

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
      state.network = value;
      startAnimation();
    }
  }, [value, startAnimation]);

  // Send network event with throttling
  const sendValue = useCallback((newValue: number) => {
    const now = Date.now();
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

    startYRef.current = e.clientY;
    startValueRef.current = state.visual;
    lastPositionRef.current = { x: e.clientX, y: e.clientY };
    resetPredictor(predictorRef.current);

    setIsPressed(true);
    sendGrab();

    // Set pointer capture on the outer container
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    // Start animation loop
    startAnimation();
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

    // Calculate delta from all coalesced points
    let totalDeltaY = 0;
    if (data.points.length > 1) {
      for (let i = 1; i < data.points.length; i++) {
        totalDeltaY += data.points[i - 1].y - data.points[i].y;
      }
    } else {
      totalDeltaY = startYRef.current - data.y;
    }

    // Convert delta to value change
    const sensitivity = 200; // pixels for full range
    const deltaValue = (totalDeltaY / sensitivity) * (max - min);

    // Use predictor for reduced latency feel
    const rawValue = clamp(startValueRef.current + deltaValue, min, max);
    const predictedValue = predictValue(predictorRef.current, rawValue, 8);
    const newValue = clamp(predictedValue, min, max);

    // Update triple buffer
    state.local = newValue;
    state.target = newValue;

    // Send throttled network update
    sendValue(newValue);
  }, [min, max, sendValue]);

  // Handle pointer up
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    setIsPressed(false);
    sendRelease();

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Snap to final position
    state.target = state.local;
    startAnimation();
  }, [sendRelease, startAnimation]);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    const resetValue = bipolar ? (min + max) / 2 : min;
    const state = stateRef.current;

    state.local = resetValue;
    state.target = resetValue;

    sendGrab();
    sendValue(resetValue);
    sendRelease();
    startAnimation();
  }, [bipolar, min, max, sendGrab, sendValue, sendRelease, startAnimation]);

  // Ownership styling
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  // Memoized styles for performance
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    userSelect: "none",
  }), []);

  const knobContainerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: size,
    height: size,
    borderRadius: "50%",
    background: "linear-gradient(145deg, #374151, #1f2937)",
    cursor: "pointer",
    touchAction: "none",
    willChange: isPressed ? "transform" : "auto",
    transform: isPressed ? "scale(0.98)" : "scale(1)",
    transition: "transform 0.1s cubic-bezier(0.25, 0.1, 0.25, 1)",
    boxShadow: ownerColor
      ? isOwnedBySelf
        ? `0 0 8px 2px ${ownerColor}`
        : `0 0 12px 3px ${ownerColor}`
      : "0 2px 4px rgba(0,0,0,0.3)",
  }), [size, isPressed, ownerColor, isOwnedBySelf]);

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

  // Initial rotation for the indicator
  const initialRotation = useMemo(() => {
    return valueToRotation(stateRef.current.visual);
  }, []); // Only compute once on mount

  const indicatorStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "60%",
    height: "60%",
    transform: combineTransforms('translate(-50%, -50%)', rotate3d(initialRotation)),
    transformOrigin: "center",
    pointerEvents: "none",
    willChange: "transform",
    backfaceVisibility: "hidden",
  }), [initialRotation]);

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
