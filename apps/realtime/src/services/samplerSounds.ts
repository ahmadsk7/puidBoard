/**
 * Sampler sounds service - business logic for sampler audio management.
 */

import { samplerSoundStore } from "../db/samplerSoundStore.js";
import { storageService } from "./storage.js";
import type { SamplerSound } from "../db/types.js";

// Validation constants
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB for sampler sounds
// Note: Duration validation happens client-side via MediaRecorder timeout
const ALLOWED_MIME_TYPE_PREFIXES = [
  "audio/mpeg",   // MP3
  "audio/wav",    // WAV
  "audio/x-wav",  // WAV (alternative)
  "audio/ogg",    // OGG
  "audio/webm",   // WebM (from recording, may include codecs like "audio/webm;codecs=opus")
  "audio/mp4",    // M4A/AAC
];

export interface UploadSamplerSoundInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  clientId: string;
  roomId: string;
  slot: 0 | 1 | 2 | 3;
}

export interface UploadSamplerSoundResult {
  soundId: string;
  url: string;
  fileName: string;
}

export class SamplerSoundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamplerSoundValidationError";
  }
}

class SamplerSoundsService {
  /**
   * Upload and store a sampler sound.
   */
  async upload(input: UploadSamplerSoundInput): Promise<UploadSamplerSoundResult> {
    // Validate file size
    if (input.buffer.length > MAX_FILE_SIZE) {
      throw new SamplerSoundValidationError(
        `File size exceeds maximum of ${MAX_FILE_SIZE / 1024}KB`
      );
    }

    // Validate mime type (use startsWith to handle codec parameters like "audio/webm;codecs=opus")
    const isValidMimeType = ALLOWED_MIME_TYPE_PREFIXES.some(prefix =>
      input.mimeType.startsWith(prefix)
    );

    if (!isValidMimeType) {
      console.error(`[samplerSounds] Invalid MIME type: ${input.mimeType}`);
      throw new SamplerSoundValidationError(
        `Invalid file format. Accepted formats: MP3, WAV, OGG, WebM, M4A. Received: ${input.mimeType}`
      );
    }

    console.log(`[samplerSounds] Valid MIME type: ${input.mimeType}`);

    // Upload to storage
    const uploadResult = await storageService.upload(
      input.buffer,
      input.filename,
      input.mimeType
    );

    // Get URL for the uploaded file
    const url = await storageService.getUrl(uploadResult.storageKey);

    // Create sampler sound record
    const sound = await samplerSoundStore.create({
      clientId: input.clientId,
      roomId: input.roomId,
      slot: input.slot,
      fileName: input.filename,
      storageKey: uploadResult.storageKey,
      fileUrl: url,
      isDefault: false,
    });

    console.log(`[samplerSounds] Uploaded sound: ${sound.id} for slot ${input.slot}`);

    return {
      soundId: sound.id,
      url,
      fileName: input.filename,
    };
  }

  /**
   * Get sampler sound by ID.
   */
  async getById(soundId: string): Promise<SamplerSound | null> {
    return await samplerSoundStore.findById(soundId);
  }

  /**
   * Get all custom sounds for a client in a room.
   */
  async getClientRoomSounds(clientId: string, roomId: string): Promise<SamplerSound[]> {
    return await samplerSoundStore.getClientRoomSounds(clientId, roomId);
  }

  /**
   * Get sound for a specific slot.
   */
  async getSlotSound(
    clientId: string,
    roomId: string,
    slot: 0 | 1 | 2 | 3
  ): Promise<SamplerSound | null> {
    return await samplerSoundStore.findByClientRoomSlot(clientId, roomId, slot);
  }

  /**
   * Delete a sampler sound.
   */
  async delete(soundId: string): Promise<boolean> {
    const sound = await samplerSoundStore.findById(soundId);
    if (!sound) {
      return false;
    }

    // Delete from storage (optional - could keep for caching)
    // await storageService.delete(sound.storageKey);

    // Delete from database
    return await samplerSoundStore.delete(soundId);
  }

  /**
   * Reset a slot to default (delete custom sound).
   */
  async resetSlot(
    clientId: string,
    roomId: string,
    slot: 0 | 1 | 2 | 3
  ): Promise<boolean> {
    return await samplerSoundStore.deleteByClientRoomSlot(clientId, roomId, slot);
  }

  /**
   * Get URL for a sound (refreshes signed URL if needed).
   */
  async getUrl(soundId: string): Promise<string | null> {
    const sound = await samplerSoundStore.findById(soundId);
    if (!sound) {
      return null;
    }

    // Return fresh URL
    return await storageService.getUrl(sound.storageKey);
  }
}

export const samplerSoundsService = new SamplerSoundsService();
