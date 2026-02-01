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

import { useRef, useCallback, useEffect } from "react";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/** Target frame rate for RAF loop */
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;

/** Network throttle rate (20-30hz for controls) */
const NETWORK_THROTTLE_MS = 33; // ~30hz

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

/** Physics constants for momentum-based controls (jog wheel) */
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
// CORE MATH UTILITIES (LINEAR - NO EASING)
// ============================================================================

/**
 * Exponential interpolation - for REMOTE user smoothing only
 * Local controls should use raw values directly
 */
export function expLerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Check if two values are approximately equal
 */
export function approxEqual(a: number, b: number, epsilon: number = 0.0001): boolean {
  return Math.abs(a - b) < epsilon;
}

// ============================================================================
// GPU ACCELERATION HELPERS
// ============================================================================

/**
 * Generate rotate3d string (GPU accelerated)
 * Uses rotateZ with translate3d(0,0,0) to force GPU layer
 */
export function rotate3d(degrees: number): string {
  return `translate3d(0, 0, 0) rotateZ(${degrees}deg)`;
}

/**
 * Combine multiple transforms into one string
 */
export function combineTransforms(...transforms: string[]): string {
  return transforms.filter(Boolean).join(' ');
}

/**
 * Generate translate3d string for position (GPU accelerated)
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

// ============================================================================
// POINTER EVENT COALESCING
// ============================================================================

export interface CoalescedPointerData {
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Movement delta X (from all coalesced points) */
  deltaX: number;
  /** Movement delta Y (from all coalesced points) */
  deltaY: number;
  /** Pressure (0-1) */
  pressure: number;
  /** Tilt X angle */
  tiltX: number;
  /** Tilt Y angle */
  tiltY: number;
  /** All coalesced points for high-precision tracking */
  points: Array<{ x: number; y: number; pressure: number }>;
  /** High-res timestamp */
  timestamp: number;
}

/**
 * Extract coalesced pointer events for high-precision tracking
 * Uses getCoalescedEvents() for sub-frame precision on supported browsers
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
      for (const e of coalescedEvents) {
        points.push({
          x: e.clientX,
          y: e.clientY,
          pressure: e.pressure,
        });
      }
    } catch {
      // Fallback if getCoalescedEvents fails
    }
  }

  // Always include main event if we got nothing
  if (points.length === 0) {
    points.push({
      x: event.clientX,
      y: event.clientY,
      pressure: event.pressure,
    });
  }

  // Safe access with fallbacks
  const last = points[points.length - 1] ?? { x: event.clientX, y: event.clientY, pressure: event.pressure };
  const first = lastPosition || points[0] || last;

  // Calculate total delta from all coalesced points
  let totalDeltaX = 0;
  let totalDeltaY = 0;

  if (points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const curr = points[i];
      const prev = points[i - 1];
      if (curr && prev) {
        totalDeltaX += curr.x - prev.x;
        totalDeltaY += curr.y - prev.y;
      }
    }
    const firstPoint = points[0];
    if (lastPosition && firstPoint) {
      totalDeltaX += firstPoint.x - lastPosition.x;
      totalDeltaY += firstPoint.y - lastPosition.y;
    }
  } else {
    totalDeltaX = last.x - first.x;
    totalDeltaY = last.y - first.y;
  }

  return {
    x: last.x,
    y: last.y,
    deltaX: totalDeltaX,
    deltaY: totalDeltaY,
    pressure: last.pressure,
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    points,
    timestamp: performance.now(),
  };
}

// ============================================================================
// VELOCITY PREDICTION
// ============================================================================

export interface VelocityPredictor {
  samples: Array<{ value: number; time: number }>;
  maxSamples: number;
}

/**
 * Create a velocity predictor for reduced latency feel
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
  lookaheadMs: number = 8
): number {
  const now = performance.now();

  predictor.samples.push({ value, time: now });

  while (predictor.samples.length > predictor.maxSamples) {
    predictor.samples.shift();
  }

  if (predictor.samples.length < 2) {
    return value;
  }

  let totalVelocity = 0;
  let totalWeight = 0;

  for (let i = 1; i < predictor.samples.length; i++) {
    const prev = predictor.samples[i - 1];
    const curr = predictor.samples[i];
    if (!prev || !curr) continue;

    const dt = curr.time - prev.time;

    if (dt > 0 && dt < 100) {
      const velocity = (curr.value - prev.value) / dt;
      const weight = i / predictor.samples.length;
      totalVelocity += velocity * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return value;

  const avgVelocity = totalVelocity / totalWeight;
  return value + avgVelocity * lookaheadMs * 0.5;
}

/**
 * Reset predictor state
 */
export function resetPredictor(predictor: VelocityPredictor): void {
  predictor.samples = [];
}

// ============================================================================
// SINGLE RAF LOOP MANAGER (SHARED BY ALL CONTROLS)
// ============================================================================

type AnimationCallback = (deltaTime: number, timestamp: number) => boolean | void;

/**
 * Singleton RAF manager - ONE shared requestAnimationFrame for ALL controls
 * This is critical for performance - avoids multiple RAF loops competing
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
   * Unregister a callback by ID
   */
  unregister(id: string): void {
    this.callbacks.delete(id);
    if (this.callbacks.size === 0) {
      this.stop();
    }
  }

  private start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRunning = false;
  }

  private tick = (timestamp: number): void => {
    if (!this.isRunning) return;

    // Cap delta to avoid physics explosions on tab switch
    const deltaTime = Math.min(timestamp - this.lastTime, FRAME_TIME * 3);
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
        console.error(`[RAF] Callback error for ${id}:`, e);
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

/** Singleton instance - shared by ALL controls */
export const rafManager = new RAFManager();

// ============================================================================
// REACT HOOKS
// ============================================================================

/**
 * Hook for shared RAF loop subscription
 * Multiple components can share the same RAF loop for efficiency
 */
export function useSharedRAF(
  id: string,
  callback: (deltaTime: number, timestamp: number) => boolean | void,
  enabled: boolean = true
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const wrappedCallback = (deltaTime: number, timestamp: number) => {
      return callbackRef.current(deltaTime, timestamp);
    };

    const cleanup = rafManager.register(id, wrappedCallback);
    return cleanup;
  }, [id, enabled]);
}

/**
 * Hook for network-throttled value sending
 * Sends at ~30hz for optimal network/responsiveness balance
 */
export function useThrottledSend<T>(
  sendFn: (value: T) => void,
  throttleMs: number = NETWORK_THROTTLE_MS
): (value: T) => void {
  const lastSendRef = useRef(0);
  const pendingRef = useRef<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const throttledSend = useCallback((value: T) => {
    const now = performance.now();
    const elapsed = now - lastSendRef.current;

    if (elapsed >= throttleMs) {
      lastSendRef.current = now;
      sendFn(value);
      pendingRef.current = null;
    } else {
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
// TRIPLE BUFFER STATE
// ============================================================================

export interface TripleBufferState {
  /** Raw local input value - NEVER interpolated for local user */
  local: number;
  /** Smoothed visual value - only for remote user rendering */
  visual: number;
  /** Throttled network-synced value */
  network: number;
  /** Target value for remote interpolation */
  target: number;
  /** Current velocity (for momentum physics) */
  velocity: number;
  /** Last update timestamp */
  lastUpdate: number;
  /** Is being actively manipulated */
  isActive: boolean;
  /** Is this a local user's control */
  isLocalUser: boolean;
}

export function createTripleBuffer(initialValue: number = 0): TripleBufferState {
  return {
    local: initialValue,
    visual: initialValue,
    network: initialValue,
    target: initialValue,
    velocity: 0,
    lastUpdate: performance.now(),
    isActive: false,
    isLocalUser: true,
  };
}
