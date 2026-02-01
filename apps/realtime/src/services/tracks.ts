/**
 * Track service - business logic for track asset management.
 */

import { trackStore } from "../db/trackStore.js";
import { storageService } from "./storage.js";
import type { Track } from "../db/types.js";

// Validation constants
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DURATION = 15 * 60; // 15 minutes in seconds
const ALLOWED_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aiff",
  "audio/x-aiff",
  "audio/flac",
];

export interface UploadTrackInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  title: string;
  durationSec: number;
  ownerId?: string;
}

export interface UploadTrackResult {
  trackId: string;
  url: string;
  deduplication: boolean;
}

export class TrackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackValidationError";
  }
}

class TrackService {
  /**
   * Upload and store a track.
   */
  async upload(input: UploadTrackInput): Promise<UploadTrackResult> {
    // Validate file size
    if (input.buffer.length > MAX_FILE_SIZE) {
      throw new TrackValidationError(
        `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw new TrackValidationError(
        `Invalid file format. Accepted formats: MP3, WAV, AIFF, FLAC`
      );
    }

    // Validate duration
    if (input.durationSec > MAX_DURATION) {
      throw new TrackValidationError(
        `Duration exceeds maximum of ${MAX_DURATION / 60} minutes`
      );
    }

    if (input.durationSec <= 0) {
      throw new TrackValidationError("Duration must be greater than 0");
    }

    // Upload to storage
    const uploadResult = await storageService.upload(
      input.buffer,
      input.filename,
      input.mimeType
    );

    // Check for deduplication
    const existingTrack = await trackStore.findByHash(uploadResult.fileHash);
    if (existingTrack) {
      const url = await storageService.getUrl(existingTrack.storageKey);
      return {
        trackId: existingTrack.id,
        url,
        deduplication: true,
      };
    }

    // Create track record
    const track = await trackStore.create({
      title: input.title,
      durationSec: input.durationSec,
      ownerId: input.ownerId,
      source: "upload",
      mimeType: input.mimeType,
      fileSizeBytes: uploadResult.fileSizeBytes,
      fileHash: uploadResult.fileHash,
      storageKey: uploadResult.storageKey,
    });

    const url = await storageService.getUrl(track.storageKey);
    return {
      trackId: track.id,
      url,
      deduplication: false,
    };
  }

  /**
   * Get track by ID.
   */
  async getById(trackId: string): Promise<Track | null> {
    return await trackStore.findById(trackId);
  }

  /**
   * Get track URL by ID.
   */
  async getUrl(trackId: string): Promise<string | null> {
    const track = await trackStore.findById(trackId);
    if (!track) {
      return null;
    }
    return await storageService.getUrl(track.storageKey);
  }

  /**
   * Seed sample pack tracks (for testing).
   */
  async seedSamplePack(samples: Array<{
    title: string;
    durationSec: number;
    buffer: Buffer;
    mimeType: string;
  }>): Promise<Track[]> {
    const tracks: Track[] = [];

    for (const sample of samples) {
      const uploadResult = await storageService.upload(
        sample.buffer,
        sample.title,
        sample.mimeType
      );

      // Check if already seeded
      const existing = await trackStore.findByHash(uploadResult.fileHash);
      if (existing) {
        tracks.push(existing);
        continue;
      }

      const track = await trackStore.create({
        title: sample.title,
        durationSec: sample.durationSec,
        source: "sample_pack",
        mimeType: sample.mimeType,
        fileSizeBytes: uploadResult.fileSizeBytes,
        fileHash: uploadResult.fileHash,
        storageKey: uploadResult.storageKey,
      });

      tracks.push(track);
    }

    return tracks;
  }

  /**
   * List sample pack tracks.
   */
  async listSamplePack(): Promise<Track[]> {
    return await trackStore.find({ limit: 100 });
  }
}

export const trackService = new TrackService();
