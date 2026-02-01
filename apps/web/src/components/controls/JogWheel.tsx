"use client";

import { useRef, useCallback, useState, useEffect, useMemo, memo } from "react";
import {
  rafManager,
  getCoalescedPointerData,
  expLerp,
  clamp,
  approxEqual,
  SMOOTHING,
  PHYSICS,
  rotate3d,
  combineTransforms,
  createVelocityPredictor,
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

// Physics configuration for professional feel
const JOG_PHYSICS = {
  /** Friction during momentum decay */
  FRICTION: 0.985,
  /** Minimum velocity before stopping */
  MIN_VELOCITY: 0.05,
  /** Maximum scratch velocity */
  MAX_VELOCITY: 80,
  /** Velocity smoothing factor */
  VELOCITY_SMOOTHING: 0.7,
  /** Vinyl RPM at normal playback */
  VINYL_RPM: 33.33,
  /** Degrees per ms at normal speed */
  DEGREES_PER_MS: (33.33 * 360) / 60000,
  /** Scratch sensitivity multiplier */
  SCRATCH_SENSITIVITY: 1.2,
} as const;

// Triple-buffer state for jog wheel
interface JogWheelState {
  rotation: number;        // Current visual rotation
  targetRotation: number;  // Target rotation for interpolation
  velocity: number;        // Angular velocity (degrees/frame)
  smoothedVelocity: number; // Smoothed velocity for momentum
  isDragging: boolean;     // Currently being touched
  lastAngle: number;       // Last pointer angle from center
  isSpinning: boolean;     // Has momentum active
}

/**
 * Professional-grade jog wheel with:
 * - Enhanced momentum physics with realistic vinyl friction
 * - RAF-batched visual updates at 60fps
 * - Pointer event coalescing for high-precision tracking
 * - GPU-accelerated transforms with will-change
 * - Natural scratch feel with velocity smoothing
 * - Auto-spin when playing (vinyl simulation)
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
    smoothedVelocity: 0,
    isDragging: false,
    lastAngle: 0,
    isSpinning: false,
  });

  // Tracking refs
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const velocityHistoryRef = useRef<number[]>([]);
  const rafIdRef = useRef<string | null>(null);
  const lastTimeRef = useRef(performance.now());

  // Visual state for UI feedback (minimized re-renders)
  const [isDragging, setIsDragging] = useState(false);

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

  // Calculate average velocity from history for smooth momentum
  const getAverageVelocity = useCallback((): number => {
    const history = velocityHistoryRef.current;
    if (history.length === 0) return 0;

    // Weight recent samples more heavily
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < history.length; i++) {
      const weight = (i + 1) / history.length;
      weightedSum += history[i] * weight;
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
      // During drag: smooth towards target
      state.rotation = expLerp(state.rotation, state.targetRotation, SMOOTHING.INSTANT * dt);

      // Update DOM directly
      if (discRef.current) {
        discRef.current.style.transform = rotate3d(state.rotation);
      }
      return true;
    }

    // Not dragging: apply physics
    if (state.isSpinning) {
      // Apply momentum with friction
      state.velocity *= Math.pow(JOG_PHYSICS.FRICTION, dt);
      state.rotation += state.velocity * dt;

      // Check if should stop
      if (Math.abs(state.velocity) < JOG_PHYSICS.MIN_VELOCITY) {
        state.velocity = 0;
        state.isSpinning = false;
      }

      // Update DOM directly
      if (discRef.current) {
        discRef.current.style.transform = rotate3d(state.rotation);
      }

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

      // Update DOM directly
      if (discRef.current) {
        discRef.current.style.transform = rotate3d(state.rotation);
      }
      return true;
    }

    return false; // Stop animation loop
  }, [isPlaying, playbackRate, onScratch]);

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

  // Handle pointer down - start dragging
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

    setIsDragging(true);

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
      // Process all intermediate points
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

    // Apply scratch sensitivity
    totalAngleDiff *= JOG_PHYSICS.SCRATCH_SENSITIVITY;

    // Update rotation target
    state.targetRotation += totalAngleDiff;

    // Track velocity for momentum
    const instantVelocity = totalAngleDiff;
    velocityHistoryRef.current.push(instantVelocity);
    if (velocityHistoryRef.current.length > 8) {
      velocityHistoryRef.current.shift();
    }

    // Smooth velocity update
    state.smoothedVelocity = expLerp(
      state.smoothedVelocity,
      instantVelocity,
      JOG_PHYSICS.VELOCITY_SMOOTHING
    );

    // Report scratch delta
    if (onScratch) {
      onScratch(totalAngleDiff / 360);
    }
  }, [getAngleFromCenter, normalizeAngleDiff, onScratch]);

  // Handle pointer up - release and apply momentum
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    setIsDragging(false);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        // RAF manager handles cleanup automatically
      }
    };
  }, []);

  // Memoized styles for performance
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: size,
    height: size,
    cursor: isDragging ? "grabbing" : "grab",
    touchAction: "none",
    userSelect: "none",
    willChange: isDragging ? "transform" : "auto",
  }), [size, isDragging]);

  const glowRingStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    boxShadow: isDragging
      ? `0 0 24px 8px ${accentColor}, inset 0 0 25px rgba(0,0,0,0.85)`
      : `0 0 14px 4px ${accentColor}, inset 0 0 18px rgba(0,0,0,0.75)`,
    transition: "box-shadow 0.15s cubic-bezier(0.25, 0.1, 0.25, 1)",
    pointerEvents: "none",
    willChange: "box-shadow",
  }), [isDragging, accentColor]);

  const discStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    transform: rotate3d(0),
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
    willChange: "auto",
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
    opacity: isDragging ? 1 : 0,
    transition: "opacity 0.15s ease-out",
    willChange: "opacity",
  }), [accentColor, isDragging]);

  // Velocity indicator ring (shows momentum direction)
  const velocityIndicatorStyle = useMemo<React.CSSProperties>(() => {
    const velocity = stateRef.current.smoothedVelocity;
    const intensity = Math.min(Math.abs(velocity) / 20, 1);
    const direction = velocity > 0 ? 1 : -1;

    return {
      position: "absolute",
      top: "5%",
      left: "5%",
      width: "90%",
      height: "90%",
      borderRadius: "50%",
      border: `2px solid ${accentColor}`,
      opacity: intensity * 0.5,
      transform: `scale(${1 + intensity * 0.05})`,
      pointerEvents: "none",
      transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
    };
  }, [accentColor, stateRef.current.smoothedVelocity]);

  return (
    <div
      ref={wheelRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={containerStyle}
    >
      {/* Outer glow ring */}
      <div style={glowRingStyle} />

      {/* Velocity indicator */}
      <div style={velocityIndicatorStyle} />

      {/* Rotating disc - updated via RAF */}
      <img
        ref={discRef}
        src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
        alt={`Deck ${deckId} jog wheel`}
        draggable={false}
        style={discStyle}
      />

      {/* Center cap (stationary) */}
      <img
        src="/assets/dj-controls/wheels/jog-wheel-center-cap.svg"
        alt=""
        draggable={false}
        style={centerCapStyle}
      />

      {/* Touch feedback overlay */}
      <div style={touchFeedbackStyle} />
    </div>
  );
});

export default JogWheel;
