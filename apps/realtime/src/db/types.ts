/**
 * Database types for track storage.
 */

export interface Track {
  id: string;
  title: string;
  durationSec: number;
  ownerId: string | null;
  source: "upload" | "sample_pack";
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  storageKey: string;
  createdAt: Date;
}

export interface CreateTrackInput {
  title: string;
  durationSec: number;
  ownerId?: string;
  source: "upload" | "sample_pack";
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  storageKey: string;
}

export interface TrackQuery {
  id?: string;
  ownerId?: string;
  fileHash?: string;
  limit?: number;
}

/**
 * Sampler sound record - stores custom sampler audio for users
 */
export interface SamplerSound {
  id: string;
  clientId: string;  // Client/user identifier
  roomId: string;    // Room identifier for scoping
  slot: 0 | 1 | 2 | 3;  // Sampler slot (0-3)
  fileName: string;  // Original filename
  storageKey: string;  // Key in storage
  fileUrl: string;   // URL to access the file
  createdAt: Date;
  isDefault: boolean;  // Whether this is a default sample
}

export interface CreateSamplerSoundInput {
  clientId: string;
  roomId: string;
  slot: 0 | 1 | 2 | 3;
  fileName: string;
  storageKey: string;
  fileUrl: string;
  isDefault?: boolean;
}

export interface SamplerSoundQuery {
  id?: string;
  clientId?: string;
  roomId?: string;
  slot?: 0 | 1 | 2 | 3;
}
