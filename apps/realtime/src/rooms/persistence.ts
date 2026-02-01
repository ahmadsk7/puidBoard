/**
 * Room state persistence for reconnect resilience.
 *
 * MVP: In-memory fallback with optional Redis persistence.
 * Periodically saves snapshots + idempotency state to survive reconnects.
 */

import type { RoomId, RoomState, ClientId } from "@puid-board/shared";
import { roomStore } from "./store.js";
import { idempotencyStore } from "../protocol/idempotency.js";

/** Persistence configuration */
interface PersistenceConfig {
  /** Redis client (optional, falls back to in-memory) */
  redisClient?: RedisClient | null;
  /** How often to save snapshots (ms) */
  snapshotIntervalMs: number;
  /** How long to keep snapshots (ms) */
  snapshotTtlMs: number;
}

/** Minimal Redis client interface */
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  del(key: string): Promise<void>;
  ping(): Promise<string>;
}

/** Persisted room data */
interface PersistedRoom {
  roomState: RoomState;
  idempotency: {
    clientSeqs: Array<[ClientId, number]>;
    recentEventIds: string[];
  };
  savedAt: number;
}

class PersistenceManager {
  private config: PersistenceConfig;
  private snapshotTimers: Map<RoomId, NodeJS.Timeout> = new Map();
  private inMemoryBackup: Map<RoomId, PersistedRoom> = new Map();

  constructor(config: Partial<PersistenceConfig> = {}) {
    this.config = {
      redisClient: config.redisClient ?? null,
      snapshotIntervalMs: config.snapshotIntervalMs ?? 10000, // 10s default
      snapshotTtlMs: config.snapshotTtlMs ?? 3600000, // 1 hour default
    };
  }

  /**
   * Start periodic snapshots for a room.
   */
  startSnapshotting(roomId: RoomId): void {
    // Clear existing timer if any
    this.stopSnapshotting(roomId);

    const timer = setInterval(async () => {
      await this.saveSnapshot(roomId);
    }, this.config.snapshotIntervalMs);

    this.snapshotTimers.set(roomId, timer);

    // Save immediately on start
    void this.saveSnapshot(roomId);

    console.log(
      `[persistence] started snapshots roomId=${roomId} interval=${this.config.snapshotIntervalMs}ms`
    );
  }

  /**
   * Stop snapshots for a room.
   */
  stopSnapshotting(roomId: RoomId): void {
    const timer = this.snapshotTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.snapshotTimers.delete(roomId);
    }
  }

  /**
   * Save a snapshot of room state.
   */
  async saveSnapshot(roomId: RoomId): Promise<boolean> {
    const room = roomStore.getRoom(roomId);
    if (!room) {
      console.log(`[persistence] room not found for snapshot roomId=${roomId}`);
      return false;
    }

    const idempotencyState = idempotencyStore.getPersistedState(roomId);
    if (!idempotencyState) {
      console.log(
        `[persistence] no idempotency state for roomId=${roomId}, using empty`
      );
    }

    const persisted: PersistedRoom = {
      roomState: room,
      idempotency: idempotencyState ?? {
        clientSeqs: [],
        recentEventIds: [],
      },
      savedAt: Date.now(),
    };

    const key = this.getRedisKey(roomId);
    const ttlSec = Math.floor(this.config.snapshotTtlMs / 1000);

    try {
      if (this.config.redisClient) {
        // Save to Redis
        await this.config.redisClient.set(key, JSON.stringify(persisted), {
          EX: ttlSec,
        });
        console.log(
          `[persistence] saved to Redis roomId=${roomId} version=${room.version} members=${room.members.length}`
        );
      } else {
        // Fallback to in-memory
        this.inMemoryBackup.set(roomId, persisted);
        console.log(
          `[persistence] saved in-memory roomId=${roomId} version=${room.version} (Redis not configured)`
        );
      }

      return true;
    } catch (error) {
      console.error(
        `[persistence] failed to save roomId=${roomId}`,
        error
      );
      // Fallback to in-memory on Redis error
      this.inMemoryBackup.set(roomId, persisted);
      return false;
    }
  }

  /**
   * Load a room snapshot (for reconnect).
   * @returns RoomState if found, null otherwise
   */
  async loadSnapshot(roomId: RoomId): Promise<PersistedRoom | null> {
    const key = this.getRedisKey(roomId);

    try {
      if (this.config.redisClient) {
        // Try Redis first
        const data = await this.config.redisClient.get(key);
        if (data) {
          const persisted = JSON.parse(data) as PersistedRoom;
          console.log(
            `[persistence] loaded from Redis roomId=${roomId} version=${persisted.roomState.version}`
          );
          return persisted;
        }
      }

      // Fallback to in-memory
      const persisted = this.inMemoryBackup.get(roomId);
      if (persisted) {
        console.log(
          `[persistence] loaded from in-memory roomId=${roomId} version=${persisted.roomState.version}`
        );
        return persisted;
      }

      console.log(`[persistence] no snapshot found roomId=${roomId}`);
      return null;
    } catch (error) {
      console.error(`[persistence] failed to load roomId=${roomId}`, error);
      // Try in-memory fallback
      return this.inMemoryBackup.get(roomId) ?? null;
    }
  }

  /**
   * Delete persisted state for a room (cleanup).
   */
  async deleteSnapshot(roomId: RoomId): Promise<void> {
    this.stopSnapshotting(roomId);

    const key = this.getRedisKey(roomId);

    try {
      if (this.config.redisClient) {
        await this.config.redisClient.del(key);
        console.log(`[persistence] deleted Redis key roomId=${roomId}`);
      }

      this.inMemoryBackup.delete(roomId);
    } catch (error) {
      console.error(
        `[persistence] failed to delete roomId=${roomId}`,
        error
      );
    }
  }

  /**
   * Check if Redis is available.
   */
  async isRedisAvailable(): Promise<boolean> {
    if (!this.config.redisClient) {
      return false;
    }

    try {
      await this.config.redisClient.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Redis key for a room.
   */
  private getRedisKey(roomId: RoomId): string {
    return `room:${roomId}:snapshot`;
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): {
    activeSnapshots: number;
    inMemoryBackups: number;
    redisConfigured: boolean;
  } {
    return {
      activeSnapshots: this.snapshotTimers.size,
      inMemoryBackups: this.inMemoryBackup.size,
      redisConfigured: this.config.redisClient !== null,
    };
  }
}

/**
 * Initialize Redis client from environment.
 * Returns null if Redis is not configured.
 *
 * Supports both traditional Redis and Upstash REST API:
 * - REDIS_URL=redis://... (traditional)
 * - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (REST API)
 */
export async function createRedisClient(): Promise<RedisClient | null> {
  const redisUrl = process.env.REDIS_URL;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Try Upstash REST API first (preferred for serverless)
  if (upstashUrl && upstashToken) {
    try {
      const { Redis } = await import("@upstash/redis");

      const client = new Redis({
        url: upstashUrl,
        token: upstashToken,
      });

      // Test connection
      await client.ping();

      console.log("[persistence] Upstash Redis (REST) connected successfully");

      // Wrap Upstash client to match our RedisClient interface
      return {
        async get(key: string) {
          return await client.get(key);
        },
        async set(key: string, value: string, options?: { EX?: number }) {
          if (options?.EX) {
            await client.set(key, value, { ex: options.EX });
          } else {
            await client.set(key, value);
          }
        },
        async del(key: string) {
          await client.del(key);
        },
        async ping() {
          await client.ping();
          return "PONG";
        },
      } as RedisClient;
    } catch (error) {
      console.error(
        "[persistence] Failed to initialize Upstash Redis, falling back to in-memory:",
        error
      );
      return null;
    }
  }

  // Fall back to traditional Redis if REDIS_URL is set
  if (!redisUrl) {
    console.log(
      "[persistence] No Redis configuration found, using in-memory persistence only"
    );
    return null;
  }

  try {
    // Dynamically import redis (optional dependency)
    const { createClient } = await import("redis");

    const client = createClient({ url: redisUrl });

    client.on("error", (err) => {
      console.error("[persistence] Redis client error:", err);
    });

    await client.connect();
    await client.ping();

    console.log("[persistence] Redis client connected successfully");
    return client as unknown as RedisClient;
  } catch (error) {
    console.error(
      "[persistence] Failed to initialize Redis, falling back to in-memory:",
      error
    );
    return null;
  }
}

// Export singleton instance (to be initialized in server.ts)
let persistenceManager: PersistenceManager | null = null;

/**
 * Initialize persistence manager (call once on server startup).
 */
export async function initPersistence(): Promise<PersistenceManager> {
  const redisClient = await createRedisClient();

  persistenceManager = new PersistenceManager({
    redisClient,
    snapshotIntervalMs: parseInt(process.env.SNAPSHOT_INTERVAL_MS ?? "10000"),
    snapshotTtlMs: parseInt(process.env.SNAPSHOT_TTL_MS ?? "3600000"),
  });

  const redisAvailable = await persistenceManager.isRedisAvailable();
  console.log(
    `[persistence] initialized (Redis: ${redisAvailable ? "enabled" : "disabled"})`
  );

  return persistenceManager;
}

/**
 * Get the persistence manager instance.
 * Throws if not initialized.
 */
export function getPersistence(): PersistenceManager {
  if (!persistenceManager) {
    throw new Error(
      "Persistence manager not initialized. Call initPersistence() first."
    );
  }
  return persistenceManager;
}
