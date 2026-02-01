"use client";

import { useRef, useCallback, useEffect, useMemo, memo } from "react";
import {
  rafManager,
  getCoalescedPointerData,
  clamp,
  type CoalescedPointerData,
} from "../../audio/controlOptimizer";

export type JogWheelProps = {
  /** Deck identifier */
  deckId: "A" | "B";
  /** Accent color for the glow effect */
  accentColor: string;
  /** Size of the jog wheel in pixels */
  size?: number;
  /** Whether the deck is currently playing (affects spin animation) */
  isPlaying?: boolean;
  /** Callback when the wheel is scratched/spun */
  onScratch?: (delta: number) => void;
  /** Optional playback rate for variable speed */
  playbackRate?: number;
};

// Simple momentum physics - no complex prediction
const JOG_PHYSICS = {
  /** Friction during momentum decay - simple linear */
  FRICTION: 0.985,
  /** Minimum velocity before stopping */
  MIN_VELOCITY: 0.05,
  /** Maximum scratch velocity */
  MAX_VELOCITY: 80,
  /** Vinyl RPM at normal playback */
  VINYL_RPM: 33.33,
  /** Degrees per ms at normal speed */
  DEGREES_PER_MS: (33.33 * 360) / 60000,
  /** Scratch sensitivity - 1:1 linear */
  SCRATCH_SENSITIVITY: 1.0,
} as const;

// Triple-buffer state for jog wheel
interface JogWheelState {
  rotation: number;        // Current visual rotation
  targetRotation: number;  // Target rotation
  velocity: number;        // Angular velocity (degrees/frame)
  isDragging: boolean;     // Currently being touched
  lastAngle: number;       // Last pointer angle from center
  isSpinning: boolean;     // Has momentum active
}

/**
 * Professional-grade jog wheel with:
 * - LINEAR 1:1 scratch mapping (no curves)
 * - Simple momentum physics (friction only)
 * - GPU-accelerated transforms: translate3d(0,0,0) rotateZ(deg)
 * - Pointer event coalescing for high-precision tracking
 * - RAF-batched visual updates via shared loop
 * - touch-action: none
 * - pointer-events: none on decorative layers
 */
const JogWheel = memo(function JogWheel({
  deckId,
  accentColor,
  size = 280,
  isPlaying = false,
  onScratch,
  playbackRate = 1.0,
}: JogWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLImageElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<JogWheelState>({
    rotation: 0,
    targetRotation: 0,
    velocity: 0,
    isDragging: false,
    lastAngle: 0,
    isSpinning: false,
  });

  // Tracking refs
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const velocityHistoryRef = useRef<number[]>([]);
  const rafIdRef = useRef<string | null>(null);
  const lastTimeRef = useRef(performance.now());

  // Visual feedback state
  const isDraggingRef = useRef(false);

  // Update disc rotation directly - GPU accelerated
  const updateDiscRotation = useCallback((degrees: number) => {
    if (discRef.current) {
      // GPU-accelerated: translate3d(0,0,0) forces GPU layer
      discRef.current.style.transform = `translate3d(0, 0, 0) rotateZ(${degrees}deg)`;
    }
  }, []);

  // Calculate angle from center of wheel to pointer position
  const getAngleFromCenter = useCallback((clientX: number, clientY: number): number => {
    const wheel = wheelRef.current;
    if (!wheel) return 0;

    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    // Returns angle in degrees, 0 at top, clockwise positive
    return Math.atan2(deltaX, -deltaY) * (180 / Math.PI);
  }, []);

  // Normalize angle difference to handle wrap-around
  const normalizeAngleDiff = useCallback((angle: number): number => {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }, []);

  // Calculate average velocity from history - simple weighted average
  const getAverageVelocity = useCallback((): number => {
    const history = velocityHistoryRef.current;
    if (history.length === 0) return 0;

    // Simple weighted average - recent samples weighted more
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < history.length; i++) {
      const value = history[i];
      if (value === undefined) continue;
      const weight = (i + 1) / history.length;
      weightedSum += value * weight;
      totalWeight += weight;
    }

    return weightedSum / totalWeight;
  }, []);

  // RAF animation callback
  const animationCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;
    const now = performance.now();
    const dt = deltaTime / 16.67; // Normalize to 60fps

    if (state.isDragging) {
      // DRAGGING: immediate 1:1 mapping
      state.rotation = state.targetRotation;
      updateDiscRotation(state.rotation);
      return true;
    }

    // Not dragging: apply physics
    if (state.isSpinning) {
      // Apply momentum with simple friction
      state.velocity *= Math.pow(JOG_PHYSICS.FRICTION, dt);
      state.rotation += state.velocity * dt;

      // Check if should stop
      if (Math.abs(state.velocity) < JOG_PHYSICS.MIN_VELOCITY) {
        state.velocity = 0;
        state.isSpinning = false;
      }

      updateDiscRotation(state.rotation);

      // Report scratch delta
      if (onScratch && Math.abs(state.velocity) > 0.1) {
        onScratch(state.velocity / 360);
      }

      return state.isSpinning;
    }

    // Auto-spin when playing
    if (isPlaying) {
      const elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;

      state.rotation += JOG_PHYSICS.DEGREES_PER_MS * elapsed * playbackRate;
      updateDiscRotation(state.rotation);
      return true;
    }

    return false; // Stop animation loop
  }, [isPlaying, playbackRate, onScratch, updateDiscRotation]);

  // Start RAF loop
  const startAnimation = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = `jogwheel-${deckId}-${Math.random().toString(36).slice(2)}`;
    }
    lastTimeRef.current = performance.now();
    rafManager.register(rafIdRef.current, animationCallback);
  }, [deckId, animationCallback]);

  // Handle playing state changes
  useEffect(() => {
    if (isPlaying && !stateRef.current.isDragging) {
      lastTimeRef.current = performance.now();
      startAnimation();
    }
  }, [isPlaying, startAnimation]);

  // Handle pointer down
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const state = stateRef.current;
    state.isDragging = true;
    state.isSpinning = false;
    state.velocity = 0;
    velocityHistoryRef.current = [];

    const angle = getAngleFromCenter(e.clientX, e.clientY);
    state.lastAngle = angle;
    lastPositionRef.current = { x: e.clientX, y: e.clientY };

    isDraggingRef.current = true;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startAnimation();
  }, [getAngleFromCenter, startAnimation]);

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

    // Process all coalesced points for smooth tracking
    let totalAngleDiff = 0;

    if (data.points.length > 1) {
      let prevAngle = state.lastAngle;
      for (const point of data.points) {
        const currentAngle = getAngleFromCenter(point.x, point.y);
        const angleDiff = normalizeAngleDiff(currentAngle - prevAngle);
        totalAngleDiff += angleDiff;
        prevAngle = currentAngle;
      }
      state.lastAngle = getAngleFromCenter(
        data.points[data.points.length - 1].x,
        data.points[data.points.length - 1].y
      );
    } else {
      const currentAngle = getAngleFromCenter(data.x, data.y);
      totalAngleDiff = normalizeAngleDiff(currentAngle - state.lastAngle);
      state.lastAngle = currentAngle;
    }

    // LINEAR 1:1 mapping - pointer rotation = wheel rotation
    totalAngleDiff *= JOG_PHYSICS.SCRATCH_SENSITIVITY;

    // Immediate update - no interpolation for local user
    state.targetRotation += totalAngleDiff;
    state.rotation = state.targetRotation;

    // Track velocity for momentum (simple history)
    velocityHistoryRef.current.push(totalAngleDiff);
    if (velocityHistoryRef.current.length > 8) {
      velocityHistoryRef.current.shift();
    }

    // Report scratch delta
    if (onScratch) {
      onScratch(totalAngleDiff / 360);
    }

    updateDiscRotation(state.rotation);
  }, [getAngleFromCenter, normalizeAngleDiff, onScratch, updateDiscRotation]);

  // Handle pointer up - apply momentum
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    isDraggingRef.current = false;

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Calculate release velocity
    const avgVelocity = getAverageVelocity();

    // Apply momentum if velocity is significant
    if (Math.abs(avgVelocity) > JOG_PHYSICS.MIN_VELOCITY * 2) {
      state.velocity = clamp(avgVelocity, -JOG_PHYSICS.MAX_VELOCITY, JOG_PHYSICS.MAX_VELOCITY);
      state.isSpinning = true;
      startAnimation();
    } else if (isPlaying) {
      // Resume auto-spin
      startAnimation();
    }
  }, [getAverageVelocity, startAnimation, isPlaying]);

  // Memoized styles
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: size,
    height: size,
    cursor: isDraggingRef.current ? "grabbing" : "grab",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  }), [size]);

  const glowRingStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    boxShadow: `0 0 14px 4px ${accentColor}, inset 0 0 18px rgba(0,0,0,0.75)`,
    pointerEvents: "none",
  }), [accentColor]);

  const discStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    transform: "translate3d(0, 0, 0) rotateZ(0deg)",
    pointerEvents: "none",
    willChange: "transform",
    backfaceVisibility: "hidden",
  }), []);

  const centerCapStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%) translateZ(0)",
    width: "30%",
    height: "30%",
    pointerEvents: "none",
  }), []);

  const touchFeedbackStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${accentColor}25 0%, transparent 55%)`,
    pointerEvents: "none",
    opacity: 0,
    transition: "opacity 0.15s ease-out",
  }), [accentColor]);

  return (
    <div
      ref={wheelRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={containerStyle}
    >
      {/* Outer glow ring - decorative, no pointer events */}
      <div style={glowRingStyle} />

      {/* Rotating disc - updated via RAF */}
      <img
        ref={discRef}
        src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
        alt={`Deck ${deckId} jog wheel`}
        draggable={false}
        style={discStyle}
      />

      {/* Center cap (stationary) - decorative */}
      <img
        src="/assets/dj-controls/wheels/jog-wheel-center-cap.svg"
        alt=""
        draggable={false}
        style={centerCapStyle}
      />

      {/* Touch feedback overlay - decorative */}
      <div style={touchFeedbackStyle} />
    </div>
  );
});

export default JogWheel;
