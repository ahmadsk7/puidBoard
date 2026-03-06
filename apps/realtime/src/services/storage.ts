/**
 * File storage service for track assets.
 *
 * MVP implementation uses local filesystem.
 * Production implementation will use S3-compatible object storage.
 */

import { createHash } from "crypto";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { join, dirname, resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { supabaseStorage } from "./supabaseStorage.js";

// Get the directory of this module for reliable relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use environment variable or default to .storage/tracks relative to the realtime app root
// When running with tsx, __dirname is the source dir; when running built JS, it's in dist
const isInDist = __dirname.includes("/dist/");
const appRoot = isInDist ? resolve(__dirname, "../../..") : resolve(__dirname, "../..");
const DEFAULT_STORAGE_DIR = resolve(appRoot, ".storage/tracks");
const STORAGE_DIR = process.env.STORAGE_DIR ?? DEFAULT_STORAGE_DIR;
const PORT = process.env.PORT ?? "3001";
const CDN_BASE_URL = process.env.CDN_BASE_URL
  ?? (process.env.FLY_APP_NAME
    ? `https://${process.env.FLY_APP_NAME}.fly.dev/files`
    : `http://localhost:${PORT}/files`);

console.log(`[storage] __dirname: ${__dirname}`);
console.log(`[storage] appRoot: ${appRoot}`);

export interface UploadResult {
  storageKey: string;
  fileHash: string;
  fileSizeBytes: number;
}

class StorageService {
  private initialized = false;
  private useSupabase: boolean;

  constructor() {
    this.useSupabase = supabaseStorage.isAvailable();

    if (this.useSupabase) {
      console.log(`[storage] Using Supabase Storage (with local filesystem fallback)`);
    } else {
      console.log(`[storage] Using local filesystem storage`);
    }
    console.log(`[storage] Storage directory: ${STORAGE_DIR}`);
    console.log(`[storage] CDN base URL: ${CDN_BASE_URL}`);

    this.ensureStorageDir().catch((err) =>
      console.error(`[storage] Failed to create storage dir:`, err)
    );
  }

  /**
   * Ensure storage directory exists.
   */
  private async ensureStorageDir(): Promise<void> {
    if (!this.initialized) {
      if (!existsSync(STORAGE_DIR)) {
        console.log(`[storage] Creating storage directory: ${STORAGE_DIR}`);
        await mkdir(STORAGE_DIR, { recursive: true });
      }
      this.initialized = true;
    }
  }

  /**
   * Upload a file to storage.
   * Tries Supabase first, falls back to local filesystem on failure.
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadResult> {
    if (this.useSupabase) {
      try {
        return await supabaseStorage.upload(buffer, filename, mimeType);
      } catch (err) {
        console.error(`[storage] Supabase upload failed, falling back to local filesystem:`, err instanceof Error ? err.message : err);
      }
    }

    // Fall back to local filesystem
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
      console.log(`[storage] Writing file: ${filePath} (${fileSizeBytes} bytes)`);
      await writeFile(filePath, buffer);
    } else {
      console.log(`[storage] File already exists (deduplication): ${storageKey}`);
    }

    return {
      storageKey,
      fileHash,
      fileSizeBytes,
    };
  }

  /**
   * Get CDN URL for a storage key.
   * Checks local filesystem first (handles Supabase fallback),
   * then tries Supabase signed URL, then returns local URL as last resort.
   */
  async getUrl(storageKey: string): Promise<string> {
    const localPath = join(STORAGE_DIR, storageKey);
    const existsLocally = existsSync(localPath);

    if (existsLocally) {
      return `${CDN_BASE_URL}/${storageKey}`;
    }

    if (this.useSupabase) {
      try {
        return await supabaseStorage.getSignedUrlForDownload(storageKey);
      } catch (err) {
        console.error(`[storage] Supabase getUrl failed:`, err instanceof Error ? err.message : err);
      }
    }

    return `${CDN_BASE_URL}/${storageKey}`;
  }

  /**
   * Read file from storage.
   * Checks local filesystem first (handles Supabase fallback).
   */
  async read(storageKey: string): Promise<Buffer> {
    const localPath = join(STORAGE_DIR, storageKey);
    if (existsSync(localPath)) {
      console.log(`[storage] Reading local file: ${localPath}`);
      return await readFile(localPath);
    }

    if (this.useSupabase) {
      try {
        return await supabaseStorage.read(storageKey);
      } catch (err) {
        console.error(`[storage] Supabase read failed:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[storage] Fallback: reading from local path ${localPath}`);
    return await readFile(localPath);
  }

  /**
   * Delete file from storage.
   */
  async delete(storageKey: string): Promise<void> {
    const localPath = join(STORAGE_DIR, storageKey);
    if (existsSync(localPath)) {
      await unlink(localPath);
    }

    if (this.useSupabase) {
      try {
        await supabaseStorage.delete(storageKey);
      } catch (err) {
        console.error(`[storage] Supabase delete failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Get file extension from mime type.
   */
  private getExtensionFromMime(mimeType: string): string {
    // Handle codec parameters (e.g., "audio/webm;codecs=opus" -> "audio/webm")
    const baseType = mimeType.split(";")[0]!.trim();

    const mimeToExt: Record<string, string> = {
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/aiff": ".aiff",
      "audio/x-aiff": ".aiff",
      "audio/flac": ".flac",
      "audio/webm": ".webm",
      "audio/ogg": ".ogg",
      "audio/mp4": ".m4a",
    };
    return mimeToExt[baseType] ?? ".bin";
  }
}

export const storageService = new StorageService();
