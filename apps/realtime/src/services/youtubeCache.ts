import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve storage dir the same way storage.ts does
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isInDist = __dirname.includes("/dist/");
const appRoot = isInDist ? resolve(__dirname, "../../..") : resolve(__dirname, "../..");
const STORAGE_DIR = process.env.STORAGE_DIR ?? resolve(appRoot, ".storage/tracks");

// Ensure storage directory exists
if (!existsSync(STORAGE_DIR)) {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

export interface YouTubeCacheMetadata {
  videoId: string;
  title: string;
  durationSec: number;
  bpm: number | null;
  waveform: number[] | null;
  thumbnailUrl: string | null;
  cachedAt: number;
}

/**
 * Get the storage key for a YouTube audio file.
 * Uses `yt-{videoId}.m4a` format — intentionally NOT content-addressed
 * because YouTube videoIds are immutable identifiers.
 */
function audioKey(videoId: string): string {
  return `yt-${videoId}.m4a`;
}

function metaKey(videoId: string): string {
  return `yt-${videoId}.meta.json`;
}

function localPath(key: string): string {
  return join(STORAGE_DIR, key);
}

// In-memory metadata cache for fast lookups
const metadataCache = new Map<string, YouTubeCacheMetadata>();

/**
 * Check if a YouTube video's audio is cached.
 */
export async function hasCachedAudio(videoId: string): Promise<boolean> {
  const key = audioKey(videoId);
  const local = localPath(key);

  if (existsSync(local)) {
    return true;
  }

  return false;
}

/**
 * Get a download URL for cached audio.
 * Returns null if not cached.
 */
export function getCachedAudioUrl(videoId: string): string | null {
  const key = audioKey(videoId);
  const local = localPath(key);

  if (!existsSync(local)) {
    return null;
  }

  const cdnBase = getCdnBaseUrl();
  return `${cdnBase}/${key}`;
}

/**
 * Cache extracted YouTube audio.
 * Copies the file to the cache directory.
 */
export async function cacheAudio(videoId: string, filePath: string): Promise<void> {
  const key = audioKey(videoId);
  const local = localPath(key);

  // Skip if already cached locally
  if (existsSync(local)) {
    return;
  }

  try {
    // Read the extracted file
    const buffer = await readFile(filePath);

    // Write to local filesystem
    await writeFile(local, buffer);

    console.log(`[youtubeCache] Cached audio for ${videoId} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.error(`[youtubeCache] Failed to cache audio for ${videoId}:`, err);
    // Non-fatal — caching failure shouldn't break the stream
  }
}

/**
 * Get cached metadata for a YouTube video.
 * Returns null if no metadata is cached.
 */
export async function getCachedMetadata(videoId: string): Promise<YouTubeCacheMetadata | null> {
  // Check in-memory cache first
  const cached = metadataCache.get(videoId);
  if (cached) return cached;

  const key = metaKey(videoId);
  const local = localPath(key);

  try {
    if (!existsSync(local)) return null;

    const json = await readFile(local, "utf-8");
    const meta: YouTubeCacheMetadata = JSON.parse(json);
    metadataCache.set(videoId, meta);
    return meta;
  } catch {
    return null;
  }
}

/**
 * Cache metadata for a YouTube video.
 */
export async function cacheMetadata(videoId: string, meta: YouTubeCacheMetadata): Promise<void> {
  const key = metaKey(videoId);
  const local = localPath(key);

  try {
    const json = JSON.stringify(meta);
    await writeFile(local, json, "utf-8");

    // Update in-memory cache
    metadataCache.set(videoId, meta);

    console.log(`[youtubeCache] Cached metadata for ${videoId}`);
  } catch (err) {
    console.error(`[youtubeCache] Failed to cache metadata for ${videoId}:`, err);
  }
}

/**
 * Update only the BPM and waveform fields in cached metadata.
 * Creates metadata if it doesn't exist yet (with partial fields).
 */
export async function updateMetadataAnalysis(
  videoId: string,
  bpm: number | null,
  waveform: number[]
): Promise<void> {
  const existing = await getCachedMetadata(videoId);

  const meta: YouTubeCacheMetadata = existing
    ? { ...existing, bpm, waveform }
    : {
        videoId,
        title: "",
        durationSec: 0,
        bpm,
        waveform,
        thumbnailUrl: null,
        cachedAt: Date.now(),
      };

  await cacheMetadata(videoId, meta);
}

// --- CDN URL helper ---

function getCdnBaseUrl(): string {
  if (process.env.CDN_BASE_URL) {
    return process.env.CDN_BASE_URL;
  }
  const flyApp = process.env.FLY_APP_NAME;
  if (flyApp) {
    return `https://${flyApp}.fly.dev/files`;
  }
  const port = process.env.PORT || "3001";
  return `http://localhost:${port}/files`;
}
