/**
 * Track database store.
 *
 * MVP implementation uses in-memory storage.
 * Production implementation will use Postgres.
 */

import { randomUUID } from "crypto";
import type { Track, CreateTrackInput, TrackQuery } from "./types.js";

class TrackStore {
  private tracks: Map<string, Track> = new Map();

  /**
   * Create a new track record.
   */
  async create(input: CreateTrackInput): Promise<Track> {
    const track: Track = {
      id: randomUUID(),
      title: input.title,
      durationSec: input.durationSec,
      ownerId: input.ownerId ?? null,
      source: input.source,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      fileHash: input.fileHash,
      storageKey: input.storageKey,
      createdAt: new Date(),
    };

    this.tracks.set(track.id, track);
    return track;
  }

  /**
   * Find a track by ID.
   */
  async findById(id: string): Promise<Track | null> {
    return this.tracks.get(id) ?? null;
  }

  /**
   * Find tracks matching query criteria.
   */
  async find(query: TrackQuery): Promise<Track[]> {
    let results = Array.from(this.tracks.values());

    if (query.id) {
      results = results.filter((t) => t.id === query.id);
    }

    if (query.ownerId) {
      results = results.filter((t) => t.ownerId === query.ownerId);
    }

    if (query.fileHash) {
      results = results.filter((t) => t.fileHash === query.fileHash);
    }

    // Sort by created date descending
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Find a track by file hash (for deduplication).
   */
  async findByHash(fileHash: string): Promise<Track | null> {
    const results = await this.find({ fileHash, limit: 1 });
    return results[0] ?? null;
  }

  /**
   * Delete a track by ID.
   */
  async delete(id: string): Promise<boolean> {
    return this.tracks.delete(id);
  }

  /**
   * Get total track count.
   */
  async count(): Promise<number> {
    return this.tracks.size;
  }

  /**
   * Clear all tracks (for testing).
   */
  clear(): void {
    this.tracks.clear();
  }
}

export const trackStore = new TrackStore();
