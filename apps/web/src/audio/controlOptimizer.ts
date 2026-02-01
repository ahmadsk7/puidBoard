/**
 * Control optimization utilities
 */

export const SMOOTHING = {
  INSTANT: 0.85,
  FAST: 0.65,
  MEDIUM: 0.45,
  SLOW: 0.25,
  GENTLE: 0.12,
} as const;

export const PHYSICS = {
  FRICTION: 0.92,
  HIGH_FRICTION: 0.85,
  LOW_FRICTION: 0.97,
  MIN_VELOCITY: 0.001,
  MAX_VELOCITY: 50,
} as const;

export interface CoalescedPointerData {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  timestamp: number;
  events: Array<{ x: number; y: number; timestamp: number }>;
}

export function expLerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function approxEqual(a: number, b: number, epsilon: number = 0.0001): boolean {
  return Math.abs(a - b) < epsilon;
}

export function rotate3d(degrees: number): string {
  return `rotate3d(0, 0, 1, ${degrees}deg)`;
}

export function combineTransforms(...transforms: string[]): string {
  return transforms.join(' ');
}

export function getCoalescedPointerData(nativeEvent: PointerEvent): CoalescedPointerData {
  const coalesced = 'getCoalescedEvents' in nativeEvent
    ? (nativeEvent as any).getCoalescedEvents()
    : [nativeEvent];

  const events = coalesced.map((e: PointerEvent) => ({
    x: e.clientX,
    y: e.clientY,
    timestamp: e.timeStamp,
  }));

  const first = events[0] ?? { x: 0, y: 0, timestamp: 0 };
  const last = events[events.length - 1] ?? first;

  return {
    x: last.x,
    y: last.y,
    deltaX: last.x - first.x,
    deltaY: last.y - first.y,
    timestamp: last.timestamp,
    events,
  };
}

export function createVelocityPredictor() {
  const samples: Array<{ value: number; timestamp: number }> = [];
  const maxSamples = 5;

  return {
    addSample(value: number, timestamp: number) {
      samples.push({ value, timestamp });
      if (samples.length > maxSamples) {
        samples.shift();
      }
    },
    getVelocity(): number {
      if (samples.length < 2) return 0;
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      const dt = last.timestamp - first.timestamp;
      if (dt === 0) return 0;
      return (last.value - first.value) / dt;
    },
    reset() {
      samples.length = 0;
    },
  };
}

class RAFManager {
  private callbacks = new Set<() => void>();
  private rafId: number | null = null;

  private tick = () => {
    for (const callback of this.callbacks) {
      callback();
    }
    if (this.callbacks.size > 0) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = null;
    }
  };

  subscribe(callback: () => void): () => void {
    this.callbacks.add(callback);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.tick);
    }
    return () => {
      this.callbacks.delete(callback);
    };
  }

  register(id: string, callback: (deltaTime: number) => boolean | void): void {
    // Simple wrapper - ignores id and deltaTime for now
    this.subscribe(() => callback(16.67));
  }
}

export const rafManager = new RAFManager();
