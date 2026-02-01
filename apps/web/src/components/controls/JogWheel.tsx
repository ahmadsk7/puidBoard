"use client";

import { useRef, useCallback, useEffect, useMemo, memo } from "react";
import {
  rafManager,
  getCoalescedPointerData,
  clamp,
  type CoalescedPointerData,
} from "../../audio/controlOptimizer";
import { getDeck } from "../../audio/useDeck";
import type { ClientMutationEvent } from "@puid-board/shared";

export type JogWheelProps = {
  /** Deck identifier */
  deckId: "A" | "B";
  /** Accent color for the glow effect */
  accentColor: string;
  /** Size of the jog wheel in pixels */
  size?: number;
  /** Whether the deck is currently playing (affects spin animation) */
  isPlaying?: boolean;
  /** Optional playback rate for variable speed */
  playbackRate?: number;
  /** Room ID for network events */
  roomId?: string;
  /** Client ID for network events */
  clientId?: string;
  /** Function to send network events */
  sendEvent?: (e: ClientMutationEvent) => void;
  /** Function to get next sequence number */
  nextSeq?: () => number;
};

// Jog wheel physics and sensitivity settings
const JOG_CONFIG = {
  // Vinyl mode settings (center platter - scratching)
  VINYL: {
    /** Seconds of audio per full rotation */
    SECONDS_PER_ROTATION: 1.8,
    /** Sensitivity multiplier for scratch movement */
    SENSITIVITY: 1.0,
    /** Center zone radius as percentage of wheel radius (0-1) */
    ZONE_RADIUS: 0.65,
  },
  // Pitch bend mode settings (outer ring - nudging)
  PITCH_BEND: {
    /** Max bend amount at full rotation speed */
    MAX_BEND: 1.0,
    /** Degrees per frame to reach max bend */
    DEGREES_FOR_MAX_BEND: 15,
    /** How quickly bend returns to zero on release */
    RELEASE_DECAY: 0.15,
  },
  // Visual rotation settings
  VISUAL: {
    /** Friction during momentum decay */
    FRICTION: 0.985,
    /** Minimum velocity before stopping */
    MIN_VELOCITY: 0.05,
    /** Maximum visual velocity */
    MAX_VELOCITY: 80,
    /** Vinyl RPM at normal playback */
    VINYL_RPM: 33.33,
    /** Degrees per ms at normal speed */
    DEGREES_PER_MS: (33.33 * 360) / 60000,
  },
  // Network throttle
  NETWORK: {
    /** Minimum ms between DECK_SEEK events */
    THROTTLE_MS: 50,
  },
} as const;

// Touch zone types
type TouchZone = "center" | "outer" | null;

// Jog wheel state for RAF loop
interface JogWheelState {
  rotation: number;        // Current visual rotation
  velocity: number;        // Angular velocity (degrees/frame)
  isDragging: boolean;     // Currently being touched
  lastAngle: number;       // Last pointer angle from center
  isSpinning: boolean;     // Has momentum active
  touchZone: TouchZone;    // Which zone is being touched
  currentBend: number;     // Current pitch bend amount (-1 to 1)
}

/**
 * Professional DJ jog wheel with dual-mode operation:
 *
 * 1. VINYL MODE (Center Platter):
 *    - Touch and drag to scratch/scrub audio
 *    - Directly controls playhead position
 *    - Works when playing or paused
 *
 * 2. PITCH BEND MODE (Outer Ring):
 *    - Rotate to temporarily speed up/slow down
 *    - Used for beat matching
 *    - Only active when playing
 *
 * Features:
 * - GPU-accelerated transforms
 * - Pointer event coalescing for smooth tracking
 * - RAF-batched visual updates
 * - Network event throttling
 */
const JogWheel = memo(function JogWheel({
  deckId,
  accentColor,
  size = 280,
  isPlaying = false,
  playbackRate = 1.0,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
}: JogWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLImageElement>(null);

  // State refs for RAF loop (avoid re-renders)
  const stateRef = useRef<JogWheelState>({
    rotation: 0,
    velocity: 0,
    isDragging: false,
    lastAngle: 0,
    isSpinning: false,
    touchZone: null,
    currentBend: 0,
  });

  // Tracking refs
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const velocityHistoryRef = useRef<number[]>([]);
  const rafIdRef = useRef<string | null>(null);
  const lastTimeRef = useRef(performance.now());
  const lastNetworkSendRef = useRef(0);

  // Get the deck instance for audio control
  const deckRef = useRef(getDeck(deckId));

  // Update disc rotation directly - GPU accelerated
  const updateDiscRotation = useCallback((degrees: number) => {
    if (discRef.current) {
      discRef.current.style.transform = `translate3d(0, 0, 0) rotateZ(${degrees}deg)`;
    }
  }, []);

  // Determine which zone was touched based on distance from center
  const getTouchZone = useCallback((clientX: number, clientY: number): TouchZone => {
    const wheel = wheelRef.current;
    if (!wheel) return null;

    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Normalize distance (0 = center, 1 = edge)
    const normalizedDistance = distance / radius;

    // Check if in center zone (vinyl scratching)
    if (normalizedDistance <= JOG_CONFIG.VINYL.ZONE_RADIUS) {
      return "center";
    }

    // Check if in outer ring (pitch bend)
    if (normalizedDistance <= 1.0) {
      return "outer";
    }

    return null;
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

  // Calculate average velocity from history
  const getAverageVelocity = useCallback((): number => {
    const history = velocityHistoryRef.current;
    if (history.length === 0) return 0;

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

  // Send DECK_SEEK event to network (throttled)
  const sendSeekEvent = useCallback((positionSec: number) => {
    if (!sendEvent || !nextSeq || !roomId || !clientId) return;

    const now = performance.now();
    if (now - lastNetworkSendRef.current < JOG_CONFIG.NETWORK.THROTTLE_MS) {
      return;
    }
    lastNetworkSendRef.current = now;

    sendEvent({
      type: "DECK_SEEK",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: {
        deckId,
        positionSec: Math.max(0, positionSec),
      },
    });
  }, [sendEvent, nextSeq, roomId, clientId, deckId]);

  // Handle vinyl scratching (center platter)
  const handleVinylScratch = useCallback((angleDiff: number) => {
    const deck = deckRef.current;

    // Calculate how much audio time this rotation represents
    const rotationFraction = angleDiff / 360;
    const deltaSec = rotationFraction * JOG_CONFIG.VINYL.SECONDS_PER_ROTATION * JOG_CONFIG.VINYL.SENSITIVITY;

    // Apply the scratch to the deck
    deck.scrub(deltaSec);

    // Send network event
    const newPosition = deck.getCurrentPlayhead();
    sendSeekEvent(newPosition);
  }, [sendSeekEvent]);

  // Handle pitch bend (outer ring)
  const handlePitchBend = useCallback((angleDiff: number) => {
    const state = stateRef.current;
    const deck = deckRef.current;

    // Only apply pitch bend when playing
    if (!isPlaying) return;

    // Calculate bend amount based on rotation speed
    const bendDelta = (angleDiff / JOG_CONFIG.PITCH_BEND.DEGREES_FOR_MAX_BEND) * JOG_CONFIG.PITCH_BEND.MAX_BEND;

    // Update current bend (additive for continuous movement)
    state.currentBend = clamp(state.currentBend + bendDelta, -1, 1);

    // Apply nudge to deck
    deck.nudge(state.currentBend);
  }, [isPlaying]);

  // RAF animation callback
  const animationCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;
    const now = performance.now();
    const dt = deltaTime / 16.67; // Normalize to 60fps

    if (state.isDragging) {
      // DRAGGING: keep animation running
      return true;
    }

    // Handle pitch bend decay when not dragging
    if (Math.abs(state.currentBend) > 0.001) {
      state.currentBend *= (1 - JOG_CONFIG.PITCH_BEND.RELEASE_DECAY);
      if (Math.abs(state.currentBend) < 0.001) {
        state.currentBend = 0;
        deckRef.current.releaseNudge();
      } else {
        deckRef.current.nudge(state.currentBend);
      }
    }

    // Handle visual momentum spinning
    if (state.isSpinning) {
      state.velocity *= Math.pow(JOG_CONFIG.VISUAL.FRICTION, dt);
      state.rotation += state.velocity * dt;

      if (Math.abs(state.velocity) < JOG_CONFIG.VISUAL.MIN_VELOCITY) {
        state.velocity = 0;
        state.isSpinning = false;
      }

      updateDiscRotation(state.rotation);
      return state.isSpinning || Math.abs(state.currentBend) > 0.001;
    }

    // Auto-spin when playing (visual feedback)
    if (isPlaying) {
      const elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;

      state.rotation += JOG_CONFIG.VISUAL.DEGREES_PER_MS * elapsed * playbackRate;
      updateDiscRotation(state.rotation);
      return true;
    }

    return Math.abs(state.currentBend) > 0.001;
  }, [isPlaying, playbackRate, updateDiscRotation]);

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
    const zone = getTouchZone(e.clientX, e.clientY);

    if (!zone) return;

    state.isDragging = true;
    state.isSpinning = false;
    state.velocity = 0;
    state.touchZone = zone;
    velocityHistoryRef.current = [];

    const angle = getAngleFromCenter(e.clientX, e.clientY);
    state.lastAngle = angle;
    lastPositionRef.current = { x: e.clientX, y: e.clientY };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startAnimation();
  }, [getTouchZone, getAngleFromCenter, startAnimation]);

  // Handle pointer move
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    // Get coalesced events for high-precision tracking
    const data: CoalescedPointerData = getCoalescedPointerData(
      e.nativeEvent,
      lastPositionRef.current
    );
    lastPositionRef.current = { x: data.x, y: data.y };

    // Calculate total angle difference from all coalesced points
    let totalAngleDiff = 0;

    if (data.points.length > 1) {
      let prevAngle = state.lastAngle;
      for (const point of data.points) {
        const currentAngle = getAngleFromCenter(point.x, point.y);
        const angleDiff = normalizeAngleDiff(currentAngle - prevAngle);
        totalAngleDiff += angleDiff;
        prevAngle = currentAngle;
      }
      const lastPoint = data.points[data.points.length - 1];
      if (lastPoint) {
        state.lastAngle = getAngleFromCenter(lastPoint.x, lastPoint.y);
      }
    } else {
      const currentAngle = getAngleFromCenter(data.x, data.y);
      totalAngleDiff = normalizeAngleDiff(currentAngle - state.lastAngle);
      state.lastAngle = currentAngle;
    }

    // Update visual rotation
    state.rotation += totalAngleDiff;
    updateDiscRotation(state.rotation);

    // Track velocity for momentum
    velocityHistoryRef.current.push(totalAngleDiff);
    if (velocityHistoryRef.current.length > 8) {
      velocityHistoryRef.current.shift();
    }

    // Apply appropriate action based on touch zone
    if (state.touchZone === "center") {
      // Vinyl mode - scratch the audio
      handleVinylScratch(totalAngleDiff);
    } else if (state.touchZone === "outer") {
      // Pitch bend mode - nudge playback speed
      handlePitchBend(totalAngleDiff);
    }
  }, [getAngleFromCenter, normalizeAngleDiff, updateDiscRotation, handleVinylScratch, handlePitchBend]);

  // Handle pointer up
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (!state.isDragging) return;

    state.isDragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Release pitch bend if we were in outer zone
    if (state.touchZone === "outer") {
      // Bend will decay in animation callback
    }

    state.touchZone = null;

    // Calculate release velocity for visual momentum
    const avgVelocity = getAverageVelocity();

    if (Math.abs(avgVelocity) > JOG_CONFIG.VISUAL.MIN_VELOCITY * 2) {
      state.velocity = clamp(avgVelocity, -JOG_CONFIG.VISUAL.MAX_VELOCITY, JOG_CONFIG.VISUAL.MAX_VELOCITY);
      state.isSpinning = true;
      startAnimation();
    } else if (isPlaying || Math.abs(state.currentBend) > 0.001) {
      startAnimation();
    }
  }, [getAverageVelocity, startAnimation, isPlaying]);

  // Memoized styles
  const containerStyle = useMemo<React.CSSProperties>(() => ({
    position: "relative",
    width: size,
    height: size,
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  }), [size]);

  // Outer ring style (pitch bend zone)
  const outerRingStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    boxShadow: `0 0 14px 4px ${accentColor}, inset 0 0 18px rgba(0,0,0,0.75)`,
    pointerEvents: "none",
  }), [accentColor]);

  // Center platter indicator (vinyl zone)
  const centerZoneStyle = useMemo<React.CSSProperties>(() => {
    const centerSize = JOG_CONFIG.VINYL.ZONE_RADIUS * 100;
    return {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: `${centerSize}%`,
      height: `${centerSize}%`,
      transform: "translate(-50%, -50%)",
      borderRadius: "50%",
      border: `2px solid ${accentColor}40`,
      pointerEvents: "none",
      opacity: 0.5,
    };
  }, [accentColor]);

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

  return (
    <div
      ref={wheelRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={containerStyle}
    >
      {/* Outer glow ring - pitch bend zone indicator */}
      <div style={outerRingStyle} />

      {/* Rotating disc - updated via RAF */}
      <img
        ref={discRef}
        src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
        alt={`Deck ${deckId} jog wheel`}
        draggable={false}
        style={discStyle}
      />

      {/* Center vinyl zone indicator */}
      <div style={centerZoneStyle} />

      {/* Center cap (stationary) */}
      <img
        src="/assets/dj-controls/wheels/jog-wheel-center-cap.svg"
        alt=""
        draggable={false}
        style={centerCapStyle}
      />
    </div>
  );
});

export default JogWheel;
