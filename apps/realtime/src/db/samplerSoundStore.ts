/**
 * Sampler sound database store.
 *
 * MVP implementation uses in-memory storage.
 * Sounds are scoped per-room (not per-client).
 */

import { randomUUID } from "crypto";
import type { SamplerSound, CreateSamplerSoundInput, SamplerSoundQuery } from "./types.js";

class SamplerSoundStore {
  private sounds: Map<string, SamplerSound> = new Map();

  /**
   * Create a new sampler sound record.
   */
  async create(input: CreateSamplerSoundInput): Promise<SamplerSound> {
    const sound: SamplerSound = {
      id: randomUUID(),
      roomId: input.roomId,
      slot: input.slot,
      fileName: input.fileName,
      storageKey: input.storageKey,
      fileUrl: input.fileUrl,
      createdAt: new Date(),
      isDefault: input.isDefault ?? false,
    };

    // Remove any existing sound for this room+slot combination
    const existing = await this.findByRoomSlot(input.roomId, input.slot);
    if (existing) {
      this.sounds.delete(existing.id);
      console.log(`[samplerSoundStore] Replaced existing sound: ${existing.id}`);
    }

    this.sounds.set(sound.id, sound);
    console.log(`[samplerSoundStore] Created sound: ${sound.id} for room=${input.roomId}, slot=${input.slot}`);
    return sound;
  }

  /**
   * Find a sampler sound by ID.
   */
  async findById(id: string): Promise<SamplerSound | null> {
    return this.sounds.get(id) ?? null;
  }

  /**
   * Find sampler sounds matching query criteria.
   */
  async find(query: SamplerSoundQuery): Promise<SamplerSound[]> {
    let results = Array.from(this.sounds.values());

    if (query.id) {
      results = results.filter((s) => s.id === query.id);
    }

    if (query.roomId) {
      results = results.filter((s) => s.roomId === query.roomId);
    }

    if (query.slot !== undefined) {
      results = results.filter((s) => s.slot === query.slot);
    }

    // Sort by created date descending
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return results;
  }

  /**
   * Find sampler sound by room and slot.
   */
  async findByRoomSlot(
    roomId: string,
    slot: 0 | 1 | 2 | 3
  ): Promise<SamplerSound | null> {
    const results = await this.find({ roomId, slot });
    return results[0] ?? null;
  }

  /**
   * Get all custom sounds for a room.
   */
  async getRoomSounds(roomId: string): Promise<SamplerSound[]> {
    return await this.find({ roomId });
  }

  /**
   * Delete a sampler sound by ID.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.sounds.delete(id);
    if (deleted) {
      console.log(`[samplerSoundStore] Deleted sound: ${id}`);
    }
    return deleted;
  }

  /**
   * Delete sampler sound by room and slot.
   */
  async deleteByRoomSlot(
    roomId: string,
    slot: 0 | 1 | 2 | 3
  ): Promise<boolean> {
    const sound = await this.findByRoomSlot(roomId, slot);
    if (sound) {
      return this.sounds.delete(sound.id);
    }
    return false;
  }

  /**
   * Get total count.
   */
  async count(): Promise<number> {
    return this.sounds.size;
  }

  /**
   * Clear all sounds (for testing).
   */
  clear(): void {
    this.sounds.clear();
  }
}

export const samplerSoundStore = new SamplerSoundStore();
