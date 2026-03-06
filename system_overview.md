# puidBoard System Overview

This document explains how every major system in the puidBoard codebase works. It is written for engineers who need to understand, build on, debug, and make architectural decisions about the system. Where helpful, code examples are included to illustrate key patterns. The focus is on **how** things work and **why** they were designed that way.

---

## Table of Contents

1. [UI / Frontend Systems](#1-ui--frontend-systems)
2. [Core Audio Logic](#2-core-audio-logic)
3. [Song Upload and Playback](#3-song-upload-and-playback)
4. [Server Architecture](#4-server-architecture)
5. [Real-time Synchronization](#5-real-time-synchronization)
6. [Performance Pads and Sampler](#6-performance-pads-and-sampler)
7. [Deployment and Infrastructure](#7-deployment-and-infrastructure)
8. [Dead Code and Technical Debt](#8-dead-code-and-technical-debt)
9. [Key Architecture Decisions](#9-key-architecture-decisions)

---

## 1. UI / Frontend Systems

### 1.1 Project Structure

puidBoard is a monorepo managed with Turborepo and pnpm workspaces (`pnpm@9.15.0`, Node `>=20.0.0`). It has three packages:

| Package | Path | Purpose |
|---------|------|---------|
| `web` | `apps/web/` | Next.js 14 frontend (React 18, TypeScript) |
| `realtime` | `apps/realtime/` | Socket.IO server (Node.js, TypeScript, ESM) |
| `shared` | `packages/shared/` | Shared types, Zod schemas, event definitions |

The `shared` package is the contract between client and server. It defines every piece of state (via Zod schemas) and every event that can flow between them. Both `web` and `realtime` depend on it.

### 1.2 Fixed Canvas with CSS Scale Transform

The DJ board UI uses a **fixed-dimension canvas** approach rather than responsive CSS. The board is designed at exact pixel coordinates, then scaled to fit the viewport using a CSS `transform: scale(...)`.

**Why fixed canvas?** The DJ board is a precision interface with dozens of controls (knobs, faders, jog wheels, pads) positioned at exact coordinates relative to an SVG background image. Responsive layouts with percentage-based sizing would make it extremely difficult to line everything up pixel-perfectly. Instead, the board is built at a known resolution and scaled uniformly.

The key dimensions are defined in `DJBoard.tsx`:

```typescript
// apps/web/src/components/DJBoard.tsx
const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 600;
const QUEUE_WIDTH = 340;
```

Every control element is then positioned using absolute pixel coordinates within this space, extracted directly from the SVG source (`mixer-panel-background.svg`). For example:

```typescript
const DECK_A = {
  waveform: { x: 110, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 290, cy: 350, r: 150 },
  controls: { x: 430, y: 240, width: 160, height: 132 },
  performancePads: { x: 498, y: 390 },
};

const DECK_B = {
  waveform: { x: 998, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 1310, cy: 350, r: 150 },
  controls: { x: 1010, y: 240, width: 160, height: 132 },
  performancePads: { x: 1010, y: 390 },
};
```

The `useBoardScale` hook (`apps/web/src/hooks/useBoardScale.ts`) measures the browser viewport and calculates the optimal scale factor. The board and queue panel scale together as a single unit with `transformOrigin: "center center"`.

### 1.3 SVG Background as Layout Source of Truth

The board's background is an SVG image (`/assets/dj-controls/backgrounds/mixer-panel-background.svg`) that defines the visual layout of the DJ controller (deck plates, mixer section, fader slots, knob rings, decorative screws). All interactive components are positioned to overlay their corresponding visual elements in the SVG. This means the SVG is the **single source of truth** for where things appear. If the SVG changes, the coordinate constants in `DJBoard.tsx` must be updated to match.

### 1.4 DJBoard Component Architecture

`DJBoard.tsx` is the root component that assembles the entire interface. It renders:

- **DeckDisplay** (x2) -- LCD screen with waveform display, track info, time display; click-to-seek on the waveform
- **DeckControls** (x2) -- wraps `DeckTransport` which provides play/pause/cue buttons and BPM display
- **PositionedJogWheel** (x2) -- dual-zone jog wheels with vinyl scratch and pitch bend
- **MixerKnobs** -- 4 knobs: Master Volume, HI A (EQ high), HI B (EQ high), CUE (headphone mix, placeholder)
- **MixerFaders** -- wraps `FXControlPanel` which combines channel faders, FX controls, and BPM displays
- **CrossfaderSection** -- horizontal crossfader
- **TempoFader** (x2) -- vertical tempo sliders that map 0-1 fader position to 0.92-1.08 playback rate (plus/minus 8%)
- **SamplerPanel** -- 4-button horizontal sample trigger row
- **PerformancePadPanel** (x2) -- 2x2 performance pad grids per deck
- **QueuePanel** -- track queue with upload, YouTube search, and deck load buttons
- **SamplerSettings** -- modal for customizing sampler sounds (upload/record/preview)

Each component is visually independent but communicates through either:
1. **Audio hooks** (`useDeck`, `useMixer`) for local audio state
2. **RealtimeClient** for network state propagation via `sendEvent`

**Display components** (`apps/web/src/components/displays/`):
- `LCDScreen` -- styled container with accent-colored border glow
- `WaveformDisplay` -- renders 480-bucket waveform with playhead, hot cue marker
- `TrackInfoDisplay` -- track title, deck label, play state indicator
- `TimeDisplay` -- current time / duration in MM:SS format
- `DeckStatusDisplay` -- BPM, sync status, playback mode (currently unused in main board)
- `LoadingBar` -- YouTube track loading progress (extracting/downloading/decoding stages)
- `FXDisplay` -- FX type, wet/dry, parameter readout

### 1.5 Accent Colors and Visual Identity

Each deck has a distinct accent color used for glows, highlights, and UI elements:

```typescript
const accentA = "#3b82f6"; // Blue for Deck A
const accentB = "#8b5cf6"; // Purple for Deck B
```

### 1.6 Room Page and Autoplay Gate

The room page (`apps/web/src/app/room/[code]/page.tsx`) handles two modes:

1. **Mock mode** -- for development without a running server. Uses `MockRoomProvider`.
2. **Real-time mode** -- connects to the Socket.IO server via `useRealtimeRoom`.

A critical aspect is the **autoplay gate**: browsers block AudioContext creation until user interaction. The room page attaches a click handler on `document` that calls `initAudioEngine()` on the first user click. Until that happens, no audio can play. The listener self-removes after first successful initialization.

**Note:** An `AutoplayGate` component exists at `apps/web/src/components/AutoplayGate.tsx` but is **not imported anywhere** -- the room page handles autoplay inline.

### 1.7 Control Interaction System

`apps/web/src/audio/controlOptimizer.ts` provides shared infrastructure for all interactive controls (knobs, faders, jog wheel, crossfader):

- **`RAFManager`** -- singleton `requestAnimationFrame` loop. All controls subscribe to one shared RAF for batched visual updates (no jank from multiple independent RAF loops).
- **`useSharedRAF`** -- React hook to subscribe components to the shared RAF.
- **`useOptimizedControl`** -- manages three separate value streams:
  - *Visual state* -- RAF-smoothed for remote users (linear interpolation at 30% per frame)
  - *Local state* -- immediate, zero-latency for the local user
  - *Network state* -- throttled to ~30Hz (33ms minimum between sends)
- **`getCoalescedPointerEvents`** -- extracts coalesced pointer events for high-precision input tracking
- **`MomentumPhysics`** -- simple velocity + friction model for jog wheel momentum
- **`clamp`, `normalizeAngleDiff`** -- utility functions used by controls

This module is actively used by `Fader.tsx`, `Knob.tsx`, `JogWheel.tsx`, and `Crossfader.tsx`.

---

## 2. Core Audio Logic

### 2.1 Audio Engine Singleton

`apps/web/src/audio/engine.ts` manages a singleton `AudioContext` and master `GainNode`:

```typescript
let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

export async function initAudioEngine(): Promise<void> {
  if (audioContext) return;
  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(audioContext.destination);
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}
```

**Why a singleton?** The Web Audio API recommends a single `AudioContext` per page. Multiple contexts waste resources and can cause latency. Everything in the system -- decks, mixer, sampler, FX -- connects to this one context.

### 2.2 Deck Class

`apps/web/src/audio/deck.ts` defines the `Deck` class, which manages playback for a single deck.

**State model:**

```typescript
interface DeckState {
  deckId: "A" | "B";
  trackId: string | null;
  buffer: AudioBuffer | null;
  playState: "stopped" | "playing" | "paused" | "cued";
  playheadSec: number;        // position when paused/stopped
  startTime: number | null;   // AudioContext.currentTime when play began
  startOffset: number;        // track offset when play began
  cuePointSec: number;
  hotCuePointSec: number | null;  // hot cue for performance pad
  durationSec: number;
  gainNode: GainNode | null;
  source: AudioBufferSourceNode | null;
  playbackRate: number;
  isStreaming: boolean;        // false for buffered playback
  loading: LoadingState;       // YouTube loading stages
  analysis: {
    waveform: WaveformData | null;
    bpm: number | null;
    status: AnalysisStatus;
  };
}
```

**Track loading** uses a cache to avoid re-fetching and supports pre-loaded buffers from the queue:

```typescript
const trackCache = new Map<string, AudioBuffer>();

async loadTrack(trackId: string, url: string, preloadedBuffer?: AudioBuffer): Promise<void> {
  if (preloadedBuffer) {
    await this.loadPreloadedTrack(trackId, preloadedBuffer);
    return;
  }
  // Otherwise, fetch and decode (with caching)
  let buffer = trackCache.get(trackId);
  if (!buffer) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    buffer = await ctx.decodeAudioData(arrayBuffer);
    trackCache.set(trackId, buffer);
  }
  // Set up state, trigger analysis...
}
```

**Play/pause lifecycle:** Each `play()` call creates a **new** `AudioBufferSourceNode` (Web Audio requires this -- sources are single-use). The source is connected to a `GainNode` which routes through the mixer. A `requestAnimationFrame` loop updates the playhead position for UI display.

**Critical pattern -- pause before stop:** The `pause()` and `stop()` methods change state **before** calling `source.stop()`. This prevents the `onended` handler from interfering with the intended state.

**YouTube track loading:** The Deck has a `loadYouTubeTrack()` method that downloads audio through the server's streaming proxy, decodes it to an `AudioBuffer`, and stores it. Loading progress is tracked through `LoadingState` stages: `extracting` -> `downloading` -> `decoding` -> `analyzing` -> `idle`.

**Playback rate changes** must recalculate timing to keep the playhead accurate. When the rate changes mid-play, the deck snapshots the current position and resets the timing reference.

**Scrub** (used by vinyl mode on the jog wheel) moves the playhead by a delta and restarts the source at the new position. **Nudge** (used by pitch bend on the jog wheel) temporarily adjusts the playback rate without modifying the stored rate.

**Audio analysis** is triggered after track load. It runs waveform generation (synchronous, fast) followed by BPM detection (asynchronous, slower). An `analysisId` counter prevents stale results from overwriting if a new track is loaded before analysis completes.

### 2.3 Mixer Graph

`apps/web/src/audio/mixerGraph.ts` builds the full audio routing chain as a singleton graph of Web Audio nodes.

**Signal flow:**

```
Deck A -> InputGain -> EQ(Low) -> EQ(Mid) -> EQ(High) -> ChannelFader -> CrossfaderGainA -+
                                                                                          +-> PreMaster -> FX -> Analyser -> MasterGain -> Destination
Deck B -> InputGain -> EQ(Low) -> EQ(Mid) -> EQ(High) -> ChannelFader -> CrossfaderGainB -+
```

**3-Band EQ** uses three `BiquadFilterNode`s:

| Band | Type | Frequency | Q |
|------|------|-----------|---|
| Low | lowshelf | 320 Hz | 0.7 |
| Mid | peaking | 1000 Hz | 1.0 |
| High | highshelf | 3200 Hz | 0.7 |

Each band has plus/minus 12 dB range. The bipolar control value (-1 to 1) is mapped to dB via `bipolarToGain()` in `params.ts`.

**Equal-power crossfade** uses sine/cosine curves to maintain perceived volume:

```typescript
export function equalPowerCrossfade(position: number): { gainA: number; gainB: number } {
  const angle = position * (Math.PI / 2);
  return { gainA: Math.cos(angle), gainB: Math.sin(angle) };
}
```

**Clipping detection** runs in a `requestAnimationFrame` loop. It reads the peak sample from the analyser node and flags clipping when the peak exceeds 0.99.

**`getDeckInput(deckId)`** returns the `inputGain` node for the specified channel. This is what each `Deck` instance connects its `GainNode` to.

### 2.4 Audio Parameter Utilities

`apps/web/src/audio/params.ts` provides three smoothing modes for parameter changes:

- `setParamSmooth(param, value)` -- 20ms ramp, used for faders and knobs
- `setParamFast(param, value)` -- 5ms ramp, used for crossfader
- `setParamImmediate(param, value)` -- instant, used for initialization

These use `linearRampToValueAtTime` to avoid audio clicks from abrupt value changes.

### 2.5 BPM Detection

`apps/web/src/audio/analysis/bpmDetector.ts` implements client-side BPM detection using the industry-standard autocorrelation method.

**Pipeline:**

1. **Extract mono** -- mix stereo channels to a single Float32Array (first 30 seconds only)
2. **Low-pass filter** -- first-order IIR with alpha=0.1 (~350 Hz cutoff at 44.1 kHz) to isolate bass/kick drum frequencies
3. **Energy envelope** -- 50ms windows with 25ms hop (50% overlap), computing RMS energy per window
4. **Autocorrelation** -- correlate the normalized energy envelope with itself at different time lags

The lag range corresponds to 60-180 BPM. The algorithm then checks for **octave errors** (detecting 2x or 0.5x the actual tempo) by seeing if half-tempo or double-tempo candidates also have high correlation (>80% of the peak). When ambiguous, it prefers the tempo closest to 120 BPM.

The detected BPM is sent to the server via the `DECK_BPM_DETECTED` event and stored in `DeckState.detectedBpm`. The display BPM shown to users is `detectedBpm * playbackRate`.

### 2.6 Waveform Generation

`apps/web/src/audio/analysis/waveformGenerator.ts` divides the audio buffer into 480 buckets, computes the RMS amplitude of each bucket, and normalizes the result to 0-1. This runs synchronously after track load and feeds the waveform display component.

### 2.7 Jog Wheel

`apps/web/src/components/controls/JogWheel.tsx` implements a dual-zone jog wheel.

**Two zones, two behaviors:**

| Zone | Detection | Action |
|------|-----------|--------|
| Center (r < 0.65) | Pointer distance from center / radius | **Vinyl scratch** -- rotation maps to audio position change via `deck.scrub()` |
| Outer ring (r >= 0.65) | Pointer distance from center / radius | **Pitch bend** -- rotation speed maps to temporary rate change via `deck.nudge()` |

**Key configuration:**

```typescript
const JOG_CONFIG = {
  VINYL: { SECONDS_PER_ROTATION: 1.8, ZONE_RADIUS: 0.65 },
  PITCH_BEND: { MAX_BEND: 1.0, DEGREES_FOR_MAX_BEND: 15, RELEASE_DECAY: 0.15 },
  VISUAL: { VINYL_RPM: 33.33 },
  NETWORK: { THROTTLE_MS: 50 },
};
```

The jog wheel uses `requestAnimationFrame` for smooth visual animation and **pointer event coalescing** (`getCoalescedEvents` from `controlOptimizer.ts`) for precise input tracking. Network events (DECK_SEEK) are throttled to 50ms minimum intervals.

When playing, the jog wheel platter visually spins at 33.33 RPM to mimic a vinyl turntable. Touch interaction adds to or overrides this rotation.

### 2.8 FX System

`apps/web/src/audio/fx/manager.ts` manages FX processing as a singleton.

**Available effects:**

| FX Type | Implementation | File |
|---------|---------------|------|
| `echo` | `EchoFX` | `fx/echo.ts` |
| `reverb` | `ReverbFX` | `fx/reverb.ts` |
| `filter` | `FilterFX` | `fx/filter.ts` |
| `none` | (bypass) | -- |

The FX manager sits between the `preMaster` summing node and the `analyser` in the mixer graph. It maintains both a processor path and a bypass path:

```
preMaster -> [FXManager.input] -> processor -> [FXManager.output] -> analyser
                                  +-- bypass --+
```

Each effect exposes two parameters via the `FxState` schema: `wetDry` (0=dry, 1=wet) and `param` (effect-specific, 0-1). The effect can be enabled/disabled, which toggles between the processor and bypass paths.

**UI:** `FXControlPanel.tsx` renders the FX controls (type selector, enable toggle, wet/dry knob, parameter knob) alongside channel faders and BPM displays. `FXDisplay.tsx` shows the current FX state on an LCD.

---

## 3. Song Upload and Playback

### 3.1 Upload Flow

The upload process follows this sequence:

```
User selects file
    |
    v
POST /api/tracks/upload (multipart form: file + title + durationSec + mimeType + ownerId)
    |
    v
TrackService.upload() validates:
  - File size <= 50MB
  - MIME type in [audio/mpeg, audio/wav, audio/aiff, audio/flac, audio/ogg, audio/webm]
  - Duration <= 15 minutes
    |
    v
StorageService.upload() computes SHA256 hash and stores file
    |
    v
TrackStore.findByHash() checks for existing record (deduplication)
    |
    +-- (exists) -> return existing trackId + URL
    |
    +-- (new) -> TrackStore.create() + return new trackId + URL
```

The HTTP API is defined in `apps/realtime/src/http/api.ts` and uses `busboy` for multipart form parsing. MIME type is inferred from file headers first, falls back to form field, then falls back to filename extension inference.

### 3.2 Content-Addressed Storage

Files are stored using their **SHA256 hash** as the filename:

```typescript
const fileHash = createHash("sha256").update(buffer).digest("hex");
const ext = this.getExtensionFromMime(mimeType);
const storageKey = `${fileHash}${ext}`;
```

**Why content-addressed?** Two users uploading the same file get the same storage key, so the file is stored only once. This is automatic deduplication with zero configuration.

### 3.3 Storage Backends

`StorageService` (`apps/realtime/src/services/storage.ts`) supports two backends with automatic fallback:

| Backend | When | URL Strategy |
|---------|------|-------------|
| **Supabase Storage** | `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` env vars present | Signed URLs with expiration; falls back to local on failure |
| **Local filesystem** | Default (no Supabase config) or Supabase failure | `CDN_BASE_URL/{storageKey}` served by the HTTP server |

For local storage, files live in `.storage/tracks/` relative to the realtime app root. The HTTP server has a `GET /files/:storageKey` route that streams the file back with appropriate MIME type headers and 1-year cache headers.

The CDN base URL auto-detects Fly.io deployments: `https://{FLY_APP_NAME}.fly.dev/files` or falls back to `http://localhost:{PORT}/files`.

`SupabaseStorageService` (`apps/realtime/src/services/supabaseStorage.ts`) wraps `@supabase/supabase-js` for cloud storage with signed download URLs.

### 3.4 From Upload to Playback

After upload, a track enters the queue via the `QUEUE_ADD` event. When a user loads a track into a deck:

1. Client sends `DECK_LOAD` event with `trackId`, `deckId`, and `queueItemId`
2. Server updates `DeckState.loadedTrackId` and `loadedQueueItemId`, creates a new epoch, broadcasts
3. `DeckTransport` component on all clients receives the state change
4. `DeckTransport` calls `deck.loadTrack(trackId, url, preloadedBuffer)` which fetches the audio, decodes it, caches the buffer, and triggers analysis (waveform + BPM)
5. The deck is now ready for play/pause/cue

### 3.5 YouTube Search and Queue Pre-Loading

Users can search for and add YouTube tracks directly from the UI.

**UI Component:** `apps/web/src/components/YouTubeSearch.tsx` provides:
- Search input with debounced queries
- Up to 15 results displayed with thumbnails, titles, channel names, and durations
- One-click "Add to Queue" functionality

**Backend Services:**

| Component | File | Purpose |
|-----------|------|---------|
| `searchYouTube(query)` | `services/youtube.ts` | Search via YouTube Data API v3, returns up to 15 video results (30-1200s duration, music category) |
| `getYouTubeAudioUrl(videoId)` | `services/youtube.ts` | Extract direct audio URL using yt-dlp (`youtube-dl-exec`), returns best quality m4a/webm audio |
| `getYouTubeCookiesPath()` | `services/youtube-cookies.ts` | Fetch fresh YouTube cookies from remote API to bypass datacenter IP blocking |
| `/api/youtube/stream/:videoId` | `http/api.ts` | Streaming proxy that forwards YouTube audio with CORS headers |
| `/api/youtube/search?q=...` | `http/api.ts` | Search endpoint wrapping `searchYouTube()` |
| `/api/youtube/status` | `http/api.ts` | YouTube service health check |

**Architecture: Queue Pre-Loading + Buffered Decode**

```
Client searches YouTube (server-side YouTube Data API v3)
    |
    v
QueueItem created with source: "youtube", youtubeVideoId: "xxx"
    |
    v
useQueueAudioLoader hook detects new YouTube track in queue
    |
    v
Backend: yt-dlp extracts direct Google Video URL (m4a/webm format)
    |
    v
Backend: Streaming proxy forwards audio with CORS headers
    |
    v
Client: Downloads entire audio file via streaming proxy (with progress tracking)
    |
    v
Client: Decodes to AudioBuffer using Web Audio API decodeAudioData()
    |
    v
Client: Stores AudioBuffer in QueueItem.audioBuffer
    |
    v
Queue UI enables Deck A/B buttons (loading complete)
    |
    v
User loads to deck -> Deck uses pre-loaded AudioBuffer (instant)
```

**Why Buffered Download Instead of Streaming?**

- Full BPM detection -- autocorrelation analysis requires full AudioBuffer
- Waveform generation -- RMS waveform requires complete audio data
- Perfect seeking -- AudioBufferSourceNode allows instant seeking
- All DJ controls work -- pitch bend, scratching, loops, hot cues, tempo shifts
- Multiplayer works -- server syncs state, clients play independently
- Identical to uploads -- YouTube tracks and uploaded tracks use the same Deck playback code

**Cookie Authentication for yt-dlp:**

`apps/realtime/src/services/youtube-cookies.ts` provides cookie management:
- Fetches fresh cookies from a remote API (`yt-cookies` compatible) with 6-hour refresh interval
- Falls back to static cookies from `YOUTUBE_COOKIES_PATH` env var
- Falls back to cached cookies file on API failure
- Server startup also writes cookies from `YOUTUBE_COOKIES` env var (for Fly.io secrets deployment)

**QueueItem Schema Extension:** YouTube tracks extend the base QueueItem:

```typescript
interface QueueItem {
  // ... base fields (id, trackId, title, durationSec, url, addedBy, status)
  source: "upload" | "youtube";
  youtubeVideoId?: string;
  thumbnailUrl?: string;
  loading?: LoadingState;      // client-side only
  audioBuffer?: AudioBuffer;   // client-side only, for pre-loaded YouTube tracks
}
```

---

## 4. Server Architecture

### 4.1 Server Structure

`apps/realtime/src/server.ts` sets up an HTTP server with three layers:

1. **Health check** -- `GET /health` returns status, version, room/client counts, persistence stats
2. **HTTP API** -- track/sampler/YouTube endpoints (see Section 3 and 6)
3. **Socket.IO** -- real-time event handling for rooms

Socket.IO is configured with both WebSocket and long-polling transports. CORS origins are parsed from the `CORS_ORIGINS` environment variable (comma-separated), with automatic expansion to include both `www` and non-`www` versions of each origin.

**Server startup sequence:**
1. Load env from `.env.local`
2. Initialize persistence (Redis or in-memory)
3. Write YouTube cookies from env if available
4. Start HTTP server on `0.0.0.0:{PORT}` (default 3001)

### 4.2 HTTP API Endpoints

All endpoints are defined in `apps/realtime/src/http/api.ts`:

**Track endpoints:**
- `POST /api/tracks/upload` -- upload a track (multipart form)
- `GET /api/tracks/:id` -- get track metadata
- `GET /api/tracks/:id/url` -- get track CDN URL
- `GET /api/tracks/sample-pack` -- list sample pack tracks
- `GET /files/:storageKey` -- serve track file (with 1-year cache)
- `HEAD /files/:storageKey` -- check file exists

**Sampler sound endpoints:**
- `POST /api/sampler/upload` -- upload a custom sampler sound
- `GET /api/sampler/sounds?clientId=X&roomId=Y` -- list custom sounds for client/room
- `DELETE /api/sampler/sounds/:id` -- delete a custom sound
- `POST /api/sampler/reset` -- reset slot to default (body: `{clientId, roomId, slot}`)

**YouTube endpoints:**
- `GET /api/youtube/search?q=...&limit=15` -- search YouTube
- `GET /api/youtube/stream/:videoId` -- streaming audio proxy
- `GET /api/youtube/status` -- YouTube service health check
- `GET /api/health` -- detailed service health check with feature flags

### 4.3 Room Store (In-Memory State)

`apps/realtime/src/rooms/store.ts` is a singleton `RoomStore` that holds all room state in memory:

```typescript
class RoomStore {
  private rooms: Map<string, RoomState>;          // roomId -> state
  private roomCodeIndex: Map<string, string>;     // roomCode -> roomId
  private clients: Map<string, ClientInfo>;       // clientId -> info
  private clientSocketIndex: Map<string, string>; // socketId -> clientId
}
```

**Room codes** are 6-character strings generated with a character set that avoids visually confusing characters (no 0/O, 1/I/L).

**Room lifecycle:**

- `createRoom()` -- generates room code, creates `RoomState` with factory defaults, assigns the creator as host with a unique color
- `joinRoom()` -- adds member with a unique color from a predefined palette, increments version
- `leaveRoom()` -- removes member, transfers host to next member if needed, deletes room if empty, cleans up control ownership for the departing client

### 4.4 Room Persistence

`apps/realtime/src/rooms/persistence.ts` provides snapshot-based persistence for reconnect resilience:

- **PersistenceManager** saves periodic snapshots (default every 10s) of room state + idempotency state
- Supports **Redis** (traditional `redis://` URL), **Upstash Redis** (REST API), or **in-memory** fallback
- Snapshots have a configurable TTL (default 1 hour)
- On Redis failure, automatically falls back to in-memory backup
- Initialized on server startup via `initPersistence()`

### 4.5 Authoritative Server Model

All state mutations flow through the server. The pattern is:

1. Client sends a mutation event (e.g., `DECK_PLAY`, `MIXER_SET`, `QUEUE_ADD`)
2. Server validates the event using Zod schemas from `@puid-board/shared`
3. Server rate-limits the request (100 deck actions per minute per client)
4. Server applies the mutation to the authoritative `RoomState`
5. Server broadcasts the change to all room members
6. Clients apply the received state optimistically

### 4.6 Control Ownership

To prevent two users from simultaneously adjusting the same knob or fader, the system uses a **control ownership** model:

```typescript
interface ControlOwnership {
  clientId: string;
  acquiredAt: number;    // server timestamp
  lastMovedAt: number;   // server timestamp
}
```

Control IDs follow dot notation: `"crossfader"`, `"channelA.eq.high"`, `"deckA.jog"`, `"deckA.tempo"`, `"masterVolume"`, etc. The full list is defined in `packages/shared/src/controlIds.ts`.

Ownership has a **2-second TTL** (`CONTROL_OWNERSHIP_TTL_MS = 2000`). If no `MIXER_SET` event refreshes the ownership within that window, the control becomes available for others.

`CONTROL_RELEASE` explicitly relinquishes ownership. When a client disconnects, the server cleans up all their owned controls.

### 4.7 Event Categories

Events are split into two categories defined in `packages/shared/src/events.ts`:

| Category | Examples | Characteristics |
|----------|----------|----------------|
| **Continuous** | `CURSOR_MOVE`, `MIXER_SET` | High frequency, can be coalesced, last-writer-wins |
| **Discrete** | `DECK_PLAY`, `QUEUE_ADD`, `FX_TOGGLE`, `CONTROL_GRAB` | Each event matters, must be processed in order |

### 4.8 Rate Limiting and Validation

`apps/realtime/src/security/` provides:

- **Rate limiter** (`limits.ts`) -- per-client, per-action-type token bucket. Deck actions are limited to 100/minute.
- **Bounds validation** (`validate.ts`) -- `validateSeekPosition()` checks against track duration. Control values are checked against their defined ranges (e.g., gain/EQ: -1 to 1, faders: 0 to 1).
- **Schema validation** -- every incoming event is parsed with its Zod schema before processing. Invalid payloads are silently dropped.

### 4.9 Idempotency

`apps/realtime/src/protocol/idempotency.ts` tracks client sequence numbers to deduplicate events during reconnection. Each client's last-processed `clientSeq` is stored, and events with `clientSeq <= lastProcessed` are rejected.

### 4.10 Protocol Handlers

`apps/realtime/src/protocol/handlers.ts` registers all Socket.IO event handlers for a connected socket. Individual handler files:

- `handlers/deck.ts` -- DECK_LOAD, DECK_PLAY, DECK_PAUSE, DECK_CUE, DECK_SEEK, DECK_TEMPO_SET, DECK_BPM_DETECTED
- `handlers/queue.ts` -- QUEUE_ADD, QUEUE_REMOVE, QUEUE_REORDER, QUEUE_EDIT
- `handlers/controls.ts` -- CONTROL_GRAB, CONTROL_RELEASE, MIXER_SET
- `handlers/cursor.ts` -- CURSOR_MOVE
- `handlers/fx.ts` -- FX_SET, FX_TOGGLE
- `handlers/time.ts` -- TIME_PING / TIME_PONG
- `protocol/ack.ts` -- EVENT_ACK handling

### 4.11 BEACON_TICK Timer

`apps/realtime/src/timers/beacon.ts` runs a 250ms interval timer per room. Each tick:

1. Increments `epochSeq` for any playing deck
2. Calculates the current playhead from epoch fields:
   ```typescript
   const elapsedMs = serverTs - deck.epochStartTimeMs;
   const playhead = deck.epochStartPlayheadSec + (elapsedMs / 1000) * deck.playbackRate;
   ```
3. Broadcasts `BEACON_TICK` with payloads for both decks

This is the **primary sync mechanism**.

### 4.12 Legacy SYNC_TICK (Removed)

The old `syncTick.ts` timer (2-second intervals, `serverStartTime`-based playhead) has been removed. All sync now goes through BEACON_TICK exclusively. The removal was done on branch `chore/remove-dead-code` along with the deprecated `drift.ts` module and other dead code.

---

## 5. Real-time Synchronization

### 5.1 The Epoch Model

An **epoch** represents a continuous, uninterrupted period of playback at a fixed rate from a known starting point. Any discontinuity creates a new epoch:

- Play, pause, stop
- Seek
- Tempo change
- Cue
- Track load

Each epoch is identified by a random UUID (`epochId`) and has:

```typescript
epochId: string,                  // UUID, changes on discontinuity
epochSeq: number,                 // incremented each beacon tick
epochStartPlayheadSec: number,    // playhead when epoch began
epochStartTimeMs: number,         // server timestamp when epoch began
```

**Why epochs?** Without epochs, a client receiving a sync message has no way to know if it came from before or after a seek. Epoch IDs let clients detect when a discontinuity happened and do a hard reset instead of trying to smoothly correct.

**Tempo change special case:** When the tempo changes, the server must recalculate the playhead using the **old** rate before creating the new epoch with the **new** rate.

### 5.2 Clock Synchronization (TIME_PING / TIME_PONG)

`apps/web/src/audio/sync/clock.ts` implements NTP-style clock synchronization.

**Protocol:**

1. Client sends `TIME_PING` with `t0 = Date.now()` every 2 seconds
2. Server responds with `TIME_PONG` containing `t0` and `serverTs`
3. Client calculates RTT and clock offset

**Noise rejection:**
- RTT spikes (>2.5x the current average) are rejected entirely
- Samples older than 60 seconds are discarded
- The last 7 samples are kept
- Weighted averaging (lower RTT = higher weight)

The clock is considered "reliable" after 5 samples. `getServerTime()` returns `Date.now() + averageOffsetMs`.

### 5.3 DeckEngine -- The Single Writer

`apps/web/src/audio/DeckEngine.ts` is the central coordinator for deck transport state on each client. It implements the **single writer rule**: only DeckEngine modifies transport state.

**Beacon processing (`applyServerBeacon`):**

```
Receive BEACON_TICK
    |
    +-- Is epochSeq <= lastBeaconEpochSeq? -> Discard (stale)
    |
    +-- Is epochId different from current? -> handleEpochChange() (hard reset)
    |
    +-- Same epoch -> applyPLLCorrection() (smooth adjustment)
```

**Epoch change (hard reset):** Full state replacement. The PLL is reset, and the local `Deck` is synced to the new state.

**Local actions (`applyLocalAction`):** For user-initiated actions, DeckEngine applies the change **optimistically** to the local `Deck` immediately. The next beacon from the server will confirm and fine-tune.

### 5.4 Phase-Locked Loop (PLL) Drift Correction

`apps/web/src/audio/sync/pll.ts` implements smooth drift correction.

**Algorithm:**

1. **Measure drift** with latency compensation
2. **Median filter** -- 5-sample window to reject noise
3. **Apply correction based on drift magnitude:**

   | Drift Range | Action |
   |-------------|--------|
   | < 10ms | Ignore (within tolerance) |
   | 10ms - 500ms | Proportional correction: `correction = -drift * 0.001` |
   | > 500ms | Hard snap to expected position + PLL reset |

4. **Proportional gain** is 0.001, clamped to plus/minus 2%
5. **Apply effective rate** directly to `AudioBufferSourceNode.playbackRate.value`

### 5.5 DeckTransport -- Bridge Between Server and Audio

`apps/web/src/components/DeckTransport.tsx` is a React component that serves as both:
1. **Sync bridge** -- routes server state to local `Deck` and `DeckEngine`
2. **Transport UI** -- renders play/pause/cue buttons, BPM display, loading bar

**Key behaviors:**
- Watches server state changes for track loading, play state, BPM
- Checks for pre-loaded `AudioBuffer` in queue items (from `useQueueAudioLoader`)
- Routes `BEACON_TICK` payloads to `DeckEngine`
- **`justLoadedRef` guard:** 500ms window where auto-play is suppressed after track load
- **BPM display:** Prefers locally-detected BPM, falls back to server-propagated BPM

---

## 6. Performance Pads and Sampler

### 6.1 Performance Pad Panel

`apps/web/src/components/PerformancePadPanel.tsx` renders a 2x2 grid of pads per deck using `PerformancePadButton.tsx`.

| Pad | Function | Color | Click | Hold | Release |
|-----|----------|-------|-------|------|---------|
| 1 | Hot Cue | Red (#FF3B3B) | Jump to cue (or set if unset) | Override/re-set at current position | -- |
| 2 | Loop | Orange (#FF9F1C) | Toggle loop on/off | Cycle loop length: 1, 2, 4, 8 bars | -- |
| 3 | Roll | Blue (#3B82F6) | -- (hold-based only) | Start momentary roll, save return position | Stop roll, snap back to saved position |
| 4 | Jump | Purple (#8B5CF6) | Jump back 1 beat | Jump forward 1 bar (4 beats) | -- |

**Keyboard bindings:**
- Deck A: `1`, `2`, `3`, `4`
- Deck B: `7`, `8`, `9`, `0`

**Note:** Loop and Roll are currently placeholder implementations (marked with TODO comments). Hot Cue and Jump are fully functional.

### 6.2 Sampler System

The sampler is a separate audio system that plays short samples **directly to the master gain**, bypassing the mixer chain entirely.

**Architecture:**

```
SamplerPanel -> playSample(slot) -> AudioBufferSourceNode -> GainNode(0.8) -> MasterGain -> Destination
```

**Sample slots:** 4 slots (0-3), each with a default sample:

| Slot | Default | Keybind |
|------|---------|---------|
| 0 | Airhorn | R |
| 1 | Horse Neigh | T |
| 2 | Gunshot | Y |
| 3 | Explosion | U |

Samples are loaded from `/assets/audio/samples/*.mp3`. If loading fails, each slot falls back to an **oscillator-based tone** with distinct frequency and waveform.

**Custom samples:** The API supports `loadCustomSample(slot, url, name)` and `resetSlotToDefault(slot)`. Changes are notified via `onSampleChange(listener)`.

**Server-side sampler API** (`apps/realtime/src/services/samplerSounds.ts` and `apps/realtime/src/db/samplerSoundStore.ts`):
- Upload custom sampler sounds (per client, per room, per slot)
- List/delete sounds
- Reset slot to default

### 6.3 Sampler Components

- `SamplerPanel.tsx` -- renders 4 `SamplerButton` components in a horizontal row. All buttons use orange color (#FF8C3B). Some buttons have SVG icons (`airhorn.svg`, `gunshot.svg`).
- `SamplerButton.tsx` -- individual pad button with keybind display, press animation, optional icon overlay.
- `SamplerSettings.tsx` -- modal dialog for managing sampler sounds (upload custom samples, record from microphone, preview, reset to default). Accessible via gear button in the queue panel area.

---

## 7. Deployment and Infrastructure

### 7.1 Docker

`apps/realtime/Dockerfile` builds a production image:
- Base: `node:20-alpine` with `python3`, `ffmpeg`, `yt-dlp` installed
- Multi-stage build: deps stage + runner stage
- Pre-built TypeScript artifacts are copied in (build locally first)
- Storage directories created at `/app/apps/realtime/.storage/tracks` and `/app/.storage`

### 7.2 Fly.io

Both apps have `fly.toml` configs for deployment to Fly.io:
- `apps/realtime/fly.toml` -- realtime server
- `apps/web/fly.toml` -- Next.js frontend

The server auto-detects Fly.io via `FLY_APP_NAME` env var for CDN URL generation.

GitHub Actions (`.github/workflows/`) automate deployment on push to main.

### 7.3 Environment Variables

**Realtime server:**
- `PORT` (default: 3001)
- `CORS_ORIGINS` -- comma-separated allowed origins
- `YOUTUBE_API_KEY` -- YouTube Data API v3 key
- `YOUTUBE_COOKIES` -- cookie content for yt-dlp (written to disk on startup)
- `YOUTUBE_COOKIES_PATH` -- path to static cookie file
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` -- Supabase storage
- `REDIS_URL` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` -- Redis persistence
- `STORAGE_DIR` -- override storage directory
- `CDN_BASE_URL` -- override CDN URL
- `SNAPSHOT_INTERVAL_MS`, `SNAPSHOT_TTL_MS` -- persistence tuning

**Web frontend:**
- `NEXT_PUBLIC_REALTIME_URL` -- URL of the realtime server

---

## 8. Dead Code and Technical Debt

### 8.1 Dead Files (not imported anywhere)

| File | Status | Notes |
|------|--------|-------|
| `apps/web/src/audio/youtubePlayer.ts` | **DEAD** | YouTube IFrame Player API wrapper. Was an attempt at client-side YouTube playback. Never imported (only referenced in `.bak` files). The system uses server-side yt-dlp + streaming proxy instead. |
| `apps/web/src/audio/deck.ts.bak` | **DEAD** | Backup of old deck implementation. Should be deleted. |
| `apps/web/src/audio/deck.ts.bak2` | **DEAD** | Another backup. Should be deleted. |
| `apps/web/src/components/AutoplayGate.tsx` | **DEAD** | Component exists but is never imported. The room page handles autoplay inline via a `useEffect` + click listener. |
| `apps/web/src/components/FXStrip.tsx` | **DEAD** | Never imported. FX controls are handled by `FXControlPanel.tsx` instead. |
| `apps/web/src/components/controls/EQControl.tsx` | **UNUSED** | Exported from `controls/index.ts` but never imported by any other component. The DJ board uses individual `Knob` components for EQ instead. |
| `apps/web/src/components/ClippingIndicator.tsx` | **DEAD** | Import is commented out in `DJBoard.tsx` with `// TODO: add clipping indicator later`. |
| `apps/web/src/components/displays/DeckStatusDisplay.tsx` | **UNUSED** | Exported from `displays/index.ts` but never imported by any component. |

### 8.2 Deprecated Code (Being Removed)

The `chore/remove-dead-code` branch removes the following deprecated code:

| File/Export | Status | Notes |
|-------------|--------|-------|
| `apps/realtime/src/timers/syncTick.ts` | **REMOVED** | Old 2-second sync timer. All sync now goes through BEACON_TICK (250ms). |
| `apps/web/src/audio/sync/drift.ts` | **REMOVED** | Legacy drift correction module. Was all no-ops. PLL in `DeckEngine` handles drift now. |
| `DeckState.serverStartTime` | **TO REMOVE** | Marked `@deprecated` in state schema ("Use epochStartTimeMs instead"). Still present in schema but no longer used by any timer. Should be removed from the shared schema. |

### 8.3 Untracked/Temporary Files in Git

From `git status`, these files are untracked and likely should be in `.gitignore` or deleted:

- `YOUTUBE_API_ANALYSIS.md`, `YOUTUBE_BACKEND_INTEGRATION.md`, `YOUTUBE_COOKIES_SETUP.md`, etc. -- temporary analysis/documentation files
- `apps/web/.env.local.bak` -- backup env file
- `test-youtube-apis.js`, `upload-cookies.sh`, `youtube-cookies.txt` -- development scripts
- `sounds/` -- unknown directory
- `system_overview.md.backup` -- backup of this file

### 8.4 Comment-Noted TODOs

- `DJBoard.tsx:15` -- `// import ClippingIndicator from "./ClippingIndicator"; // TODO: add clipping indicator later`
- `PerformancePadPanel.tsx` -- Loop and Roll pad functions are placeholder implementations
- Headphone cue mix knob in `MixerKnobs` is rendered but not wired to any audio functionality (hardcoded `value={0.5}`)

---

## 9. Key Architecture Decisions

### 9.1 Server-Authoritative State

**Decision:** All mutations flow through the server. Clients apply changes optimistically but the server's `BEACON_TICK` is the final authority.

**Why:** In a multi-user DJ session, conflicting operations must resolve deterministically. Server authority ensures all clients converge to the same state.

**Tradeoff:** Added latency for actions (round-trip to server). Mitigated by optimistic local updates.

### 9.2 Epoch-Based Sync over Continuous Timestamp Sync

**Decision:** Use epochs (UUID + sequence number + start position + start time) instead of continuously broadcasting absolute positions.

**Why:** With continuous timestamps, every seek or tempo change creates a discontinuity that confuses drift correction. Epochs explicitly mark discontinuities, letting the system do a clean hard reset.

### 9.3 PLL over Hard Snap

**Decision:** Use a proportional-gain PLL with median filtering for drift correction.

**Why:** Hard snaps cause audible clicks and glitches. The PLL makes corrections invisible by adjusting playback rate by at most 2%.

### 9.4 Fixed Canvas + CSS Scale

**Decision:** Design the UI at a fixed resolution (1600x600) and use CSS `transform: scale()`.

**Why:** 50+ precisely positioned controls must align with the SVG background. Fixed coordinates are simple and trivially debuggable.

### 9.5 Content-Addressed Storage

**Decision:** Use SHA256 hash of file contents as the storage key.

**Why:** Automatic deduplication with zero additional logic.

### 9.6 Sampler Bypasses Mixer

**Decision:** Sampler output goes directly to master gain, not through the per-channel mixer chain.

**Why:** Samples are performance elements that should always be audible regardless of crossfader/fader position. Standard behavior in real DJ hardware.

### 9.7 Shared Package as Contract

**Decision:** All types, schemas, and event definitions live in `@puid-board/shared`.

**Why:** Type safety across the network boundary. Schema changes are compile-time errors in both packages.

### 9.8 Single Writer Rule for Transport State

**Decision:** Only `DeckEngine` modifies deck transport state.

**Why:** Multiple code paths modifying transport state would create race conditions. One writer = one place to reason about state transitions.

### 9.9 In-Memory Room State with Optional Persistence

**Decision:** Room state is held entirely in memory on the server, with optional Redis snapshots for reconnect resilience.

**Why:** Latency. Every mixer knob adjustment touches room state. In-memory access is nanoseconds vs. milliseconds for a database. Redis snapshots provide crash recovery without runtime overhead.

### 9.10 Zod for Runtime Validation

**Decision:** Use Zod schemas for both TypeScript types (compile-time) and event validation (runtime).

**Why:** Single schema definition gives both TypeScript type (via `z.infer<>`) and runtime validator (via `.safeParse()`). Eliminates drift between types and validation.

### 9.11 Buffered Download for YouTube

**Decision:** Download and decode entire YouTube audio to an AudioBuffer instead of streaming.

**Why:** Streaming via MediaElementAudioSourceNode doesn't provide the decoded buffer required for BPM detection (autocorrelation) and waveform generation. By downloading completely, YouTube tracks get identical functionality to uploaded tracks.

---

## 10. Architecture Analysis

### 10.1 Comparison to Game Networking Patterns

puidBoard's realtime system maps closely to the authoritative server model used by multiplayer games (Fortnite, Valorant, Figma, etc.). Here is how each standard game networking concept applies:

| Game Networking Concept | puidBoard Equivalent | Notes |
|---|---|---|
| **Authoritative server** | RoomStore is single source of truth | All mutations validated + applied server-side |
| **Tick rate** | Beacon at 250ms (4 Hz) | Games use 30-128 Hz, but audio playhead is deterministic between ticks |
| **Client sends inputs, server sends state** | Client sends mutation events, server broadcasts `ServerMutationEvent` + `BEACON_TICK` | Same pattern |
| **World snapshot on connect** | `ROOM_SNAPSHOT` sent on CREATE/JOIN | Full state transfer |
| **Client-side prediction** | Mixer controls apply locally, confirmed by server broadcast | Lightweight — deck transport does NOT predict (waits for server) |
| **Server reconciliation** | `applyServerEvent()` overwrites local state | Server broadcast is authority |
| **Snapshot interpolation** | DeckEngine PLL smooths between 250ms beacon ticks | Same concept, audio domain |
| **Deterministic simulation** | Epoch model: `playhead = epochStart + elapsed * rate` | Clients calculate exact playhead independently between beacons |
| **Clock sync** | `TIME_PING`/`TIME_PONG` with NTP-style offset estimation | 7-sample window, RTT spike rejection, weighted averaging |
| **Interest management** | Socket.IO rooms — clients only receive events for their room | Rooms ARE the spatial partitions |
| **Input deduplication** | Per-client `clientSeq` + rolling event window | Protects against retries and reconnection |
| **Lag compensation / server rewind** | Not needed | No "did this hit?" questions — audio playback is continuous, not collision-based |

**Key architectural difference from games:** Games have continuous physics that must be simulated server-side every tick. puidBoard's "physics" (audio playback) is mathematically deterministic — once the server sets an epoch, every client can independently calculate the exact playhead at any moment. This is why 4 Hz ticks work instead of 60-128 Hz.

### 10.2 What the Architecture Gets Right

1. **Server-authoritative model** — prevents divergent state, cheating, race conditions
2. **Epoch-based deterministic playback** — eliminates accumulated drift, handles discontinuities cleanly
3. **PLL over hard snap** — corrections are inaudible (max 2% rate adjustment vs. audible clicks from hard snaps)
4. **Idempotent event processing** — protects against network retries without extra client logic
5. **Soft control locking with TTL** — prevents conflicting edits without deadlocks
6. **Zod schemas as shared contract** — type safety across the network boundary, compile-time + runtime validation

### 10.3 Known Scaling Boundaries

These are NOT problems today but define where the architecture would need changes:

| Boundary | Current State | When It Matters |
|---|---|---|
| **Single-server rooms** | All room state in one Node process's memory | If you need multiple server instances (>1000 concurrent rooms), rooms can't span servers. Would need sticky sessions or distributed state. |
| **Socket.IO overhead** | Convenient, battle-tested, but adds framing/encoding overhead | At very high scale (>10K connections per instance), raw WebSockets or uWebSockets would reduce overhead. Not relevant now. |
| **Beacon interval (250ms)** | Fine for play/pause/seek sync | For tighter scratch sync or beat-grid matching, 100ms would improve PLL convergence. Easy constant change. |
| **Snapshot persistence (10s)** | Up to 10s of state loss on crash | Acceptable for ephemeral rooms. Event sourcing would give zero loss but adds massive complexity. Not worth it. |
| **Reconnection gap** | Client gets fresh `ROOM_SNAPSHOT` on reconnect | Misses events from last 0-10s window. The snapshot has current state so this is fine — playback position and mixer state are all captured. |

### 10.4 Sampler Sync Gap

The sampler currently fires audio **locally only** — `playSample(slot)` plays directly to the master gain with no server event. This means:

- User A triggers airhorn — only User A hears it
- No `SAMPLER_PLAY` event exists in the protocol
- This is a deliberate simplification but worth noting as a feature gap

Adding sampler sync would require a new event type and careful latency handling (samples are short, so network delay would make them feel late on remote clients).

---

## Appendix: File Reference

### packages/shared/src/

| File | Description |
|------|-------------|
| `state.ts` | All state schemas (RoomState, DeckState, MixerState, QueueItem, etc.) + factory functions |
| `events.ts` | All event schemas (client mutations, server broadcasts, BEACON_TICK) |
| `controlIds.ts` | Control ID constants, grouped IDs, ownership TTL (2000ms) |
| `validators.ts` | Bounds checking, control validation, event classification utilities |
| `index.ts` | Barrel export of all schemas, types, validators, constants. Exports `VERSION = "0.1.0"` |

### apps/web/src/audio/

| File | Description |
|------|-------------|
| `engine.ts` | AudioContext singleton + master GainNode |
| `deck.ts` | Deck class (per-deck playback, track loading, YouTube loading, analysis) |
| `DeckEngine.ts` | Single writer for transport state, epoch + PLL sync |
| `mixerGraph.ts` | Full mixer audio graph (EQ, faders, crossfade, FX routing) |
| `params.ts` | Audio parameter smoothing utilities + `equalPowerCrossfade()` + `bipolarToGain()` |
| `sampler.ts` | Sampler engine (sample loading, playback, oscillator fallback, custom samples) |
| `useDeck.ts` | React hook for deck state + control methods |
| `useMixer.ts` | React hook for mixer state sync to audio graph |
| `useQueueAudioLoader.ts` | React hook for queue-level YouTube pre-loading |
| `controlOptimizer.ts` | RAF manager, optimized control hooks, pointer coalescing, momentum physics |
| `index.ts` | Barrel exports (does NOT export sampler, sync, analysis, controlOptimizer, or youtubePlayer) |
| `youtubePlayer.ts` | **DEAD CODE** -- YouTube IFrame API wrapper, never imported. Should be deleted. |

### apps/web/src/audio/sync/

| File | Description |
|------|-------------|
| `pll.ts` | PLL drift correction controller (active, used by DeckEngine) |
| `clock.ts` | TIME_PING/PONG clock synchronization (active) |
| `drift.ts` | **REMOVED** -- Legacy drift correction, was all no-ops. Deleted on `chore/remove-dead-code` branch |
| `index.ts` | Barrel re-exports from clock.ts and drift.ts |

### apps/web/src/audio/analysis/

| File | Description |
|------|-------------|
| `bpmDetector.ts` | Autocorrelation-based BPM detection |
| `waveformGenerator.ts` | RMS waveform generation (480 buckets) |

### apps/web/src/audio/fx/

| File | Description |
|------|-------------|
| `manager.ts` | FX processor lifecycle and routing |
| `echo.ts` | Echo/delay effect |
| `reverb.ts` | Reverb effect |
| `filter.ts` | Variable filter effect |
| `types.ts` | FX type definitions |
| `index.ts` | Barrel exports |

### apps/web/src/components/

| File | Description |
|------|-------------|
| `DJBoard.tsx` | Main board component (layout, coordinates, all subcomponents) |
| `DeckTransport.tsx` | Server-to-audio sync bridge + transport UI (play/pause/cue/BPM) |
| `QueuePanel.tsx` | Track queue panel with upload and YouTube search |
| `QueueItemRow.tsx` | Individual queue item with deck load buttons |
| `YouTubeSearch.tsx` | YouTube search UI component |
| `TrackUploader.tsx` | File upload component |
| `SamplerPanel.tsx` | Sampler UI panel (4 buttons) |
| `SamplerButton.tsx` | Individual sampler pad button |
| `SamplerSettings.tsx` | Modal for sampler sound management |
| `PerformancePadPanel.tsx` | 2x2 performance pad grid per deck |
| `PerformancePadButton.tsx` | Individual performance pad button |
| `FXControlPanel.tsx` | FX controls + channel faders + BPM displays |
| `TopBar.tsx` | Room code display, latency indicator |
| `CursorsLayer.tsx` | Multi-user cursor overlay + `buildMemberColorMap` utility |
| `ClippingIndicator.tsx` | **DEAD** -- not imported |
| `AutoplayGate.tsx` | **DEAD** -- not imported |
| `FXStrip.tsx` | **DEAD** -- not imported |

### apps/web/src/components/controls/

| File | Description |
|------|-------------|
| `JogWheel.tsx` | Dual-zone jog wheel (vinyl scratch + pitch bend) |
| `Knob.tsx` | Rotary knob (used for EQ, master volume, FX params) |
| `Fader.tsx` | Vertical fader (used for channel faders) |
| `Crossfader.tsx` | Horizontal crossfader |
| `EQControl.tsx` | **UNUSED** -- exported but never imported by any component |
| `useControlInteraction.ts` | Shared control interaction hook |
| `index.ts` | Barrel exports |

### apps/web/src/components/displays/

| File | Description |
|------|-------------|
| `LCDScreen.tsx` | Styled LCD container |
| `WaveformDisplay.tsx` | Waveform visualization |
| `TrackInfoDisplay.tsx` | Track title and status |
| `TimeDisplay.tsx` | Current time / duration |
| `FXDisplay.tsx` | FX state readout |
| `LoadingBar.tsx` | YouTube loading progress |
| `DeckControlPanel.tsx` | Deck control panel layout |
| `DeckStatusDisplay.tsx` | **UNUSED** -- exported but never used |
| `index.ts` | Barrel exports |

### apps/realtime/src/

| File | Description |
|------|-------------|
| `server.ts` | HTTP + Socket.IO server setup, CORS, startup sequence |
| `http/api.ts` | All HTTP API endpoints (tracks, sampler, YouTube) |
| `rooms/store.ts` | In-memory room state store |
| `rooms/persistence.ts` | Redis/in-memory persistence manager |
| `timers/beacon.ts` | BEACON_TICK timer (250ms) |
| `timers/syncTick.ts` | **REMOVED** -- old SYNC_TICK timer (2s), deleted on `chore/remove-dead-code` branch |
| `handlers/deck.ts` | Deck action handlers + epoch creation |
| `handlers/queue.ts` | Queue mutation handlers |
| `handlers/controls.ts` | Control ownership + MIXER_SET handler |
| `handlers/cursor.ts` | Cursor position handler |
| `handlers/fx.ts` | FX parameter handlers |
| `handlers/time.ts` | TIME_PING/PONG handler |
| `protocol/handlers.ts` | Socket.IO event handler registration |
| `protocol/ack.ts` | Event acknowledgment |
| `protocol/idempotency.ts` | Client sequence deduplication |
| `security/limits.ts` | Rate limiter |
| `security/validate.ts` | Bounds validation |
| `security/index.ts` | Security barrel exports |
| `services/storage.ts` | File storage (Supabase + local filesystem) |
| `services/supabaseStorage.ts` | Supabase storage wrapper |
| `services/tracks.ts` | Track upload validation and deduplication |
| `services/samplerSounds.ts` | Sampler sound management service |
| `services/youtube.ts` | YouTube search (Data API v3) + audio extraction (yt-dlp) |
| `services/youtube-cookies.ts` | YouTube cookie fetcher for yt-dlp auth |
| `db/trackStore.ts` | In-memory track metadata store |
| `db/samplerSoundStore.ts` | In-memory sampler sound metadata store |
| `db/types.ts` | Database type definitions |
| `db/schema.sql` | SQL schema (reference only, not used -- stores are in-memory) |
