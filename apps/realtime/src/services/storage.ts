/**
 * File storage service for track assets.
 *
 * MVP implementation uses local filesystem.
 * Production implementation will use S3-compatible object storage.
 */

import { createHash } from "crypto";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./.storage/tracks";
const CDN_BASE_URL = process.env.CDN_BASE_URL ?? "http://localhost:3001/files";

export interface UploadResult {
  storageKey: string;
  fileHash: string;
  fileSizeBytes: number;
}

class StorageService {
  constructor() {
    this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists.
   */
  private async ensureStorageDir(): Promise<void> {
    if (!existsSync(STORAGE_DIR)) {
      await mkdir(STORAGE_DIR, { recursive: true });
    }
  }

  /**
   * Upload a file to storage.
   */
  async upload(
    buffer: Buffer,
    _filename: string,
    mimeType: string
  ): Promise<UploadResult> {
    await this.ensureStorageDir();

    // Compute file hash for deduplication
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const fileSizeBytes = buffer.length;

    // Generate storage key (hash-based for deduplication)
    const ext = this.getExtensionFromMime(mimeType);
    const storageKey = `${fileHash}${ext}`;
    const filePath = join(STORAGE_DIR, storageKey);

    // Write file to storage (skip if already exists from deduplication)
    if (!existsSync(filePath)) {
      await writeFile(filePath, buffer);
    }

    return {
      storageKey,
      fileHash,
      fileSizeBytes,
    };
  }

  /**
   * Get CDN URL for a storage key.
   */
  getUrl(storageKey: string): string {
    return `${CDN_BASE_URL}/${storageKey}`;
  }

  /**
   * Read file from storage.
   */
  async read(storageKey: string): Promise<Buffer> {
    const filePath = join(STORAGE_DIR, storageKey);
    return await readFile(filePath);
  }

  /**
   * Delete file from storage.
   */
  async delete(storageKey: string): Promise<void> {
    const filePath = join(STORAGE_DIR, storageKey);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  /**
   * Get file extension from mime type.
   */
  private getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/aiff": ".aiff",
      "audio/x-aiff": ".aiff",
      "audio/flac": ".flac",
    };
    return mimeToExt[mimeType] ?? ".bin";
  }
}

export const storageService = new StorageService();
