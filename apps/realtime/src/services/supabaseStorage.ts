/**
 * Supabase Storage service for track uploads
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = "tracks";

export interface UploadResult {
  storageKey: string;
  fileHash: string;
  fileSizeBytes: number;
}

class SupabaseStorageService {
  private client: ReturnType<typeof createClient> | null = null;
  private isConfigured = false;

  constructor() {
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      this.client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      this.isConfigured = true;
      console.log("[storage] Supabase storage initialized");
    } else {
      console.log(
        "[storage] Supabase not configured, storage features disabled"
      );
    }
  }

  /**
   * Upload a file to Supabase storage
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadResult> {
    if (!this.client || !this.isConfigured) {
      throw new Error("Supabase storage not configured");
    }

    // Compute file hash for deduplication
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const fileSizeBytes = buffer.length;

    // Generate storage key (hash-based)
    const ext = this.getExtensionFromMime(mimeType);
    const storageKey = `${fileHash}${ext}`;

    // Upload to Supabase storage
    const { error } = await this.client.storage
      .from(BUCKET_NAME)
      .upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: true, // Allow overwriting if same hash
      });

    if (error && error.message !== "The resource already exists") {
      console.error("[storage] Upload error:", error);
      throw new Error(`Upload failed: ${error.message}`);
    }

    console.log(
      `[storage] Uploaded ${filename} as ${storageKey} (${fileSizeBytes} bytes)`
    );

    return {
      storageKey,
      fileHash,
      fileSizeBytes,
    };
  }

  /**
   * Get public URL for a storage key
   */
  getUrl(storageKey: string): string {
    if (!this.client || !this.isConfigured) {
      throw new Error("Supabase storage not configured");
    }

    const { data } = this.client.storage.from(BUCKET_NAME).getPublicUrl(storageKey);

    return data.publicUrl;
  }

  /**
   * Get signed URL for private access (expires in 1 hour)
   */
  async getSignedUrl(storageKey: string, expiresIn = 3600): Promise<string> {
    if (!this.client || !this.isConfigured) {
      throw new Error("Supabase storage not configured");
    }

    const { data, error } = await this.client.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storageKey, expiresIn);

    if (error) {
      throw new Error(`Failed to create signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  /**
   * Download file from storage
   */
  async read(storageKey: string): Promise<Buffer> {
    if (!this.client || !this.isConfigured) {
      throw new Error("Supabase storage not configured");
    }

    const { data, error } = await this.client.storage
      .from(BUCKET_NAME)
      .download(storageKey);

    if (error) {
      throw new Error(`Download failed: ${error.message}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  /**
   * Delete file from storage
   */
  async delete(storageKey: string): Promise<void> {
    if (!this.client || !this.isConfigured) {
      throw new Error("Supabase storage not configured");
    }

    const { error } = await this.client.storage
      .from(BUCKET_NAME)
      .remove([storageKey]);

    if (error) {
      console.error(`[storage] Delete error:`, error);
      throw new Error(`Delete failed: ${error.message}`);
    }

    console.log(`[storage] Deleted ${storageKey}`);
  }

  /**
   * Check if storage is configured
   */
  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Get file extension from mime type
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

export const supabaseStorage = new SupabaseStorageService();
