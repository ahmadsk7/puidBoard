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
const CDN_BASE_URL = process.env.CDN_BASE_URL ?? "http://localhost:3001/files";

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
      console.log(`[storage] Using Supabase Storage`);
    } else {
      console.log(`[storage] Using local filesystem storage`);
      console.log(`[storage] Storage directory: ${STORAGE_DIR}`);
      console.log(`[storage] CDN base URL: ${CDN_BASE_URL}`);
    }
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
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadResult> {
    // Use Supabase if available
    if (this.useSupabase) {
      return await supabaseStorage.upload(buffer, filename, mimeType);
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
   */
  getUrl(storageKey: string): string {
    if (this.useSupabase) {
      return supabaseStorage.getUrl(storageKey);
    }
    return `${CDN_BASE_URL}/${storageKey}`;
  }

  /**
   * Read file from storage.
   */
  async read(storageKey: string): Promise<Buffer> {
    if (this.useSupabase) {
      return await supabaseStorage.read(storageKey);
    }

    const filePath = join(STORAGE_DIR, storageKey);
    console.log(`[storage] Reading file: ${filePath}, exists=${existsSync(filePath)}`);
    return await readFile(filePath);
  }

  /**
   * Delete file from storage.
   */
  async delete(storageKey: string): Promise<void> {
    if (this.useSupabase) {
      return await supabaseStorage.delete(storageKey);
    }

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
