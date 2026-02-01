/**
 * Rate limiting system for Virtual DJ Rooms.
 *
 * Implements sliding window rate limiting for discrete events to prevent abuse.
 * Continuous events (CURSOR_MOVE, MIXER_SET) are handled by existing throttling.
 *
 * Rate limits per client per minute:
 * - QUEUE_ADD: 20
 * - QUEUE_REMOVE: 30
 * - QUEUE_REORDER: 60
 * - QUEUE_EDIT: 60
 * - DECK actions (LOAD, PLAY, PAUSE, SEEK, CUE): 100 combined
 *
 * Uses a sliding window algorithm for smooth rate limiting.
 */

// ============================================================================
// Rate Limit Configuration
// ============================================================================

/** Rate limit configuration for each event type */
export interface RateLimitConfig {
  /** Maximum number of events allowed in the window */
  maxEvents: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/** Rate limits for discrete events (per minute) */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Queue operations
  QUEUE_ADD: { maxEvents: 20, windowMs: 60_000 },
  QUEUE_REMOVE: { maxEvents: 30, windowMs: 60_000 },
  QUEUE_REORDER: { maxEvents: 60, windowMs: 60_000 },
  QUEUE_EDIT: { maxEvents: 60, windowMs: 60_000 },
  // Deck operations (combined limit for discrete actions)
  DECK_ACTIONS: { maxEvents: 100, windowMs: 60_000 },
  // DECK_SEEK has higher limit for jog wheel scratching (high-frequency operation)
  DECK_SEEK: { maxEvents: 600, windowMs: 60_000 }, // ~10 per second for smooth scratching
};

/** Event types that share the DECK_ACTIONS rate limit */
const DECK_EVENT_TYPES = ["DECK_LOAD", "DECK_PLAY", "DECK_PAUSE", "DECK_CUE", "DECK_TEMPO_SET"];

/** Event types with their own rate limits */
const INDIVIDUAL_RATE_LIMIT_TYPES = ["DECK_SEEK"];

// ============================================================================
// Sliding Window Implementation
// ============================================================================

/** Timestamp entry for rate limit tracking */
interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Rate limiter using sliding window algorithm.
 * Tracks per-client event counts with automatic cleanup.
 */
class RateLimiter {
  /** Map of clientId:eventType -> timestamps of recent events */
  private entries: Map<string, RateLimitEntry> = new Map();

  /** Interval handle for cleanup task */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup (every 30 seconds)
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  /**
   * Get the rate limit key for a client and event type.
   * Deck events share a combined limit, except those with individual limits.
   */
  private getKey(clientId: string, eventType: string): string {
    // Check if this event has its own rate limit
    if (INDIVIDUAL_RATE_LIMIT_TYPES.includes(eventType)) {
      return `${clientId}:${eventType}`;
    }
    // Otherwise, deck events share combined limit
    const limitType = DECK_EVENT_TYPES.includes(eventType) ? "DECK_ACTIONS" : eventType;
    return `${clientId}:${limitType}`;
  }

  /**
   * Check if an event is rate limited.
   * @param clientId The client ID making the request
   * @param eventType The type of event
   * @returns Object with allowed status and error message if rate limited
   */
  check(
    clientId: string,
    eventType: string
  ): { allowed: true } | { allowed: false; error: string; retryAfterMs: number } {
    // Check if this event has its own rate limit first
    let limitType: string;
    if (INDIVIDUAL_RATE_LIMIT_TYPES.includes(eventType)) {
      limitType = eventType;
    } else if (DECK_EVENT_TYPES.includes(eventType)) {
      limitType = "DECK_ACTIONS";
    } else {
      limitType = eventType;
    }
    const config = RATE_LIMITS[limitType];

    // If no rate limit configured for this event type, allow it
    if (!config) {
      return { allowed: true };
    }

    const key = this.getKey(clientId, eventType);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create entry
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Check if at limit
    if (entry.timestamps.length >= config.maxEvents) {
      // Find when the oldest timestamp will expire
      const oldestInWindow = entry.timestamps[0]!;
      const retryAfterMs = oldestInWindow + config.windowMs - now;

      return {
        allowed: false,
        error: `Rate limit exceeded for ${eventType}. Max ${config.maxEvents} per ${config.windowMs / 1000}s.`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return { allowed: true };
  }

  /**
   * Record an event for rate limiting.
   * Call this AFTER the event has been processed successfully.
   */
  record(clientId: string, eventType: string): void {
    const key = this.getKey(clientId, eventType);
    const now = Date.now();

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    entry.timestamps.push(now);
  }

  /**
   * Check and record in one operation.
   * Use this for most rate limiting scenarios.
   */
  checkAndRecord(
    clientId: string,
    eventType: string
  ): { allowed: true } | { allowed: false; error: string; retryAfterMs: number } {
    const result = this.check(clientId, eventType);
    if (result.allowed) {
      this.record(clientId, eventType);
    }
    return result;
  }

  /**
   * Clear all rate limit entries for a client.
   * Call this when a client disconnects.
   */
  clearClient(clientId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${clientId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.entries.delete(key);
    }
  }

  /**
   * Cleanup old entries to prevent memory leaks.
   * Removes all timestamps older than the longest window.
   */
  private cleanup(): void {
    const now = Date.now();
    const maxWindowMs = Math.max(...Object.values(RATE_LIMITS).map((c) => c.windowMs));
    const cutoff = now - maxWindowMs;

    for (const [key, entry] of this.entries) {
      // Remove old timestamps
      entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

      // Remove empty entries
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Get current stats for monitoring.
   */
  getStats(): { entryCount: number; totalTimestamps: number } {
    let totalTimestamps = 0;
    for (const entry of this.entries.values()) {
      totalTimestamps += entry.timestamps.length;
    }
    return {
      entryCount: this.entries.size,
      totalTimestamps,
    };
  }

  /**
   * Stop the cleanup interval.
   * Call this when shutting down the server.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Global rate limiter instance */
export const rateLimiter = new RateLimiter();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an event type requires rate limiting.
 */
export function isRateLimitedEventType(eventType: string): boolean {
  return (
    eventType in RATE_LIMITS ||
    DECK_EVENT_TYPES.includes(eventType) ||
    INDIVIDUAL_RATE_LIMIT_TYPES.includes(eventType)
  );
}

/**
 * Get the rate limit config for an event type.
 */
export function getRateLimitConfig(eventType: string): RateLimitConfig | null {
  // Check for individual rate limit first
  if (INDIVIDUAL_RATE_LIMIT_TYPES.includes(eventType)) {
    return RATE_LIMITS[eventType] ?? null;
  }
  // Then check for combined deck action limit
  if (DECK_EVENT_TYPES.includes(eventType)) {
    return RATE_LIMITS.DECK_ACTIONS ?? null;
  }
  return RATE_LIMITS[eventType] ?? null;
}
