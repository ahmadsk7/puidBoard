/**
 * Professional-grade control optimization system for DJ components
 *
 * Architecture follows Native Instruments, Pioneer DJ, and Serato patterns:
 *
 * Control Pipeline:
 * pointer -> local state (immediate, no lag)
 *         -> RAF render (smooth visual only)
 *         -> network events @ 20-30hz (throttled)
 *
 * CRITICAL RULES:
 * 1. LINEAR 1:1 mapping - NO easing curves (feels fake on instruments)
 * 2. Local = never interpolate - immediate response
 * 3. Remote = interpolate - smooth other users' movements
 * 4. Event-based networking - send deltas with timestamps
 *
 * Performance targets:
 * - <5ms local input latency (visual feedback)
 * - 60fps constant during interaction
 * - <1% CPU usage when idle
 * - Zero jank on pointer move
 * - Feels like real DJ hardware
 */

import { useRef, useCallback, useEffect, useMemo } from "react";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/** Target frame rate for RAF loop */
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;

/**
 * Smoothing factors
 * IMPORTANT: Local controls use INSTANT (1.0) for raw 1:1 mapping
 * Only remote users get interpolation smoothing
 */
export const SMOOTHING = {
  /** For local user - NO smoothing, raw 1:1 input */
  INSTANT: 1.0,
  /** For remote user interpolation - fast but smooth */
  REMOTE_FAST: 0.25,
  /** For remote user interpolation - balanced */
  REMOTE_MEDIUM: 0.15,
  /** Legacy compatibility values */
  FAST: 0.65,
  MEDIUM: 0.45,
  SLOW: 0.25,
  GENTLE: 0.12,
} as const;

/** Physics constants for momentum-based controls */
export const PHYSICS = {
  /** Friction coefficient for momentum decay */
  FRICTION: 0.92,
  /** High friction for quick stop */
  HIGH_FRICTION: 0.85,
  /** Low friction for long spin */
  LOW_FRICTION: 0.97,
  /** Minimum velocity threshold */
  MIN_VELOCITY: 0.001,
  /** Maximum velocity cap */
  MAX_VELOCITY: 50,
} as const;

/** Network throttle timing (ms) - optimized for 20-30hz */
export const NETWORK_THROTTLE = {
  /** Fast updates for real-time controls (~30hz) */
  FAST: 33,
  /** Normal update rate (~20hz) */
  NORMAL: 50,
  /** Slow updates for less critical data */
  SLOW: 100,
} as const;

// ============================================================================
// CONTROL EVENT STRUCTURE (for network sync)
// ============================================================================

/**
 * Control event with timestamp and delta for network sync
 */
export interface ControlMoveEvent {
  type: "CONTROL_MOVE";
  controlId: string;
  timestamp: number;       // performance.now() for precision
  value: number;           // Absolute value
  delta?: number;          // For relative controls (jog wheel)
  isLocalUser: boolean;    // Whether this is from the local user
}

/**
 * Create a control move event with high-res timestamp
 */
export function createControlEvent(
  controlId: string,
  value: number,
  delta?: number,
  isLocalUser: boolean = true
): ControlMoveEvent {
  return {
    type: "CONTROL_MOVE",
    controlId,
    timestamp: performance.now(),
    value,
    delta,
    isLocalUser,
  };
}

// ============================================================================
// EASING FUNCTIONS
// ============================================================================

/**
 * Cubic bezier easing for natural movement feel
 * Pre-computed for common use cases
 */
export const easing = {
  /** Linear interpolation */
  linear: (t: number): number => t,

  /** Ease out cubic - decelerating movement */
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),

  /** Ease in out cubic - smooth acceleration and deceleration */
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  /** Ease out quart - faster deceleration */
  easeOutQuart: (t: number): number => 1 - Math.pow(1 - t, 4),

  /** Ease out expo - exponential deceleration (feels like friction) */
  easeOutExpo: (t: number): number => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),

  /** Spring-like overshoot and settle */
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },

  /** Custom DJ feel - quick response, smooth settle */
  djSnap: (t: number): number => {
    if (t < 0.5) {
      return 2 * t * t;
    }
    return 1 - Math.pow(-2 * t + 2, 2) / 2;
  },
} as const;

/**
 * Custom cubic bezier implementation for precise control
 */
export function cubicBezier(
  p1x: number, p1y: number,
  p2x: number, p2y: number
): (t: number) => number {
  // Newton-Raphson iteration for t
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleCurveDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveCurveX = (x: number): number => {
    let t2 = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < 1e-6) return t2;
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < 1e-6) break;
      t2 = t2 - x2 / d2;
    }
    return t2;
  };

  return (t: number) => sampleCurveY(solveCurveX(t));
}

// Pre-computed bezier curves for common use cases
export const bezierCurves = {
  /** Material Design standard curve */
  standard: cubicBezier(0.4, 0.0, 0.2, 1.0),
  /** Quick start, slow end */
  decelerate: cubicBezier(0.0, 0.0, 0.2, 1.0),
  /** Slow start, quick end */
  accelerate: cubicBezier(0.4, 0.0, 1.0, 1.0),
  /** DJ control feel */
  djControl: cubicBezier(0.25, 0.1, 0.25, 1.0),
} as const;

// ============================================================================
// CORE UTILITIES
// ============================================================================

/**
 * Linear interpolation (lerp) with clamping
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, t));
}

/**
 * Exponential interpolation for smoother transitions
 */
export function expLerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a value from one range to another
 */
export function normalize(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number = 0,
  outMax: number = 1
): number {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Check if two values are approximately equal
 */
export function approxEqual(a: number, b: number, epsilon: number = 0.0001): boolean {
  return Math.abs(a - b) < epsilon;
}

// ============================================================================
// TRIPLE BUFFER STATE MANAGEMENT
// ============================================================================

/**
 * Triple-buffer state for separating visual, local, and network states
 *
 * - Visual: Smoothed value for rendering (60fps interpolated)
 * - Local: Immediate input value (raw pointer position)
 * - Network: Throttled value for network sync
 */
export interface TripleBufferState {
  /** Smoothed visual value for rendering */
  visual: number;
  /** Raw local input value */
  local: number;
  /** Throttled network-synced value */
  network: number;
  /** Target value for interpolation */
  target: number;
  /** Velocity for momentum physics */
  velocity: number;
  /** Last update timestamp */
  lastUpdate: number;
  /** Is currently being interacted with */
  isActive: boolean;
}

/**
 * Create initial triple buffer state
 */
export function createTripleBuffer(initialValue: number = 0): TripleBufferState {
  return {
    visual: initialValue,
    local: initialValue,
    network: initialValue,
    target: initialValue,
    velocity: 0,
    lastUpdate: performance.now(),
    isActive: false,
  };
}

/**
 * Update triple buffer with new input
 */
export function updateTripleBuffer(
  state: TripleBufferState,
  newValue: number,
  deltaTime: number,
  smoothingFactor: number = SMOOTHING.FAST
): TripleBufferState {
  const now = performance.now();
  const dt = deltaTime / 16.67; // Normalize to 60fps

  // Calculate velocity from change
  const delta = newValue - state.local;
  const newVelocity = delta / Math.max(dt, 0.001);

  // Update local immediately
  const local = newValue;

  // Interpolate visual towards local
  const visual = expLerp(state.visual, local, smoothingFactor * dt);

  return {
    ...state,
    visual,
    local,
    target: newValue,
    velocity: newVelocity,
    lastUpdate: now,
    isActive: true,
  };
}

// ============================================================================
// RAF ANIMATION MANAGER
// ============================================================================

type AnimationCallback = (deltaTime: number, timestamp: number) => boolean | void;

/**
 * Singleton RAF manager for batched animations
 * Ensures all control animations are synchronized at 60fps
 */
class RAFManager {
  private callbacks: Map<string, AnimationCallback> = new Map();
  private rafId: number | null = null;
  private lastTime: number = 0;
  private isRunning: boolean = false;

  /**
   * Register an animation callback
   * Returns cleanup function
   */
  register(id: string, callback: AnimationCallback): () => void {
    this.callbacks.set(id, callback);

    if (!this.isRunning && this.callbacks.size > 0) {
      this.start();
    }

    return () => {
      this.callbacks.delete(id);
      if (this.callbacks.size === 0) {
        this.stop();
      }
    };
  }

  /**
   * Start the RAF loop
   */
  private start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  /**
   * Stop the RAF loop
   */
  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRunning = false;
  }

  /**
   * Main tick function
   */
  private tick = (timestamp: number): void => {
    if (!this.isRunning) return;

    const deltaTime = Math.min(timestamp - this.lastTime, FRAME_TIME * 2); // Cap delta
    this.lastTime = timestamp;

    // Execute all callbacks, remove if they return false
    const toRemove: string[] = [];

    this.callbacks.forEach((callback, id) => {
      try {
        const result = callback(deltaTime, timestamp);
        if (result === false) {
          toRemove.push(id);
        }
      } catch (e) {
        console.error(`RAF callback error for ${id}:`, e);
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => this.callbacks.delete(id));

    if (this.callbacks.size > 0) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.stop();
    }
  };
}

/** Singleton instance */
export const rafManager = new RAFManager();

// ============================================================================
// POINTER EVENT COALESCING
// ============================================================================

export interface CoalescedPointerData {
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Movement delta X */
  deltaX: number;
  /** Movement delta Y */
  deltaY: number;
  /** Pressure (0-1) */
  pressure: number;
  /** Tilt X angle */
  tiltX: number;
  /** Tilt Y angle */
  tiltY: number;
  /** All coalesced points */
  points: Array<{ x: number; y: number; pressure: number }>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Extract coalesced pointer events for high-precision tracking
 * Uses getCoalescedEvents() when available for sub-frame precision
 */
export function getCoalescedPointerData(
  event: PointerEvent,
  lastPosition: { x: number; y: number } | null = null
): CoalescedPointerData {
  const points: Array<{ x: number; y: number; pressure: number }> = [];

  // Try to get coalesced events (high-precision tracking)
  if ('getCoalescedEvents' in event && typeof event.getCoalescedEvents === 'function') {
    try {
      const coalescedEvents = event.getCoalescedEvents();
      coalescedEvents.forEach(e => {
        points.push({
          x: e.clientX,
          y: e.clientY,
          pressure: e.pressure,
        });
      });
    } catch {
      // Fallback if getCoalescedEvents fails
    }
  }

  // Always include main event
  if (points.length === 0) {
    points.push({
      x: event.clientX,
      y: event.clientY,
      pressure: event.pressure,
    });
  }

  const last = points[points.length - 1] ?? { x: event.clientX, y: event.clientY, pressure: event.pressure };
  const first = lastPosition ?? points[0] ?? last;

  return {
    x: last.x,
    y: last.y,
    deltaX: last.x - first.x,
    deltaY: last.y - first.y,
    pressure: last.pressure,
    tiltX: event.tiltX ?? 0,
    tiltY: event.tiltY ?? 0,
    points,
    timestamp: event.timeStamp,
  };
}

// ============================================================================
// PREDICTIVE SMOOTHING
// ============================================================================

/**
 * Velocity-based predictor for reducing perceived latency
 */
export interface VelocityPredictor {
  samples: Array<{ value: number; time: number }>;
  maxSamples: number;
}

/**
 * Create a velocity predictor
 */
export function createVelocityPredictor(maxSamples: number = 5): VelocityPredictor {
  return {
    samples: [],
    maxSamples,
  };
}

/**
 * Add sample and get predicted value
 */
export function predictValue(
  predictor: VelocityPredictor,
  value: number,
  lookaheadMs: number = 16
): number {
  const now = performance.now();

  // Add new sample
  predictor.samples.push({ value, time: now });

  // Trim old samples
  while (predictor.samples.length > predictor.maxSamples) {
    predictor.samples.shift();
  }

  // Need at least 2 samples to predict
  if (predictor.samples.length < 2) {
    return value;
  }

  // Calculate average velocity
  let totalVelocity = 0;
  let count = 0;

  for (let i = 1; i < predictor.samples.length; i++) {
    const prev = predictor.samples[i - 1];
    const curr = predictor.samples[i];
    if (!prev || !curr) continue;

    const dt = curr.time - prev.time;

    if (dt > 0) {
      totalVelocity += (curr.value - prev.value) / dt;
      count++;
    }
  }

  if (count === 0) return value;

  const avgVelocity = totalVelocity / count;

  // Predict future value
  return value + avgVelocity * lookaheadMs;
}

/**
 * Reset predictor state
 */
export function resetPredictor(predictor: VelocityPredictor): void {
  predictor.samples = [];
}

// ============================================================================
// REACT HOOKS
// ============================================================================

/**
 * Hook for smoothed control values with RAF updates
 *
 * @param initialValue - Starting value
 * @param smoothingFactor - How quickly to interpolate (0-1)
 * @returns [visualValue, setTarget, state]
 */
export function useSmoothedControl(
  initialValue: number = 0,
  smoothingFactor: number = SMOOTHING.FAST
): [
  number,
  (target: number) => void,
  React.MutableRefObject<TripleBufferState>
] {
  const stateRef = useRef<TripleBufferState>(createTripleBuffer(initialValue));
  const visualRef = useRef(initialValue);
  const callbackIdRef = useRef<string>(`smooth-${Math.random().toString(36).slice(2)}`);

  // Stable callback for RAF
  const updateCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;

    // Skip if not active and at target
    if (!state.isActive && approxEqual(state.visual, state.target)) {
      return false; // Unregister callback
    }

    // Smooth interpolation
    const dt = deltaTime / 16.67;
    const newVisual = expLerp(state.visual, state.target, smoothingFactor * dt);

    // Update state
    state.visual = newVisual;
    visualRef.current = newVisual;

    // Check if settled
    if (!state.isActive && approxEqual(newVisual, state.target)) {
      state.visual = state.target;
      return false;
    }

    return true; // Keep running
  }, [smoothingFactor]);

  // Set target value
  const setTarget = useCallback((target: number) => {
    const state = stateRef.current;
    state.target = target;
    state.local = target;
    state.isActive = true;

    // Register RAF callback if not running
    rafManager.register(callbackIdRef.current, updateCallback);
  }, [updateCallback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup is handled by rafManager
    };
  }, []);

  return [visualRef.current, setTarget, stateRef];
}

/**
 * Hook for optimized pointer tracking with coalescing
 *
 * @returns Pointer tracking utilities
 */
export function useOptimizedPointer() {
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const predictorRef = useRef(createVelocityPredictor());
  const isActiveRef = useRef(false);

  /**
   * Handle pointer down
   */
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    isActiveRef.current = true;
    lastPositionRef.current = { x: event.clientX, y: event.clientY };
    resetPredictor(predictorRef.current);

    // Set pointer capture
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
  }, []);

  /**
   * Handle pointer move with coalescing
   */
  const handlePointerMove = useCallback((
    event: React.PointerEvent,
    callback: (data: CoalescedPointerData) => void
  ) => {
    if (!isActiveRef.current) return;

    const data = getCoalescedPointerData(
      event.nativeEvent,
      lastPositionRef.current
    );

    lastPositionRef.current = { x: data.x, y: data.y };
    callback(data);
  }, []);

  /**
   * Handle pointer up
   */
  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    isActiveRef.current = false;
    lastPositionRef.current = null;

    // Release pointer capture
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
  }, []);

  /**
   * Get predicted value
   */
  const getPredictedValue = useCallback((currentValue: number, lookaheadMs: number = 16) => {
    return predictValue(predictorRef.current, currentValue, lookaheadMs);
  }, []);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    getPredictedValue,
    isActive: isActiveRef,
  };
}

/**
 * Hook for physics-based momentum (jog wheel, etc.)
 */
export function useMomentumPhysics(options: {
  friction?: number;
  minVelocity?: number;
  maxVelocity?: number;
  onUpdate?: (value: number, velocity: number) => void;
} = {}) {
  const {
    friction = PHYSICS.FRICTION,
    minVelocity = PHYSICS.MIN_VELOCITY,
    maxVelocity = PHYSICS.MAX_VELOCITY,
    onUpdate,
  } = options;

  const stateRef = useRef({
    value: 0,
    velocity: 0,
    isActive: false,
  });

  const callbackIdRef = useRef(`momentum-${Math.random().toString(36).slice(2)}`);

  // Physics update callback
  const physicsCallback = useCallback((deltaTime: number): boolean | void => {
    const state = stateRef.current;

    if (!state.isActive && Math.abs(state.velocity) < minVelocity) {
      state.velocity = 0;
      return false;
    }

    // Apply velocity
    const dt = deltaTime / 16.67;
    state.value += state.velocity * dt;

    // Apply friction when not active
    if (!state.isActive) {
      state.velocity *= Math.pow(friction, dt);
    }

    // Cap velocity
    state.velocity = clamp(state.velocity, -maxVelocity, maxVelocity);

    // Callback
    onUpdate?.(state.value, state.velocity);

    // Check if should stop
    if (!state.isActive && Math.abs(state.velocity) < minVelocity) {
      state.velocity = 0;
      return false;
    }

    return true;
  }, [friction, minVelocity, maxVelocity, onUpdate]);

  /**
   * Start momentum with initial velocity
   */
  const startMomentum = useCallback((velocity: number) => {
    stateRef.current.velocity = clamp(velocity, -maxVelocity, maxVelocity);
    stateRef.current.isActive = false;
    rafManager.register(callbackIdRef.current, physicsCallback);
  }, [maxVelocity, physicsCallback]);

  /**
   * Apply direct input (while dragging)
   */
  const applyInput = useCallback((delta: number) => {
    stateRef.current.isActive = true;
    stateRef.current.value += delta;
    stateRef.current.velocity = delta;
    rafManager.register(callbackIdRef.current, physicsCallback);
  }, [physicsCallback]);

  /**
   * Release (end drag, start momentum)
   */
  const release = useCallback(() => {
    stateRef.current.isActive = false;
  }, []);

  /**
   * Stop immediately
   */
  const stop = useCallback(() => {
    stateRef.current.velocity = 0;
    stateRef.current.isActive = false;
  }, []);

  /**
   * Set value directly (no momentum)
   */
  const setValue = useCallback((value: number) => {
    stateRef.current.value = value;
  }, []);

  return {
    state: stateRef,
    startMomentum,
    applyInput,
    release,
    stop,
    setValue,
    getValue: () => stateRef.current.value,
    getVelocity: () => stateRef.current.velocity,
  };
}

/**
 * Hook for network-throttled value sending
 */
export function useThrottledSend<T>(
  sendFn: (value: T) => void,
  throttleMs: number = NETWORK_THROTTLE.NORMAL
): (value: T) => void {
  const lastSendRef = useRef(0);
  const pendingRef = useRef<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const throttledSend = useCallback((value: T) => {
    const now = performance.now();
    const elapsed = now - lastSendRef.current;

    if (elapsed >= throttleMs) {
      // Send immediately
      lastSendRef.current = now;
      sendFn(value);
    } else {
      // Schedule send
      pendingRef.current = value;

      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => {
          if (pendingRef.current !== null) {
            lastSendRef.current = performance.now();
            sendFn(pendingRef.current);
            pendingRef.current = null;
          }
          timeoutRef.current = null;
        }, throttleMs - elapsed);
      }
    }
  }, [sendFn, throttleMs]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledSend;
}

// ============================================================================
// CSS HELPERS FOR GPU ACCELERATION
// ============================================================================

/**
 * CSS properties for GPU-accelerated transforms
 */
export const gpuAcceleratedStyles = {
  /** Force GPU layer creation */
  willChange: 'transform' as const,
  /** Enable 3D acceleration */
  transform: 'translateZ(0)',
  /** Backface visibility for optimization */
  backfaceVisibility: 'hidden' as const,
  /** Perspective for 3D */
  perspective: 1000,
} as const;

/**
 * Generate transform3d string for position
 */
export function transform3d(
  x: number | string = 0,
  y: number | string = 0,
  z: number | string = 0
): string {
  const xVal = typeof x === 'number' ? `${x}px` : x;
  const yVal = typeof y === 'number' ? `${y}px` : y;
  const zVal = typeof z === 'number' ? `${z}px` : z;
  return `translate3d(${xVal}, ${yVal}, ${zVal})`;
}

/**
 * Generate rotate3d string
 */
export function rotate3d(
  degrees: number,
  axis: 'x' | 'y' | 'z' = 'z'
): string {
  switch (axis) {
    case 'x': return `rotateX(${degrees}deg)`;
    case 'y': return `rotateY(${degrees}deg)`;
    case 'z': return `rotateZ(${degrees}deg)`;
  }
}

/**
 * Combine multiple transforms
 */
export function combineTransforms(...transforms: string[]): string {
  return transforms.filter(Boolean).join(' ');
}

// ============================================================================
// MICRO-ANIMATION HELPERS
// ============================================================================

/**
 * Generate spring animation keyframes
 */
export function springKeyframes(
  property: string,
  from: number,
  to: number,
  options: {
    stiffness?: number;
    damping?: number;
    mass?: number;
  } = {}
): Keyframe[] {
  const {
    stiffness = 170,
    damping = 26,
    mass = 1,
  } = options;

  const frames: Keyframe[] = [];
  const steps = 60;

  let velocity = 0;
  let position = from;
  const target = to;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;

    // Spring physics
    const spring = -stiffness * (position - target);
    const damper = -damping * velocity;
    const acceleration = (spring + damper) / mass;

    velocity += acceleration * (1 / 60);
    position += velocity * (1 / 60);

    frames.push({
      offset: progress,
      [property]: position,
    });
  }

  return frames;
}

/**
 * Tactile feedback pulse animation
 */
export const tactilePulse = {
  keyframes: [
    { transform: 'scale(1)', offset: 0 },
    { transform: 'scale(0.97)', offset: 0.1 },
    { transform: 'scale(1.02)', offset: 0.3 },
    { transform: 'scale(1)', offset: 1 },
  ],
  options: {
    duration: 150,
    easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  },
} as const;

/**
 * Glow pulse animation for active state
 */
export const glowPulse = {
  keyframes: [
    { opacity: 1, offset: 0 },
    { opacity: 0.6, offset: 0.5 },
    { opacity: 1, offset: 1 },
  ],
  options: {
    duration: 1000,
    iterations: Infinity,
    easing: 'ease-in-out',
  },
} as const;

// ============================================================================
// MEMOIZATION HELPERS
// ============================================================================

/**
 * Shallow compare objects for memo
 */
export function shallowEqual<T extends Record<string, unknown>>(
  objA: T,
  objB: T
): boolean {
  if (objA === objB) return true;

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (objA[key] !== objB[key]) return false;
  }

  return true;
}

/**
 * Create stable style object to prevent re-renders
 */
export function useStableStyle<T extends React.CSSProperties>(
  styleFactory: () => T,
  deps: React.DependencyList
): T {
  return useMemo(styleFactory, deps);
}
