# Multiplayer Onboarding & YouTube Audio Database

## Problem

When a new player joins a multiplayer room:

1. **YouTube audio must be independently re-extracted** for every client via yt-dlp — expensive, slow, and congests the 5-concurrent-stream limit
2. **Custom sampler sounds don't auto-load** — `SamplerPanel` only loads defaults on mount, ignoring the room's custom slots from the snapshot
3. **No loading state** — the board renders immediately after `ROOM_SNAPSHOT` but audio is still downloading in the background. The joiner sees controls they can't meaningfully use.

## Solution Overview

1. **YouTube Audio Database** — Permanently cache extracted YouTube audio + metadata in Supabase Storage. First extraction pays the yt-dlp cost; every subsequent request is a fast file serve.
2. **Enhanced ROOM_SNAPSHOT** — Resolve cached YouTube tracks to direct file URLs before sending to joiners. Cached tracks become indistinguishable from uploads.
3. **Loading Room Screen** — Full-screen overlay that blocks the board until deck tracks, sampler sounds, and audio engine are fully loaded.
4. **Auto-load sampler sounds on join** — Read `state.sampler.slots` from the snapshot and fetch custom sounds before the board appears.

## Design

### 1. YouTube Audio Database

A persistent cache of extracted YouTube audio + metadata, stored in Supabase Storage (same backend uploads already use).

**When a YouTube track is first extracted** (by whoever added it to a queue):

1. yt-dlp extracts m4a as today
2. After successful extraction, upload the m4a to Supabase Storage keyed by `yt-{videoId}.m4a`
3. Upload a sidecar `yt-{videoId}.meta.json` containing: `{ videoId, title, durationSec, bpm, waveform, thumbnailUrl, cachedAt }`
4. BPM + waveform are computed client-side as today — but the first client to compute them sends them to the server via a new `TRACK_METADATA_REPORT` event, which writes the sidecar

**On subsequent requests for the same videoId:**

- Server checks Supabase for `yt-{videoId}.m4a` — cache hit — serves the file directly (or returns a signed URL)
- No yt-dlp, no extraction, no ffmpeg

**Metadata flow:** When a cached track is added to a queue or loaded on a deck, the server includes pre-computed BPM and waveform — other clients skip analysis entirely.

### 2. ROOM_SNAPSHOT Enhancement

When the server builds a `ROOM_SNAPSHOT` for a new joiner, it resolves YouTube tracks to their cached URLs before sending.

**Current snapshot queue item:**

```
{ id, trackId, title, url: "https://.../api/youtube/stream/{videoId}", source: "youtube", youtubeVideoId }
```

**New snapshot queue item (when cached):**

```
{ id, trackId, title, url: "https://supabase.../yt-{videoId}.m4a", source: "youtube", youtubeVideoId, cached: true, bpm: 128, waveform: [480 floats, 0-1 normalized] }
```

**What the server does on JOIN_ROOM (and REJOIN_ROOM):**

1. For each queue item with `source: "youtube"`, check if `yt-{videoId}.m4a` exists in the cache
2. If cached: replace `url` with the direct Supabase file URL (fully qualified), set `cached: true`, attach `bpm` and `waveform` (as a JSON number array, 480 entries) from the metadata sidecar
3. If not cached: leave `url` as the current full URL to `/api/youtube/stream/{videoId}` — client falls back to existing yt-dlp flow

Sampler slots with `isCustom: true` also get their direct URLs resolved in the snapshot.

**Critical client-side changes required:** Currently, both `DeckTransport.tsx` and `useQueueAudioLoader.ts` bypass the queue item's `url` field for YouTube tracks — they reconstruct a stream URL from `youtubeVideoId` directly. For cached tracks to work, these code paths must be updated:

- When `cached: true` is set on a queue item, use `item.url` directly (it's a plain file URL, same as an upload)
- When `cached` is falsy, fall back to the existing `youtube:VIDEO_ID` / stream URL construction

This makes cached YouTube tracks use the same download path as uploaded tracks, while uncached tracks continue to work as today.

**Storage key convention:** YouTube cache files use `yt-{videoId}.m4a` and `yt-{videoId}.meta.json` keys in the same Supabase `"tracks"` bucket as uploads. This is an intentional departure from the content-addressed (SHA-256 hash) naming used for uploads, because YouTube video IDs are immutable identifiers — same videoId always means the same content. The `yt-` prefix prevents any collision with SHA-256 hash keys.

### 3. Loading Room Screen

A full-screen overlay that blocks the DJ board until all assets are loaded and the joiner is fully synced.

**When it appears:** After `ROOM_SNAPSHOT` is received, instead of immediately rendering the board.

**What it waits for:**

1. Deck A track audio (if a track is loaded) — download + decode
2. Deck B track audio (if a track is loaded) — download + decode
3. Custom sampler sounds (any slot where `isCustom: true`) — download + decode
4. Audio engine initialization (browser autoplay gate)
5. Clock sync (wait for a few `TIME_PING/PONG` samples so PLL starts clean)

**What it shows:**

- Room code + member count ("Joining ABCD1234 — 2 others in the room")
- Per-item progress: "Deck A: Downloading... 65%" / "Deck B: Ready" / "Sampler: Loading custom sounds..."
- Overall progress bar aggregating all items
- Once everything is ready: "Click to start" button (satisfies the browser autoplay gate — one interaction, two purposes)

**What it does NOT wait for:**

- Queue pre-loads (background tracks not currently on a deck) — these load after the board appears
- BPM/waveform analysis for uncached tracks — if metadata came from the database, it's instant. If not, analysis runs after board render.

**After the click:** Board renders with decks already synced. The PLL picks up from the first `BEACON_TICK` and the joiner hears audio in sync immediately.

### 4. Cache Write Flow

The cache gets populated as a side-effect of the existing flow — no new user action required.

**Step 1 — Audio caching (server-side):**

When `/api/youtube/stream/{videoId}` runs yt-dlp successfully, before streaming the file to the client:

1. Check if `yt-{videoId}.m4a` exists in Supabase
2. If not: upload the extracted m4a to Supabase (in parallel with streaming to client — no extra latency)
3. Stream the file to the client as usual

**Step 2 — Metadata caching (client to server):**

After a client finishes BPM detection + waveform generation for a YouTube track:

1. Client sends a new `TRACK_METADATA_REPORT` event with `{ videoId, bpm, waveform }`
2. Server writes/updates `yt-{videoId}.meta.json` in Supabase
3. Server updates in-memory cache so subsequent joiners get it immediately

**Why split it this way:**

- Audio caching is server-side because the server already has the extracted file
- Metadata is client-side because BPM detection and waveform generation run in the Web Audio API — moving them to Node would add heavy audio analysis dependencies

**Cache invalidation:** None needed. YouTube videoIds are immutable — same ID always means the same content.

### 5. Auto-loading Custom Sampler Sounds on Join

**The bug today:** `SamplerPanel` mounts, calls `loadDefaultSamples()`, ignores `state.sampler.slots` from the snapshot. Custom sounds only load when the user manually opens Sampler Settings.

**The fix:** After `ROOM_SNAPSHOT` is received, before the loading screen clears:

1. Read `state.sampler.slots` from the snapshot
2. For each slot where `isCustom: true` and `url` is present: fetch + decode the audio
3. Track this as part of the loading screen progress ("Sampler: Loading custom sounds...")
4. After join, `SAMPLER_SOUND_CHANGED` events continue to work as they do today for live changes

No changes needed to server-side sampler logic, `SamplerSettings.tsx`, or the `SAMPLER_SOUND_CHANGED` event handler. Purely a client-side fix.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cache storage | Supabase Storage (existing) | Already configured, handles uploads, 100GB on Pro plan (~15-30K songs) |
| Metadata persistence | JSON sidecar files alongside m4a in Supabase | No new infrastructure, survives server restarts |
| Snapshot URLs | Direct file URLs for cached tracks | Unifies YouTube and upload paths on the client |
| Loading screen scope | Deck tracks + sampler + clock sync | Decks and sampler are needed for meaningful interaction. Queue tracks load in background. |
| Cache miss behavior | Falls back to current yt-dlp extraction flow | First person to play a song pays the cost. Everyone after gets a cache hit. |
| BPM/waveform source | Client computes, reports to server for caching | Avoids adding audio analysis to Node backend |
| Cache invalidation | None | YouTube videoIds are immutable |

## New Events

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `TRACK_METADATA_REPORT` | Client to Server | `{ videoId, bpm, waveform }` | Client reports computed metadata for server to cache. This is a standalone event (like `TIME_PING`), NOT added to the `ClientMutationEventSchema` union, since it does not modify room state visible to other clients. |

## Modified Events

| Event | Change |
|-------|--------|
| `ROOM_SNAPSHOT` / `ROOM_REJOIN_SNAPSHOT` | Queue items for cached YouTube tracks get direct file URLs + optional `bpm` (number), `waveform` (number array, 480 entries, 0-1 normalized), and `cached` (boolean) fields. Sampler slots with `isCustom: true` get resolved URLs. All new fields are `.optional()` in the Zod schema for backward compatibility. |

## Files Likely Affected

**Server (apps/realtime):**
- `services/youtube.ts` — Add cache check before yt-dlp, upload to Supabase after extraction
- `http/api.ts` — `/api/youtube/stream/{videoId}` checks cache first
- `protocol/handlers.ts` — `handleJoinRoom` resolves cached URLs in snapshot
- `handlers/` — New handler for `TRACK_METADATA_REPORT`
- New: YouTube cache service (cache check, read, write operations)

**Shared (packages/shared):**
- `events.ts` — Add `TRACK_METADATA_REPORT` event schema
- `state.ts` — Optional `bpm`, `waveform`, `cached` fields on queue items in snapshot

**Frontend (apps/web):**
- `app/room/[code]/page.tsx` — Loading room screen (replaces immediate board render)
- `components/SamplerPanel.tsx` — Auto-load custom sounds from snapshot on mount
- `audio/useQueueAudioLoader.ts` — When `cached: true`, use `item.url` directly instead of constructing a stream URL from `youtubeVideoId`
- `components/DeckTransport.tsx` — When `cached: true`, use `item.url` directly instead of `youtube:VIDEO_ID` format; use pre-computed BPM/waveform from snapshot when available
- `realtime/client.ts` — Send `TRACK_METADATA_REPORT` after analysis completes
