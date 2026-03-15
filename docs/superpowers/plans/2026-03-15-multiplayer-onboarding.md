# Multiplayer Onboarding & YouTube Audio Database — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the multiplayer onboarding flow so new joiners see a loading screen, get cached YouTube audio instantly, and auto-sync sampler sounds — instead of the current broken experience where the board appears before audio is ready.

**Architecture:** A server-side YouTube audio cache (Supabase Storage) eliminates redundant yt-dlp extractions. The ROOM_SNAPSHOT is enhanced to include direct file URLs for cached tracks + pre-computed metadata. A loading screen gates the board until all deck audio, sampler sounds, and clock sync are ready. A new TRACK_METADATA_REPORT event lets clients report BPM/waveform for server-side caching.

**Tech Stack:** TypeScript, Zod, Socket.IO, Supabase Storage, Web Audio API, Next.js 14, React 18

**Spec:** `docs/superpowers/specs/2026-03-15-multiplayer-onboarding-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/realtime/src/services/youtubeCache.ts` | YouTube cache service — check/read/write audio + metadata, using existing StorageService + SupabaseStorageService |
| `apps/realtime/src/handlers/metadata.ts` | TRACK_METADATA_REPORT socket handler |
| `apps/web/src/components/RoomLoadingScreen.tsx` | Loading screen overlay component |

### Modified Files
| File | Changes |
|------|---------|
| `packages/shared/src/state.ts` | Add optional `cached`, `bpm`, `waveform` fields to `QueueItemSchema` |
| `packages/shared/src/events.ts` | Add `TrackMetadataReportEventSchema` (standalone, like TIME_PING) |
| `packages/shared/src/index.ts` | Export new schemas |
| `apps/realtime/src/http/api.ts` | YouTube stream endpoint checks cache first, caches after extraction |
| `apps/realtime/src/protocol/handlers.ts` | Resolve cached URLs in JOIN/REJOIN snapshots, register metadata handler |
| `apps/web/src/components/DeckTransport.tsx` | Use `item.url` directly when `cached: true` |
| `apps/web/src/audio/useQueueAudioLoader.ts` | Use `item.url` directly when `cached: true` |
| `apps/web/src/components/SamplerPanel.tsx` | Auto-load custom sounds from snapshot on mount |
| `apps/web/src/realtime/client.ts` | Send TRACK_METADATA_REPORT after analysis, handle it on receive |
| `apps/web/src/app/room/[code]/page.tsx` | Add loading screen between ROOM_SNAPSHOT and board render |

---

## Chunk 1: Schema + Cache Foundation

### Task 1: Add Cache Fields to QueueItemSchema

**Files:**
- Modify: `packages/shared/src/state.ts:101-128`

- [ ] **Step 1: Add optional cache fields to QueueItemSchema**

In `packages/shared/src/state.ts`, add three new optional fields to `QueueItemSchema` after the `audioBuffer` field (line 127):

```typescript
  /** Pre-loaded audio buffer (client-side only, for YouTube tracks) */
  audioBuffer: z.any().optional(),
  /** Whether this track's audio is cached on the server (no yt-dlp needed) */
  cached: z.boolean().optional(),
  /** Pre-computed BPM from server cache */
  bpm: z.number().min(20).max(300).nullable().optional(),
  /** Pre-computed waveform data from server cache (480 floats, 0-1 normalized) */
  waveform: z.array(z.number()).optional(),
```

- [ ] **Step 2: Verify shared package builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/shared build`
Expected: Clean build with no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/state.ts
git commit -m "feat(shared): add cached, bpm, waveform fields to QueueItemSchema"
```

---

### Task 2: Add TrackMetadataReportEvent Schema

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add TrackMetadataReportEventSchema to events.ts**

Add after `TimePingEventSchema` (around line 494) — this is a standalone event, NOT a mutation:

```typescript
/**
 * Client reports computed BPM and waveform for a YouTube track.
 * Server caches this metadata for future joiners.
 * Standalone event (like TIME_PING) — NOT in ClientMutationEventSchema.
 */
export const TrackMetadataReportEventSchema = z.object({
  type: z.literal("TRACK_METADATA_REPORT"),
  /** YouTube video ID */
  videoId: z.string().min(1),
  /** Detected BPM */
  bpm: z.number().min(20).max(300).nullable(),
  /** Waveform data (typically 480 floats, 0-1 normalized) */
  waveform: z.array(z.number()).min(1),
});
export type TrackMetadataReportEvent = z.infer<typeof TrackMetadataReportEventSchema>;
```

- [ ] **Step 2: Export from index.ts**

In `packages/shared/src/index.ts`, add to the events export section:

```typescript
export {
  TrackMetadataReportEventSchema,
  type TrackMetadataReportEvent,
} from "./events.js";
```

- [ ] **Step 3: Verify shared package builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/shared build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/index.ts
git commit -m "feat(shared): add TrackMetadataReportEvent schema"
```

---

### Task 3: YouTube Cache Service

**Files:**
- Create: `apps/realtime/src/services/youtubeCache.ts`

This service manages the YouTube audio cache in Supabase Storage (or local filesystem fallback). It handles:
- Checking if a videoId is cached
- Getting a signed download URL for cached audio
- Uploading extracted audio to the cache
- Reading/writing metadata sidecars

- [ ] **Step 1: Create the cache service**

**Important:** This service reuses the existing `StorageService` singleton and `supabaseStorage` from the codebase. It does NOT recompute `STORAGE_DIR` or `CDN_BASE_URL` — those are owned by `storage.ts`. The codebase uses ESM (`import`), NOT CommonJS (`require`).

Create `apps/realtime/src/services/youtubeCache.ts`:

```typescript
import { readFile, writeFile } from "fs/promises";
import { join, dirname, resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { supabaseStorage } from "./supabaseStorage.js";

// Compute STORAGE_DIR the same way storage.ts does — reuse the exact same logic
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isInDist = __dirname.includes("/dist/");
const appRoot = isInDist ? resolve(__dirname, "../../..") : resolve(__dirname, "../..");
const STORAGE_DIR = process.env.STORAGE_DIR ?? resolve(appRoot, ".storage/tracks");
const PORT = process.env.PORT ?? "3001";
const CDN_BASE_URL = process.env.CDN_BASE_URL
  ?? (process.env.FLY_APP_NAME
    ? `https://${process.env.FLY_APP_NAME}.fly.dev/files`
    : `http://localhost:${PORT}/files`);

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
 * Storage key for a YouTube audio file.
 * Uses `yt-{videoId}.m4a` — intentionally NOT content-addressed (SHA-256)
 * because YouTube videoIds are immutable identifiers. The `yt-` prefix
 * prevents collisions with SHA-256 hash keys used by uploads.
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

// In-memory metadata cache for fast lookups (avoids reading sidecar files repeatedly)
const metadataCache = new Map<string, YouTubeCacheMetadata>();

/**
 * Check if a YouTube video's audio is cached (local filesystem or Supabase).
 */
export async function hasCachedAudio(videoId: string): Promise<boolean> {
  const key = audioKey(videoId);

  // Check local filesystem first (fast)
  if (existsSync(localPath(key))) {
    return true;
  }

  // Check Supabase if configured
  if (supabaseStorage.isAvailable()) {
    try {
      const url = await supabaseStorage.getSignedUrl(key, 60);
      return url !== null;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Get a download URL for cached audio. Returns null if not cached.
 */
export async function getCachedAudioUrl(videoId: string): Promise<string | null> {
  const key = audioKey(videoId);

  // Check local filesystem first
  if (existsSync(localPath(key))) {
    return `${CDN_BASE_URL}/${key}`;
  }

  // Check Supabase
  if (supabaseStorage.isAvailable()) {
    try {
      return await supabaseStorage.getSignedUrlForDownload(key);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Cache extracted YouTube audio. Reads the file into memory immediately
 * (so it's safe even if the source file is deleted after this call returns).
 * Stores to both local filesystem and Supabase (if configured).
 */
export async function cacheAudio(videoId: string, filePath: string): Promise<void> {
  const key = audioKey(videoId);

  // Skip if already cached locally
  if (existsSync(localPath(key))) {
    return;
  }

  // Read file into memory FIRST (before it can be deleted by caller)
  const buffer = await readFile(filePath);

  try {
    // Write to local filesystem
    await writeFile(localPath(key), buffer);

    // Upload to Supabase if configured
    if (supabaseStorage.isAvailable()) {
      await supabaseStorage.uploadWithKey(key, buffer, "audio/mp4");
    }

    console.log(`[youtubeCache] Cached audio for ${videoId} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.error(`[youtubeCache] Failed to cache audio for ${videoId}:`, err);
    // Non-fatal — caching failure shouldn't break the stream
  }
}

/**
 * Get cached metadata for a YouTube video. Returns null if none cached.
 */
export async function getCachedMetadata(videoId: string): Promise<YouTubeCacheMetadata | null> {
  // Check in-memory cache first
  const cached = metadataCache.get(videoId);
  if (cached) return cached;

  const key = metaKey(videoId);

  try {
    let json: string | null = null;

    // Try local filesystem
    if (existsSync(localPath(key))) {
      json = await readFile(localPath(key), "utf-8");
    }

    // Try Supabase if not found locally
    if (!json && supabaseStorage.isAvailable()) {
      try {
        const data = await supabaseStorage.download(key);
        if (data) json = data.toString("utf-8");
      } catch {
        // Not in Supabase either
      }
    }

    if (!json) return null;

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

  try {
    const json = JSON.stringify(meta);
    const buffer = Buffer.from(json, "utf-8");

    // Write to local filesystem
    await writeFile(localPath(key), buffer);

    // Upload to Supabase if configured
    if (supabaseStorage.isAvailable()) {
      await supabaseStorage.uploadWithKey(key, buffer, "application/json");
    }

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
```

**Note:** This service uses `supabaseStorage.uploadWithKey()` and `supabaseStorage.download()` which may not exist yet on `SupabaseStorageService`. If they don't, add them:

- `uploadWithKey(key: string, buffer: Buffer, mimeType: string)` — uploads with a caller-specified key instead of computing SHA-256
- `download(key: string): Promise<Buffer | null>` — downloads a file by key
- `isAvailable(): boolean` — returns whether Supabase is configured

These are thin wrappers around the existing Supabase client. Check `supabaseStorage.ts` and add whatever's missing.

- [ ] **Step 2: Verify server builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/realtime build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add apps/realtime/src/services/youtubeCache.ts
git commit -m "feat(realtime): add YouTube audio cache service"
```

---

## Chunk 2: Server-Side Cache Integration

### Task 4: YouTube Stream Endpoint — Cache Check + Cache Write

**Files:**
- Modify: `apps/realtime/src/http/api.ts:677-773`

The stream endpoint currently always runs yt-dlp. We add two behaviors:
1. **Before extraction:** Check if audio is cached → serve directly
2. **After extraction:** Cache the extracted audio in parallel with streaming

- [ ] **Step 1: Add import for youtubeCache**

At the top of `apps/realtime/src/http/api.ts`, add:

```typescript
import { hasCachedAudio, getCachedAudioUrl, cacheAudio } from "../services/youtubeCache.js";
```

- [ ] **Step 2: Add cache check at the start of handleYouTubeStream**

In `handleYouTubeStream()` (around line 682), add the cache check before the `activeStreams` check. Insert right after the function opens and videoId validation:

```typescript
  // Check cache first — skip yt-dlp entirely if we have this audio
  try {
    const isCached = await hasCachedAudio(videoId);
    if (isCached) {
      const cachedUrl = await getCachedAudioUrl(videoId);
      if (cachedUrl) {
        // For local files, stream directly. For Supabase signed URLs, redirect.
        if (cachedUrl.startsWith("http://localhost") || cachedUrl.includes(".fly.dev/files")) {
          // Local file — extract the storage key and stream from disk
          const storageKey = `yt-${videoId}.m4a`;
          const filePath = join(STORAGE_DIR, storageKey);
          if (existsSync(filePath)) {
            const stat = statSync(filePath);
            res.writeHead(200, {
              "Content-Type": "audio/mp4",
              "Content-Length": stat.size,
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=31536000",
            });
            createReadStream(filePath).pipe(res);
            console.log(`[api] YouTube cache hit for ${videoId}, serving from disk`);
            return;
          }
        } else {
          // Supabase signed URL — redirect
          res.writeHead(302, { Location: cachedUrl });
          res.end();
          console.log(`[api] YouTube cache hit for ${videoId}, redirecting to Supabase`);
          return;
        }
      }
    }
  } catch (err) {
    console.warn(`[api] Cache check failed for ${videoId}, falling back to yt-dlp:`, err);
    // Continue to normal extraction flow
  }
```

You'll need to add missing imports. The file already imports `createReadStream` from `"fs"` (line 25). Add the missing ones using the same bare `"fs"` convention (NOT `"node:fs"`):

```typescript
import { existsSync, statSync, createReadStream } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
```

Check which are already imported and only add what's missing.

Also define `STORAGE_DIR` at module scope using the same pattern as `storage.ts`:

```typescript
const __filename_api = fileURLToPath(import.meta.url);
const __dirname_api = dirname(__filename_api);
const isInDist_api = __dirname_api.includes("/dist/");
const appRoot_api = isInDist_api ? resolve(__dirname_api, "../../..") : resolve(__dirname_api, "../..");
const STORAGE_DIR = process.env.STORAGE_DIR ?? resolve(appRoot_api, ".storage/tracks");
```

Use distinct variable names (e.g. `__filename_api`) to avoid conflicts if `__filename` is already defined elsewhere in the file.

- [ ] **Step 3: Add cache write after successful extraction**

In the existing extraction flow, after `downloadYouTubeAudio()` succeeds (around line 725-726 where `result` is assigned), add the cache write. **Important:** `cacheAudio` must be awaited here — it reads the temp file into memory, and the `finally` block deletes the temp file. If we fire-and-forget, the temp file could be deleted before `cacheAudio` reads it.

```typescript
    const result = await downloadYouTubeAudio(videoId, abortController.signal);
    tempFilePath = result.filePath;

    // Cache the extracted audio BEFORE streaming — reads file into memory
    // so the temp file can safely be deleted in the finally block.
    // This adds negligible latency since it's just a file read + write.
    await cacheAudio(videoId, result.filePath).catch((err) => {
      console.warn(`[api] Cache write failed for ${videoId}:`, err);
    });
```

- [ ] **Step 4: Verify server builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/realtime build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add apps/realtime/src/http/api.ts
git commit -m "feat(realtime): check YouTube cache before yt-dlp, cache after extraction"
```

---

### Task 5: Resolve Cached URLs in ROOM_SNAPSHOT

**Files:**
- Modify: `apps/realtime/src/protocol/handlers.ts:238-245` (JOIN) and `:310-317` (REJOIN)

When building a ROOM_SNAPSHOT or ROOM_REJOIN_SNAPSHOT, resolve YouTube queue items to their cached URLs and attach metadata.

- [ ] **Step 1: Add import**

At the top of `handlers.ts`:

```typescript
import { getCachedAudioUrl, getCachedMetadata } from "../services/youtubeCache.js";
```

- [ ] **Step 2: Create a helper to resolve cached URLs in room state**

Add this function before `handleJoinRoom`:

```typescript
/**
 * Resolve cached YouTube track URLs in a room state snapshot.
 * Replaces stream URLs with direct file URLs for cached tracks
 * and attaches pre-computed metadata (BPM, waveform).
 */
async function resolveSnapshotCacheUrls(state: RoomState): Promise<RoomState> {
  const resolvedQueue = await Promise.all(
    state.queue.map(async (item) => {
      if (item.source !== "youtube" || !item.youtubeVideoId) {
        return item;
      }

      try {
        const cachedUrl = await getCachedAudioUrl(item.youtubeVideoId);
        if (!cachedUrl) return item;

        const meta = await getCachedMetadata(item.youtubeVideoId);
        return {
          ...item,
          url: cachedUrl,
          cached: true,
          ...(meta?.bpm != null ? { bpm: meta.bpm } : {}),
          ...(meta?.waveform ? { waveform: meta.waveform } : {}),
        };
      } catch {
        return item;
      }
    })
  );

  return { ...state, queue: resolvedQueue };
}
```

- [ ] **Step 3: Use the helper in handleJoinRoom**

In `handleJoinRoom`, around lines 238-245 where the ROOM_SNAPSHOT is created, change:

```typescript
  // Before:
  const snapshot: RoomSnapshotEvent = {
    type: "ROOM_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: room,
  };

  // After:
  const resolvedState = await resolveSnapshotCacheUrls(room);
  const snapshot: RoomSnapshotEvent = {
    type: "ROOM_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: resolvedState,
  };
```

Note: `handleJoinRoom` may need to become `async` if it isn't already. Check and update accordingly.

- [ ] **Step 4: Use the helper in handleRejoinRoom**

In `handleRejoinRoom`, around lines 310-317 where the ROOM_REJOIN_SNAPSHOT is emitted, change:

```typescript
  // Before:
  socket.emit("ROOM_REJOIN_SNAPSHOT", {
    type: "ROOM_REJOIN_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: room,
    clientId,
    missedEvents: [],
  });

  // After:
  const resolvedState = await resolveSnapshotCacheUrls(room);
  socket.emit("ROOM_REJOIN_SNAPSHOT", {
    type: "ROOM_REJOIN_SNAPSHOT",
    roomId: room.roomId,
    serverTs: Date.now(),
    state: resolvedState,
    clientId,
    missedEvents: [],
  });
```

Make `handleRejoinRoom` async if needed. Also update the `socket.on("REJOIN_ROOM", ...)` callback in `registerHandlers()` to handle the async function properly — wrap in `.catch()` to prevent unhandled promise rejections:

```typescript
  socket.on("REJOIN_ROOM", (data: unknown) => {
    handleRejoinRoom(io, socket, data).catch((err) => {
      console.error("[handlers] handleRejoinRoom error:", err);
    });
  });
```

Do the same for `handleJoinRoom` if it wasn't already async.

- [ ] **Step 5: Verify server builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/realtime build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add apps/realtime/src/protocol/handlers.ts
git commit -m "feat(realtime): resolve cached YouTube URLs in room snapshots"
```

---

### Task 6: TRACK_METADATA_REPORT Server Handler

**Files:**
- Create: `apps/realtime/src/handlers/metadata.ts`
- Modify: `apps/realtime/src/protocol/handlers.ts` (register handler)

- [ ] **Step 1: Create the handler**

Create `apps/realtime/src/handlers/metadata.ts`:

```typescript
import type { Server, Socket } from "socket.io";
import { TrackMetadataReportEventSchema } from "@puid-board/shared";
import { updateMetadataAnalysis } from "../services/youtubeCache.js";

/**
 * Handle TRACK_METADATA_REPORT from clients.
 * Clients send this after completing BPM detection + waveform generation
 * for a YouTube track. We cache the metadata so future joiners skip analysis.
 *
 * This is a standalone event (like TIME_PING), not a room mutation.
 */
export function registerMetadataHandlers(socket: Socket): void {
  socket.on("TRACK_METADATA_REPORT", async (data: unknown) => {
    const parsed = TrackMetadataReportEventSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[metadata] Invalid TRACK_METADATA_REPORT:", parsed.error.message);
      return;
    }

    const { videoId, bpm, waveform } = parsed.data;

    try {
      await updateMetadataAnalysis(videoId, bpm, waveform);
      console.log(`[metadata] Cached analysis for ${videoId}: BPM=${bpm}`);
    } catch (err) {
      console.error(`[metadata] Failed to cache analysis for ${videoId}:`, err);
    }
  });
}
```

- [ ] **Step 2: Register the handler in protocol/handlers.ts**

In `registerHandlers()` function (around line 80), add:

```typescript
import { registerMetadataHandlers } from "../handlers/metadata.js";
```

And in the function body, after the other `register*Handlers` calls:

```typescript
  registerMetadataHandlers(socket);
```

- [ ] **Step 3: Verify server builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/realtime build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add apps/realtime/src/handlers/metadata.ts apps/realtime/src/protocol/handlers.ts
git commit -m "feat(realtime): add TRACK_METADATA_REPORT handler for caching analysis"
```

---

## Chunk 3: Client-Side Cache Support

### Task 7: DeckTransport — Use Cached URLs

**Files:**
- Modify: `apps/web/src/components/DeckTransport.tsx:84-97`

Currently `getAudioUrl()` always returns `youtube:VIDEO_ID` for YouTube tracks, forcing the deck to re-extract via yt-dlp. When `cached: true`, use the direct URL instead.

- [ ] **Step 1: Update getAudioUrl in DeckTransport**

In `DeckTransport.tsx`, replace the `getAudioUrl` function (lines 84-97):

```typescript
const getAudioUrl = async (): Promise<string> => {
  const isYouTube = queueItem.source === "youtube" && queueItem.youtubeVideoId;

  if (isYouTube) {
    // If track is cached, use the direct URL (same path as uploaded tracks)
    if (queueItem.cached) {
      console.log(`[DeckTransport-${deckId}]   - Using cached URL: ${queueItem.url}`);
      return queueItem.url;
    }
    // Uncached YouTube track — use the youtube:VIDEO_ID format for yt-dlp extraction
    const youtubeUrl = `youtube:${queueItem.youtubeVideoId}`;
    console.log(`[DeckTransport-${deckId}]   - Using YouTube URL: ${youtubeUrl}`);
    return youtubeUrl;
  }
  console.log(`[DeckTransport-${deckId}]   - Using direct URL: ${queueItem.url}`);
  return queueItem.url;
};
```

- [ ] **Step 2: Add public method to Deck class for pre-computed analysis**

The `Deck` class has a private `notify()` method, and `useDeck()` returns a hook result — not the Deck instance directly. We need to add a public method to `Deck` that sets pre-computed analysis data.

In `apps/web/src/audio/deck.ts`, add this public method to the `Deck` class (after `analyzeAudio` around line 552):

```typescript
  /**
   * Set pre-computed analysis data from the server cache.
   * Skips client-side BPM detection and waveform generation.
   */
  setPrecomputedAnalysis(bpm: number | null, waveform: number[] | null): void {
    // Don't overwrite if client-side analysis already completed
    if (this.state.analysis.status === "complete" && this.state.analysis.bpm !== null) {
      return;
    }
    this.state.analysis = {
      bpm,
      waveform: waveform ? new Float32Array(waveform) : null,
      status: bpm !== null ? "complete" : "idle",
    };
    this.notify();
  }
```

Then expose it from `useDeck()` in `apps/web/src/audio/useDeck.ts`. Add a callback:

```typescript
  const setPrecomputedAnalysis = useCallback((bpm: number | null, waveform: number[] | null) => {
    deckRef.current.setPrecomputedAnalysis(bpm, waveform);
  }, []);
```

And include it in the return object.

- [ ] **Step 3: Use pre-computed analysis from snapshot in DeckTransport**

In `DeckTransport.tsx`, find the effect that sends `DECK_BPM_DETECTED` (around lines 226-251). Before it, add a new effect that applies pre-computed analysis from the snapshot using the new hook method:

```typescript
// Apply pre-computed BPM/waveform from cache if available
useEffect(() => {
  if (!queueItem?.bpm && !queueItem?.waveform) return;
  setPrecomputedAnalysis(queueItem.bpm ?? null, queueItem.waveform ?? null);
}, [queueItem?.bpm, queueItem?.waveform, setPrecomputedAnalysis]);
```

Where `setPrecomputedAnalysis` comes from the `useDeck()` destructuring at the top of the component.

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build (some warnings OK)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/DeckTransport.tsx
git commit -m "feat(web): DeckTransport uses cached URLs and pre-computed metadata"
```

---

### Task 8: useQueueAudioLoader — Use Cached URLs

**Files:**
- Modify: `apps/web/src/audio/useQueueAudioLoader.ts:128`

Currently constructs `${realtimeUrl}/api/youtube/stream/${videoId}`. For cached tracks, use `item.url` directly.

- [ ] **Step 1: Update URL construction in loadYouTubeAudio**

In `useQueueAudioLoader.ts`, find where the stream URL is constructed (line 128). The surrounding context is a loop over queue items that loads YouTube tracks. Update the URL selection:

```typescript
  // For cached tracks, use the direct URL. For uncached, construct the stream URL.
  const streamUrl = item.cached
    ? item.url
    : `${realtimeUrl}/api/youtube/stream/${encodeURIComponent(videoId)}`;
```

The variable name `streamUrl` is fine even for cached tracks — it's just a download URL either way.

- [ ] **Step 2: Skip extracting stage for cached tracks**

For cached tracks, there's no yt-dlp extraction happening on the server, so the "extracting" loading stage is misleading. Update the initial loading state to skip straight to "downloading" when cached:

Find where the loading state is initially set to "extracting" (around line 52-56). Change it to:

```typescript
  const initialStage = item.cached ? "downloading" : "extracting";
  setLoadingStates((prev) => new Map(prev).set(item.id, { stage: initialStage, progress: 0, error: null }));
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/audio/useQueueAudioLoader.ts
git commit -m "feat(web): useQueueAudioLoader uses cached URLs for YouTube tracks"
```

---

### Task 9: Client Sends TRACK_METADATA_REPORT

**Files:**
- Modify: `apps/web/src/realtime/client.ts`

After a client finishes BPM detection + waveform generation for a YouTube track, it sends the results to the server for caching.

- [ ] **Step 1: Add import**

At the top of `client.ts`, add `TrackMetadataReportEvent` to the import from `@puid-board/shared` if not already imported.

- [ ] **Step 2: Add a method to send metadata reports**

Add a public method to the `RealtimeClient` class:

```typescript
  /** Report computed BPM/waveform for a YouTube track to server for caching */
  sendTrackMetadata(videoId: string, bpm: number | null, waveform: number[]): void {
    if (!this.socket?.connected) return;
    this.socket.emit("TRACK_METADATA_REPORT", {
      type: "TRACK_METADATA_REPORT",
      videoId,
      bpm,
      waveform,
    });
  }
```

- [ ] **Step 3: Wire up in DeckTransport**

In `DeckTransport.tsx`, in the existing effect that sends `DECK_BPM_DETECTED` (around lines 226-251), add a call to also report metadata for YouTube tracks. After the `sendEvent` call for `DECK_BPM_DETECTED`:

```typescript
    // Also report to server cache for YouTube tracks
    if (queueItem?.source === "youtube" && queueItem?.youtubeVideoId && !queueItem?.cached) {
      const waveform = deck.state.analysis.waveform;
      if (waveform) {
        const client = getRealtimeClient();
        client.sendTrackMetadata(
          queueItem.youtubeVideoId,
          bpm,
          Array.from(waveform)
        );
      }
    }
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/realtime/client.ts apps/web/src/components/DeckTransport.tsx
git commit -m "feat(web): send TRACK_METADATA_REPORT after analysis for YouTube tracks"
```

---

## Chunk 4: Sampler + Loading Screen

### Task 10: Auto-load Custom Sampler Sounds on Join

**Files:**
- Modify: `apps/web/src/components/SamplerPanel.tsx:88-92`

Currently the mount effect only calls `loadDefaultSamples()`. It needs to also check `state.sampler.slots` from the snapshot and load any custom sounds.

- [ ] **Step 1: Add state prop to SamplerPanel**

The component currently does NOT receive room state. Update `SamplerPanelProps` (lines 16-27) to add a `samplerState` prop:

```typescript
export type SamplerPanelProps = {
  width?: number;
  roomId?: string;
  clientId?: string;
  sendEvent?: (e: ClientMutationEvent) => void;
  nextSeq?: () => number;
  /** Room sampler state from snapshot — for auto-loading custom sounds on join */
  samplerState?: { slots: Array<{ url: string | null; name: string; isCustom: boolean }> };
};
```

- [ ] **Step 2: Update the mount effect to load custom sounds**

Replace the existing mount effect (lines 88-92):

```typescript
  // Load default samples on mount, then overlay any custom sounds from room state
  useEffect(() => {
    const init = async () => {
      await loadDefaultSamples();

      // Auto-load custom sounds from room snapshot
      if (samplerState) {
        for (let i = 0; i < samplerState.slots.length; i++) {
          const slot = samplerState.slots[i];
          if (slot && slot.isCustom && slot.url) {
            try {
              await loadCustomSample(i as 0 | 1 | 2 | 3, slot.url, slot.name);
            } catch (err) {
              console.warn(`[SamplerPanel] Failed to load custom sample for slot ${i}:`, err);
            }
          }
        }
      }
    };

    init().catch((error) => {
      console.error("[SamplerPanel] Failed to initialize samples:", error);
    });
  }, []); // Empty deps — only run on mount
```

Add the import for `loadCustomSample` at the top of the file:

```typescript
import { loadDefaultSamples, loadCustomSample, /* ...existing imports... */ } from "../audio/sampler";
```

- [ ] **Step 3: Pass samplerState from DJBoard**

In `DJBoard.tsx`, find where `<SamplerPanel>` is rendered and add the `samplerState` prop:

```typescript
<SamplerPanel
  // ...existing props...
  samplerState={state.sampler}
/>
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SamplerPanel.tsx apps/web/src/components/DJBoard.tsx
git commit -m "fix(web): auto-load custom sampler sounds from room snapshot on join"
```

---

### Task 11: Loading Room Screen Component

**Files:**
- Create: `apps/web/src/components/RoomLoadingScreen.tsx`

A full-screen overlay that shows loading progress for deck audio, sampler sounds, and clock sync. The loading screen does NOT fetch audio itself — it monitors the actual loading pipeline (`useQueueAudioLoader` and sampler) to avoid double-downloading.

- [ ] **Step 1: Create the component**

**Design decision:** The loading screen is a **gate**, not a loader. The actual audio downloading is done by `useQueueAudioLoader` (which runs in the parent). The loading screen receives progress signals and blocks the board until everything is ready. This avoids the anti-pattern of fetching audio in the loading screen only to throw it away.

Create `apps/web/src/components/RoomLoadingScreen.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import type { RoomState } from "@puid-board/shared";
import { initAudioEngine } from "../audio/engine";

export interface LoadingProgress {
  /** Deck A track loading status */
  deckA: "not_needed" | "loading" | "ready" | "error";
  /** Deck B track loading status */
  deckB: "not_needed" | "loading" | "ready" | "error";
  /** Sampler custom sounds loading status */
  sampler: "not_needed" | "loading" | "ready" | "error";
}

interface RoomLoadingScreenProps {
  state: RoomState;
  progress: LoadingProgress;
  onReady: () => void;
}

export function RoomLoadingScreen({ state, progress, onReady }: RoomLoadingScreenProps) {
  const [audioReady, setAudioReady] = useState(false);

  // Check if all items are loaded
  const allStatuses = [progress.deckA, progress.deckB, progress.sampler];
  const allLoaded = allStatuses.every((s) => s === "not_needed" || s === "ready");

  const handleClick = useCallback(async () => {
    try {
      await initAudioEngine();
      setAudioReady(true);
      onReady();
    } catch (err) {
      console.error("[RoomLoadingScreen] Failed to init audio:", err);
    }
  }, [onReady]);

  // Build display items (only show items that need loading)
  const items: Array<{ label: string; status: string }> = [];
  if (progress.deckA !== "not_needed") {
    const deckAItem = state.queue.find((q) => q.trackId === state.deckA.loadedTrackId);
    items.push({ label: `Deck A: ${deckAItem?.title ?? "Loading..."}`, status: progress.deckA });
  }
  if (progress.deckB !== "not_needed") {
    const deckBItem = state.queue.find((q) => q.trackId === state.deckB.loadedTrackId);
    items.push({ label: `Deck B: ${deckBItem?.title ?? "Loading..."}`, status: progress.deckB });
  }
  if (progress.sampler !== "not_needed") {
    items.push({ label: "Custom sampler sounds", status: progress.sampler });
  }

  const readyCount = allStatuses.filter((s) => s === "ready" || s === "not_needed").length;
  const totalCount = allStatuses.length;
  const overallProgress = totalCount > 0 ? readyCount / totalCount : 1;

  const memberCount = state.members.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        fontFamily: "monospace",
        color: "#e0e0e0",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <h2 style={{ color: "#3b82f6", fontSize: 24, marginBottom: 8 }}>
          Joining {state.roomCode}
        </h2>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 32 }}>
          {memberCount} {memberCount === 1 ? "person" : "people"} in the room
        </p>

        {/* Per-item progress */}
        {items.length > 0 && (
          <div style={{ marginBottom: 32, textAlign: "left" }}>
            {items.map((item, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{item.label}</span>
                  <span style={{
                    color: item.status === "ready" ? "#4ade80" : item.status === "error" ? "#ef4444" : "#888",
                  }}>
                    {item.status === "ready" ? "Ready" : item.status === "error" ? "Error" : "Loading..."}
                  </span>
                </div>
                <div style={{ height: 4, background: "#222", borderRadius: 2 }}>
                  <div style={{
                    height: "100%",
                    width: `${item.status === "ready" ? 100 : item.status === "loading" ? 50 : 0}%`,
                    background: item.status === "error" ? "#ef4444" : "#3b82f6",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Overall progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ height: 6, background: "#222", borderRadius: 3 }}>
            <div style={{
              height: "100%",
              width: `${overallProgress * 100}%`,
              background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
              borderRadius: 3,
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>

        {/* Start button — doubles as autoplay gate */}
        {allLoaded && !audioReady && (
          <button
            onClick={handleClick}
            style={{
              padding: "12px 32px",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontFamily: "monospace",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Click to Start
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/RoomLoadingScreen.tsx
git commit -m "feat(web): add RoomLoadingScreen component"
```

---

### Task 12: Integrate Loading Screen into Room Page

**Files:**
- Modify: `apps/web/src/app/room/[code]/page.tsx:322-328`

Replace the immediate `<RoomContent>` render with a two-phase flow: loading screen first, then board.

- [ ] **Step 1: Import the loading screen**

At the top of `page.tsx`:

```typescript
import { RoomLoadingScreen } from "../../../components/RoomLoadingScreen";
```

- [ ] **Step 2: Add loading state to RealtimeRoomContent**

In the `RealtimeRoomContent` component (around line 98), add state variables:

```typescript
  const [roomReady, setRoomReady] = useState(false);
```

And a reset effect:

```typescript
  useEffect(() => {
    setRoomReady(false);
  }, [state?.roomId]);
```

- [ ] **Step 3: Compute loading progress from queue/sampler state**

Add a `useMemo` that computes `LoadingProgress` from the room state and the queue audio loader's state. The loading screen uses this to know what's ready.

```typescript
  const loadingProgress = useMemo((): LoadingProgress => {
    if (!state) return { deckA: "not_needed", deckB: "not_needed", sampler: "not_needed" };

    // Deck A
    let deckA: LoadingProgress["deckA"] = "not_needed";
    if (state.deckA.loadedTrackId) {
      const item = state.queue.find((q) => q.trackId === state.deckA.loadedTrackId);
      if (item) {
        deckA = item.audioBuffer ? "ready" : "loading";
      }
    }

    // Deck B
    let deckB: LoadingProgress["deckB"] = "not_needed";
    if (state.deckB.loadedTrackId) {
      const item = state.queue.find((q) => q.trackId === state.deckB.loadedTrackId);
      if (item) {
        deckB = item.audioBuffer ? "ready" : "loading";
      }
    }

    // Sampler
    const hasCustom = state.sampler.slots.some((s) => s.isCustom && s.url);
    const sampler = hasCustom ? "loading" : "not_needed"; // Will be set to "ready" once loaded

    return { deckA, deckB, sampler };
  }, [state]);
```

Note: The `audioBuffer` field on queue items is set by `useQueueAudioLoader` which runs in the parent. The loading progress thus reflects the actual loading pipeline, not a separate download. Adjust this logic based on how the queue loader exposes state — you may need to use the loader's `getLoadingState()` function instead.

- [ ] **Step 4: Replace the return block**

Find the return statement that renders `<RoomContent>` (around line 322). Replace it with:

```typescript
  // Skip loading screen for room creators (empty room, nothing to load)
  // and go straight to board
  if (!roomReady && !isCreating) {
    return (
      <RoomLoadingScreen
        state={state}
        progress={loadingProgress}
        onReady={() => setRoomReady(true)}
      />
    );
  }

  // Board is ready (or room was just created)
  return (
    <RoomContent
      state={state}
      clientId={clientId}
      latencyMs={latencyMs}
      sendEvent={sendEvent}
      nextSeq={nextSeq}
    />
  );
```

The `isCreating` variable already exists in the component (around line 101).

- [ ] **Step 4: Remove the old autoplay gate from RoomContent**

In the `RoomContent` component (lines 27-42), the click-to-init-audio `useEffect` can be removed since the loading screen now handles this with the "Click to Start" button. Remove:

```typescript
  useEffect(() => {
    const handleFirstClick = async () => {
      try {
        await initAudioEngine();
        console.log("[Room] Audio engine initialized on first click");
        document.removeEventListener("click", handleFirstClick);
      } catch (err) {
        console.error("[Room] Failed to initialize audio:", err);
      }
    };

    document.addEventListener("click", handleFirstClick);
    return () => document.removeEventListener("click", handleFirstClick);
  }, []);
```

The `initAudioEngine` import can stay since it may be used elsewhere, but verify.

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/ibbybajwa/puidBoard && pnpm --filter @puid-board/web build`
Expected: Clean build

- [ ] **Step 6: Manual test**

1. Start the dev server: `pnpm dev`
2. Open two browser tabs
3. Tab 1: Create a room, add a YouTube track, load it to Deck A
4. Tab 2: Join the same room via room code
5. Verify: Tab 2 shows loading screen with "Deck A: Loading..." progress
6. Verify: After loading completes, "Click to Start" button appears
7. Verify: After clicking, the board renders with the track ready on Deck A

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/room/[code]/page.tsx
git commit -m "feat(web): integrate loading screen into room join flow"
```

---

## Summary

| Task | Description | Dependencies |
|------|-------------|-------------|
| 1 | Add cache fields to QueueItemSchema | None |
| 2 | Add TrackMetadataReportEvent schema | None |
| 3 | YouTube cache service | None |
| 4 | Stream endpoint cache check + write | Tasks 3 |
| 5 | Resolve cached URLs in snapshots | Tasks 1, 3 |
| 6 | TRACK_METADATA_REPORT handler | Tasks 2, 3 |
| 7 | DeckTransport uses cached URLs | Task 1 |
| 8 | useQueueAudioLoader uses cached URLs | Task 1 |
| 9 | Client sends TRACK_METADATA_REPORT | Tasks 2 |
| 10 | Auto-load sampler sounds on join | None |
| 11 | Loading screen component | None |
| 12 | Integrate loading screen into page | Tasks 10, 11 |

**Task groups (Groups B and C depend on Group A completing first):**
- Group A (schema): Tasks 1, 2 — must complete first
- Group B (server cache): Tasks 3, 4, 5, 6 — depends on Task 1
- Group C (client cache): Tasks 7, 8, 9 — depends on Tasks 1, 2
- Group D (sampler + loading): Tasks 10, 11, 12 — independent, can run in parallel with A
