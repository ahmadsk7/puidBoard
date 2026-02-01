/**
 * Professional control optimizer for DJ hardware emulation.
 *
 * Architecture principles:
 * - Single RAF loop for all controls (no jank)
 * - Linear 1:1 mapping (no easing - feels fake on instruments)
 * - Local = immediate (zero interpolation)
 * - Remote = interpolate (smooth other users)
 * - Event-based with timestamps (deterministic replay)
 */

import { useEffect, useRef, useCallback, useState } from "react";

/** High-precision timestamp for event ordering */
export function getTimestamp(): number {
  return performance.now();
}

/** Linear interpolation - ONLY for remote users */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/** Shared RAF loop manager - all controls use one requestAnimationFrame */
class RAFManager {
  private callbacks = new Set<FrameRequestCallback>();
  private rafId: number | null = null;

  subscribe(callback: FrameRequestCallback): () => void {
    this.callbacks.add(callback);
    this.ensureRunning();
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0) {
        this.stop();
      }
    };
  }

  private ensureRunning(): void {
    if (this.rafId === null) {
      this.tick(0);
    }
  }

  private tick = (time: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    // Execute all callbacks in single frame
    for (const callback of this.callbacks) {
      callback(time);
    }
  };

  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

/** Singleton RAF manager */
export const rafManager = new RAFManager();

/**
 * Hook to subscribe to shared RAF loop.
 * All controls use this to batch visual updates.
 */
export function useSharedRAF(callback: FrameRequestCallback, enabled: boolean = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const wrappedCallback: FrameRequestCallback = (time) => {
      callbackRef.current(time);
    };

    return rafManager.subscribe(wrappedCallback);
  }, [enabled]);
}

/**
 * Optimized control value manager.
 *
 * Separates:
 * - Visual state (RAF-smoothed for remote users only)
 * - Local state (immediate, no latency)
 * - Network state (throttled to 20-30hz)
 */
export function useOptimizedControl(
  value: number,
  isLocalControl: boolean,
  onChange?: (value: number, timestamp: number) => void
) {
  const [visualValue, setVisualValue] = useState(value);
  const targetValueRef = useRef(value);
  const lastNetworkSendRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Update target when prop changes (from network)
  useEffect(() => {
    targetValueRef.current = value;

    // Local controls = immediate update (no interpolation)
    if (isLocalControl || !isDraggingRef.current) {
      setVisualValue(value);
    }
  }, [value, isLocalControl]);

  // Smooth interpolation for REMOTE users only
  useSharedRAF(
    useCallback(() => {
      // Skip interpolation for local user (feels laggy)
      if (isLocalControl || isDraggingRef.current) {
        return;
      }

      // Linear interpolation for remote users
      const current = visualValue;
      const target = targetValueRef.current;
      const diff = Math.abs(target - current);

      if (diff > 0.001) {
        // Fast interpolation (not easing - linear catch up)
        const lerpFactor = 0.3; // 30% per frame = ~5 frames to settle
        const newValue = lerp(current, target, lerpFactor);
        setVisualValue(newValue);
      } else if (diff > 0) {
        setVisualValue(target);
      }
    }, [visualValue, isLocalControl])
  );

  // Send to network with throttling (20-30hz)
  const sendToNetwork = useCallback(
    (newValue: number) => {
      const now = getTimestamp();
      const timeSinceLastSend = now - lastNetworkSendRef.current;

      // Throttle to ~30hz (33ms)
      if (timeSinceLastSend < 33) {
        return;
      }

      lastNetworkSendRef.current = now;
      onChange?.(newValue, now);
    },
    [onChange]
  );

  // Update local value immediately (zero latency)
  const updateValue = useCallback(
    (newValue: number) => {
      if (!isLocalControl) return;

      // Immediate visual update
      setVisualValue(newValue);
      targetValueRef.current = newValue;

      // Throttled network update
      sendToNetwork(newValue);
    },
    [isLocalControl, sendToNetwork]
  );

  const setDragging = useCallback((dragging: boolean) => {
    isDraggingRef.current = dragging;
  }, []);

  return {
    visualValue,
    updateValue,
    setDragging,
  };
}

export interface CoalescedPointerData {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  points: Array<{ x: number; y: number; pressure: number }>;
  timestamp: number;
}

/**
 * Coalesce pointer events for high-precision input.
 * Returns array of all coalesced events for this frame.
 */
export function getCoalescedPointerEvents(e: PointerEvent): PointerEvent[] {
  if ("getCoalescedEvents" in e && typeof e.getCoalescedEvents === "function") {
    const coalesced = e.getCoalescedEvents();
    return coalesced.length > 0 ? coalesced : [e];
  }
  return [e];
}

export function getCoalescedPointerData(
  event: PointerEvent,
  _lastPosition?: { x: number; y: number } | null
): CoalescedPointerData {
  const points: Array<{ x: number; y: number; pressure: number }> = [];
  const coalesced = getCoalescedPointerEvents(event);

  for (const e of coalesced) {
    points.push({
      x: e.clientX,
      y: e.clientY,
      pressure: e.pressure,
    });
  }

  const last = points[points.length - 1] ?? { x: event.clientX, y: event.clientY, pressure: event.pressure };
  const first = points[0] ?? last;

  return {
    x: last.x,
    y: last.y,
    deltaX: last.x - first.x,
    deltaY: last.y - first.y,
    pressure: last.pressure,
    tiltX: event.tiltX ?? 0,
    tiltY: event.tiltY ?? 0,
    points,
    timestamp: performance.now(),
  };
}

/**
 * Clamp value to range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize angle difference to handle wrap-around.
 */
export function normalizeAngleDiff(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

/**
 * Apply momentum/friction physics for jog wheel.
 * Simple model, not over-engineered.
 */
export class MomentumPhysics {
  private velocity = 0;
  private friction = 0.92; // Friction coefficient

  update(): number {
    if (Math.abs(this.velocity) < 0.1) {
      this.velocity = 0;
      return 0;
    }

    const delta = this.velocity;
    this.velocity *= this.friction;
    return delta;
  }

  setVelocity(v: number): void {
    this.velocity = v;
  }

  reset(): void {
    this.velocity = 0;
  }

  isActive(): boolean {
    return Math.abs(this.velocity) > 0.1;
  }
}
