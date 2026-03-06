/**
 * Tests for the rate limiting system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rateLimiter,
  RATE_LIMITS,
  isRateLimitedEventType,
  getRateLimitConfig,
} from "./limits.js";

describe("Rate Limiter", () => {
  const testClientId = "test-client-123";

  beforeEach(() => {
    // Clear any existing rate limit entries for the test client
    rateLimiter.clearClient(testClientId);
  });

  afterEach(() => {
    rateLimiter.clearClient(testClientId);
  });

  describe("check", () => {
    it("should allow events under the rate limit", () => {
      const result = rateLimiter.check(testClientId, "QUEUE_ADD");
      expect(result.allowed).toBe(true);
    });

    it("should allow events with no rate limit config", () => {
      const result = rateLimiter.check(testClientId, "UNKNOWN_EVENT");
      expect(result.allowed).toBe(true);
    });
  });

  describe("checkAndRecord", () => {
    it("should allow and record events under the limit", () => {
      const result = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      expect(result.allowed).toBe(true);
    });

    it("should block events over the rate limit", () => {
      vi.useFakeTimers();

      // Add max events, spreading across seconds to avoid burst limit
      const maxEvents = RATE_LIMITS.QUEUE_ADD!.maxEvents;
      const burstPerSecond = RATE_LIMITS.QUEUE_ADD!.burstPerSecond!;
      for (let i = 0; i < maxEvents; i++) {
        if (i > 0 && i % burstPerSecond === 0) {
          vi.advanceTimersByTime(1100); // Move past burst window
        }
        const result = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
        expect(result.allowed).toBe(true);
      }

      // Advance past burst window so we hit the per-minute limit, not burst
      vi.advanceTimersByTime(1100);

      // Next event should be blocked by per-minute limit
      const blockedResult = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      expect(blockedResult.allowed).toBe(false);
      if (!blockedResult.allowed) {
        expect(blockedResult.error).toContain("Rate limit exceeded");
        expect(blockedResult.retryAfterMs).toBeGreaterThan(0);
      }

      vi.useRealTimers();
    });

    it("should block burst of events exceeding per-second limit", () => {
      const burstPerSecond = RATE_LIMITS.QUEUE_ADD!.burstPerSecond!;

      // Send up to burst limit
      for (let i = 0; i < burstPerSecond; i++) {
        const result = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
        expect(result.allowed).toBe(true);
      }

      // Next event should be blocked by burst limit
      const blockedResult = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      expect(blockedResult.allowed).toBe(false);
      if (!blockedResult.allowed) {
        expect(blockedResult.error).toContain("Burst rate limit exceeded");
      }
    });
  });

  describe("deck actions shared limit", () => {
    it("should share rate limit between all deck actions", () => {
      vi.useFakeTimers();

      const maxEvents = RATE_LIMITS.DECK_ACTIONS!.maxEvents;
      const burstPerSecond = RATE_LIMITS.DECK_ACTIONS!.burstPerSecond!;

      // Use up half the limit with DECK_PLAY, spreading across seconds
      for (let i = 0; i < maxEvents / 2; i++) {
        if (i > 0 && i % burstPerSecond === 0) {
          vi.advanceTimersByTime(1100);
        }
        const result = rateLimiter.checkAndRecord(testClientId, "DECK_PLAY");
        expect(result.allowed).toBe(true);
      }

      // Advance past burst window before switching event types
      vi.advanceTimersByTime(1100);

      // Use up the other half with DECK_LOAD
      for (let i = 0; i < maxEvents / 2; i++) {
        if (i > 0 && i % burstPerSecond === 0) {
          vi.advanceTimersByTime(1100);
        }
        const result = rateLimiter.checkAndRecord(testClientId, "DECK_LOAD");
        expect(result.allowed).toBe(true);
      }

      // Advance past burst window
      vi.advanceTimersByTime(1100);

      // Now any deck action in the shared pool should be blocked
      const blockedPlay = rateLimiter.checkAndRecord(testClientId, "DECK_PLAY");
      expect(blockedPlay.allowed).toBe(false);

      const blockedPause = rateLimiter.checkAndRecord(testClientId, "DECK_PAUSE");
      expect(blockedPause.allowed).toBe(false);

      const blockedCue = rateLimiter.checkAndRecord(testClientId, "DECK_CUE");
      expect(blockedCue.allowed).toBe(false);

      // DECK_TEMPO_SET is NOT rate limited (it's a continuous control like MIXER_SET)
      // so it should still be allowed when DECK_ACTIONS limit is hit
      const allowedTempo = rateLimiter.checkAndRecord(testClientId, "DECK_TEMPO_SET");
      expect(allowedTempo.allowed).toBe(true);

      // DECK_SEEK has its own separate limit (600/min for scratching), so it should still be allowed
      const allowedSeek = rateLimiter.checkAndRecord(testClientId, "DECK_SEEK");
      expect(allowedSeek.allowed).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("clearClient", () => {
    it("should clear all rate limit entries for a client", () => {
      vi.useFakeTimers();

      // Record some events
      rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      rateLimiter.checkAndRecord(testClientId, "DECK_PLAY");

      // Clear the client
      rateLimiter.clearClient(testClientId);

      // Should be able to record max events again, spreading across seconds
      const maxEvents = RATE_LIMITS.QUEUE_ADD!.maxEvents;
      const burstPerSecond = RATE_LIMITS.QUEUE_ADD!.burstPerSecond!;
      for (let i = 0; i < maxEvents; i++) {
        if (i > 0 && i % burstPerSecond === 0) {
          vi.advanceTimersByTime(1100);
        }
        const result = rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
        expect(result.allowed).toBe(true);
      }

      vi.useRealTimers();
    });
  });

  describe("sliding window", () => {
    it("should allow events after window expires", async () => {
      // Use a shorter time for testing
      vi.useFakeTimers();

      const maxEvents = RATE_LIMITS.QUEUE_ADD!.maxEvents;
      const windowMs = RATE_LIMITS.QUEUE_ADD!.windowMs;

      // Fill up the limit
      for (let i = 0; i < maxEvents; i++) {
        rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      }

      // Should be blocked
      expect(rateLimiter.check(testClientId, "QUEUE_ADD").allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(windowMs + 100);

      // Should now be allowed
      expect(rateLimiter.check(testClientId, "QUEUE_ADD").allowed).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("getStats", () => {
    it("should return entry counts", () => {
      rateLimiter.checkAndRecord(testClientId, "QUEUE_ADD");
      rateLimiter.checkAndRecord(testClientId, "QUEUE_REMOVE");

      const stats = rateLimiter.getStats();
      expect(stats.entryCount).toBeGreaterThanOrEqual(2);
      expect(stats.totalTimestamps).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("isRateLimitedEventType", () => {
  it("should return true for queue events", () => {
    expect(isRateLimitedEventType("QUEUE_ADD")).toBe(true);
    expect(isRateLimitedEventType("QUEUE_REMOVE")).toBe(true);
    expect(isRateLimitedEventType("QUEUE_REORDER")).toBe(true);
    expect(isRateLimitedEventType("QUEUE_EDIT")).toBe(true);
  });

  it("should return true for deck events", () => {
    expect(isRateLimitedEventType("DECK_LOAD")).toBe(true);
    expect(isRateLimitedEventType("DECK_PLAY")).toBe(true);
    expect(isRateLimitedEventType("DECK_PAUSE")).toBe(true);
    expect(isRateLimitedEventType("DECK_SEEK")).toBe(true);
    expect(isRateLimitedEventType("DECK_CUE")).toBe(true);
  });

  it("should return false for non-rate-limited events", () => {
    expect(isRateLimitedEventType("CURSOR_MOVE")).toBe(false);
    expect(isRateLimitedEventType("MIXER_SET")).toBe(false);
    expect(isRateLimitedEventType("DECK_TEMPO_SET")).toBe(false); // Continuous control
    expect(isRateLimitedEventType("UNKNOWN")).toBe(false);
  });
});

describe("getRateLimitConfig", () => {
  it("should return config for rate-limited events", () => {
    const queueAddConfig = getRateLimitConfig("QUEUE_ADD");
    expect(queueAddConfig).not.toBeNull();
    expect(queueAddConfig?.maxEvents).toBe(20);
    expect(queueAddConfig?.windowMs).toBe(60_000);
  });

  it("should return deck actions config for all deck events", () => {
    const deckPlayConfig = getRateLimitConfig("DECK_PLAY");
    const deckLoadConfig = getRateLimitConfig("DECK_LOAD");

    expect(deckPlayConfig).toEqual(deckLoadConfig);
    expect(deckPlayConfig?.maxEvents).toBe(100);
  });

  it("should return null for non-rate-limited events", () => {
    expect(getRateLimitConfig("CURSOR_MOVE")).toBeNull();
    expect(getRateLimitConfig("UNKNOWN")).toBeNull();
  });
});
