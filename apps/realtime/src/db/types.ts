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
