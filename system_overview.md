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
7. [Key Architecture Decisions](#7-key-architecture-decisions)

---

## 1. UI / Frontend Systems

### 1.1 Project Structure

puidBoard is a monorepo managed with Turborepo and pnpm workspaces. It has three packages:

| Package | Path | Purpose |
|---------|------|---------|
| `web` | `apps/web/` | Next.js frontend (React, TypeScript) |
| `realtime` | `apps/realtime/` | Socket.IO server (Node.js, TypeScript) |
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

Every control element is then positioned using absolute pixel coordinates within this space. For example:

```typescript
const POSITIONS = {
  DECK_A: { x: 0, y: 0 },
  DECK_B: { x: 870, y: 0 },
  JOG_A: { x: 63, y: 213 },
  JOG_B: { x: 933, y: 213 },
  MIXER: { x: 475, y: 0 },
  // ... many more
};
```

The `useBoardScale` hook (`apps/web/src/hooks/useBoardScale.ts`) measures the browser viewport and calculates the optimal scale factor:

```typescript
// Simplified from useBoardScale.ts
const scaleX = (window.innerWidth * targetScreenPercentage) / boardWidth;
const scaleY = (window.innerHeight * targetScreenPercentage) / boardHeight;
const scale = clamp(Math.min(scaleX, scaleY), 0.3, 1.5);
```

This scale is applied as a CSS transform on the outer container:

```typescript
<div style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
  {/* entire board at fixed 1600x600 */}
</div>
```

The hook recalculates on window resize, giving the board a responsive feel while keeping the internal layout pixel-perfect.

### 1.3 SVG Background as Layout Source of Truth

The board's background is an SVG image that defines the visual layout of the DJ controller (deck plates, mixer section, fader slots, knob rings). All interactive components are positioned to overlay their corresponding visual elements in the SVG. This means the SVG is the **single source of truth** for where things appear. If the SVG changes, the coordinate constants in `DJBoard.tsx` must be updated to match.

### 1.4 DJBoard Component Architecture

`DJBoard.tsx` is the root component that assembles the entire interface. It renders:

- **DeckDisplay** (x2) -- waveform display, track info, BPM readout
- **DeckControls** (x2) -- play/pause/cue buttons
- **PositionedJogWheel** (x2) -- dual-zone jog wheels with vinyl scratch and pitch bend
- **DeckTransport** (x2) -- invisible sync component that bridges server state to local audio
- **MixerKnobs** -- EQ, gain, and filter knobs for both channels
- **MixerFaders** -- channel faders
- **CrossfaderSection** -- horizontal crossfader
- **TempoFader** (x2) -- tempo sliders that map 0-1 fader position to 0.92-1.08 playback rate (plus/minus 8%)
- **SamplerPanel** -- 4-button sample trigger row
- **PerformancePadPanel** (x2) -- 2x2 performance pad grids per deck
- **FX controls** -- FX type selector, wet/dry, parameter knob

Each component is visually independent but communicates through either:
1. **Audio hooks** (`useDeck`, `useMixer`) for local audio state
2. **RealtimeClient** for network state propagation

### 1.5 Accent Colors and Visual Identity

Each deck has a distinct accent color used for glows, highlights, and UI elements:

```typescript
const accentA = "#3b82f6"; // Blue for Deck A
const accentB = "#8b5cf6"; // Purple for Deck B
```

### 1.6 Room Page and Autoplay Gate

The room page (`apps/web/src/app/room/[code]/page.tsx`) handles two modes:

1. **Mock mode** -- for development without a running server. Uses local-only audio.
2. **Real-time mode** -- connects to the Socket.IO server.

A critical aspect is the **autoplay gate**: browsers block AudioContext creation until user interaction. The room page attaches a click handler that calls `initAudioEngine()` on the first user interaction. Until that happens, no audio can play.

```typescript
const handleInitAudio = useCallback(async () => {
  if (!audioInitialized) {
    await initAudioEngine();
    setAudioInitialized(true);
  }
}, [audioInitialized]);
```

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
  durationSec: number;
  gainNode: GainNode | null;
  source: AudioBufferSourceNode | null;
  playbackRate: number;
  analysis: {
    waveform: WaveformData | null;
    bpm: number | null;
    status: AnalysisStatus;
  };
}
```

**Track loading** uses a cache to avoid re-fetching:

```typescript
const trackCache = new Map<string, AudioBuffer>();

async loadTrack(trackId: string, url: string): Promise<void> {
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

**Critical pattern -- pause before stop:** The `pause()` and `stop()` methods change state **before** calling `source.stop()`. This prevents the `onended` handler (which fires when a source naturally finishes or is stopped) from interfering with the intended state:

```typescript
pause(): void {
  this.state.playheadSec = this.getCurrentPlayhead(); // save position
  this.state.playState = "paused";   // state change FIRST
  this.state.source?.stop();          // then stop audio
}
```

**Playback rate changes** must recalculate timing to keep the playhead accurate. When the rate changes mid-play, the deck snapshots the current position and resets the timing reference:

```typescript
setPlaybackRate(rate: number): void {
  if (this.state.playState === "playing") {
    const currentPlayhead = this.getCurrentPlayhead();
    this.state.startOffset = currentPlayhead;
    this.state.startTime = ctx.currentTime;
    this.state.source.playbackRate.value = rate;
  }
  this.state.playbackRate = rate;
}
```

**Scrub** (used by vinyl mode on the jog wheel) moves the playhead by a delta and restarts the source at the new position:

```typescript
scrub(deltaSec: number): void {
  const newPos = clamp(this.getCurrentPlayhead() + deltaSec, 0, this.state.durationSec);
  // Reconnect source at new position...
}
```

**Nudge** (used by pitch bend on the jog wheel) temporarily adjusts the playback rate without modifying the stored rate:

```typescript
nudge(bendAmount: number): void {
  // bendAmount: -1 to +1, mapped to +-8% of base rate
  const effectiveRate = this.state.playbackRate * (1 + bendAmount * 0.08);
  this.state.source.playbackRate.value = effectiveRate;
}
```

**Audio analysis** is triggered after track load. It runs waveform generation (synchronous, fast) followed by BPM detection (asynchronous, slower). An `analysisId` counter prevents stale results from overwriting if a new track is loaded before analysis completes.

### 2.3 Mixer Graph

`apps/web/src/audio/mixerGraph.ts` builds the full audio routing chain as a singleton graph of Web Audio nodes.

**Signal flow:**

```
Deck A ─> InputGain ─> EQ(Low) ─> EQ(Mid) ─> EQ(High) ─> ChannelFader ─> CrossfaderGainA ─┐
                                                                                              ├─> PreMaster ─> FX ─> Analyser ─> MasterGain ─> Destination
Deck B ─> InputGain ─> EQ(Low) ─> EQ(Mid) ─> EQ(High) ─> ChannelFader ─> CrossfaderGainB ─┘
```

**3-Band EQ** uses three `BiquadFilterNode`s:

| Band | Type | Frequency | Q |
|------|------|-----------|---|
| Low | lowshelf | 320 Hz | 0.7 |
| Mid | peaking | 1000 Hz | 1.0 |
| High | highshelf | 3200 Hz | 0.7 |

Each band has plus/minus 12 dB range. The bipolar control value (-1 to 1) is mapped to dB via `bipolarToGain()` in `params.ts`.

**Equal-power crossfade** uses sine/cosine curves to maintain perceived volume as the crossfader sweeps:

```typescript
// From params.ts
export function equalPowerCrossfade(position: number): { gainA: number; gainB: number } {
  const angle = position * (Math.PI / 2);
  return {
    gainA: Math.cos(angle),
    gainB: Math.sin(angle),
  };
}
```

At the center position (0.5), both channels receive approximately 0.707 gain (-3 dB), so the combined volume stays roughly constant.

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

The lag range corresponds to 60-180 BPM:

```typescript
// At 60 BPM: 1 beat = 1000ms = 40 frames (at 25ms/frame)
// At 180 BPM: 1 beat = 333ms = ~13 frames
const minLag = Math.floor(60000 / (MAX_BPM * FRAME_DURATION_MS)); // ~13
const maxLag = Math.floor(60000 / (MIN_BPM * FRAME_DURATION_MS)); // ~40
```

The lag with the highest correlation is the beat period. The algorithm then checks for **octave errors** (detecting 2x or 0.5x the actual tempo) by seeing if half-tempo or double-tempo candidates also have high correlation (>80% of the peak). When ambiguous, it prefers the tempo closest to 120 BPM.

**Why autocorrelation?** It finds periodicity (repeating patterns) rather than just common intervals, making it robust to syncopation, complex rhythms, and ornamental hits. This is the same core method used by Rekordbox, Serato, and Essentia/Spotify.

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
  VINYL: {
    SECONDS_PER_ROTATION: 1.8,  // 1.8 seconds of audio per 360 degrees
    ZONE_RADIUS: 0.65,          // center 65% of radius
  },
  PITCH_BEND: {
    MAX_BEND: 1.0,              // maximum bend amount
    DEGREES_FOR_MAX_BEND: 15,   // degrees per frame for max bend
    RELEASE_DECAY: 0.15,        // how fast bend returns to zero
  },
  VISUAL: {
    VINYL_RPM: 33.33,           // matches real vinyl turntable speed
  },
  NETWORK: {
    THROTTLE_MS: 50,            // rate limit for DECK_SEEK events
  },
};
```

The jog wheel uses `requestAnimationFrame` for smooth visual animation and **pointer event coalescing** (`getCoalescedEvents`) for precise input tracking. Network events (DECK_SEEK) are throttled to 50ms minimum intervals to avoid flooding the server.

When playing, the jog wheel platter visually spins at 33.33 RPM to mimic a vinyl turntable. Touch interaction adds to or overrides this rotation.

### 2.8 FX System

`apps/web/src/audio/fx/manager.ts` manages FX processing as a singleton.

**Available effects:**

| FX Type | Implementation | Description |
|---------|---------------|-------------|
| `echo` | `EchoFX` | Delay-based echo effect |
| `reverb` | `ReverbFX` | Convolution or algorithmic reverb |
| `filter` | `FilterFX` | Variable filter (low-pass/high-pass) |
| `none` | (bypass) | Dry signal only |

The FX manager sits between the `preMaster` summing node and the `analyser` in the mixer graph. It maintains both a processor path and a bypass path:

```
preMaster ─> [FXManager.input] ─> processor ─> [FXManager.output] ─> analyser
                                └── bypass ───┘
```

Each effect exposes two parameters via the `FxState` schema: `wetDry` (0=dry, 1=wet) and `param` (effect-specific, 0-1). The effect can be enabled/disabled, which toggles between the processor and bypass paths.

---

## 3. Song Upload and Playback

### 3.1 Upload Flow

The upload process follows this sequence:

```
User selects file
    │
    ▼
POST /api/tracks/upload (multipart form: file + title + durationSec)
    │
    ▼
TrackService.upload() validates:
  - File size <= 50MB
  - MIME type in [audio/mpeg, audio/wav, audio/aiff, audio/flac]
  - Duration <= 15 minutes
    │
    ▼
StorageService.upload() computes SHA256 hash and stores file
    │
    ▼
TrackStore.findByHash() checks for existing record (deduplication)
    │
    ├── (exists) → return existing trackId + URL
    │
    └── (new) → TrackStore.create() + return new trackId + URL
```

The HTTP API is defined in `apps/realtime/src/http/api.ts` and uses `busboy` for multipart form parsing.

### 3.2 Content-Addressed Storage

Files are stored using their **SHA256 hash** as the filename:

```typescript
// apps/realtime/src/services/storage.ts
const fileHash = createHash("sha256").update(buffer).digest("hex");
const ext = this.getExtensionFromMime(mimeType);
const storageKey = `${fileHash}${ext}`;  // e.g., "a1b2c3d4...f6.mp3"
```

**Why content-addressed?** Two users uploading the same file get the same storage key, so the file is stored only once. This is automatic deduplication with zero configuration. The TrackService checks `trackStore.findByHash()` before creating a new record -- if the hash already exists, it returns the existing track.

### 3.3 Storage Backends

`StorageService` supports two backends, chosen automatically at startup:

| Backend | When | URL Strategy |
|---------|------|-------------|
| **Supabase Storage** | `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars present | Signed URLs with expiration |
| **Local filesystem** | Default (no Supabase config) | `CDN_BASE_URL/{storageKey}` served by the HTTP server |

For local storage, files live in `.storage/tracks/` relative to the realtime app root. The HTTP server has a `GET /files/:storageKey` route that streams the file back with appropriate MIME type headers.

For Supabase, `getUrl()` creates a time-limited signed URL. This means URLs expire and must be refreshed periodically -- the track service handles this transparently when clients request track URLs.

### 3.4 From Upload to Playback

After upload, a track enters the queue via the `QUEUE_ADD` event. When a user loads a track into a deck:

1. Client sends `DECK_LOAD` event with `trackId` and `deckId`
2. Server updates `DeckState.loadedTrackId`, creates a new epoch, broadcasts
3. `DeckTransport` component on all clients receives the state change
4. `DeckTransport` calls `deck.loadTrack(trackId, url)` which fetches the audio, decodes it, caches the buffer, and triggers analysis (waveform + BPM)
5. The deck is now ready for play/pause/cue

---

## 4. Server Architecture

### 4.1 Server Structure

`apps/realtime/src/server.ts` sets up an HTTP server with three layers:

1. **Health check** -- `GET /health` returns status
2. **HTTP API** -- track upload/download endpoints (see Section 3)
3. **Socket.IO** -- real-time event handling for rooms

Socket.IO is configured with both WebSocket and long-polling transports, with CORS controlled by the `CORS_ORIGIN` environment variable.

### 4.2 Room Store (In-Memory State)

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

**Why in-memory?** For an MVP, in-memory storage avoids database dependencies and keeps latency minimal. The tradeoff is that room state is lost on server restart. A production version would persist to Redis or a database.

### 4.3 Authoritative Server Model

All state mutations flow through the server. The pattern is:

1. Client sends a mutation event (e.g., `DECK_PLAY`, `MIXER_SET`, `QUEUE_ADD`)
2. Server validates the event using Zod schemas from `@puid-board/shared`
3. Server rate-limits the request (100 deck actions per minute per client)
4. Server applies the mutation to the authoritative `RoomState`
5. Server broadcasts the change to all room members
6. Clients apply the received state optimistically

This ensures all clients converge to the same state regardless of network ordering. The server is the single source of truth.

### 4.4 Control Ownership

To prevent two users from simultaneously adjusting the same knob or fader, the system uses a **control ownership** model:

```typescript
// From packages/shared/src/state.ts
interface ControlOwnership {
  clientId: string;
  acquiredAt: number;    // server timestamp
  lastMovedAt: number;   // server timestamp
}
```

Control IDs follow dot notation: `"crossfader"`, `"channelA.eq.high"`, `"deckA.jog"`, etc.

When a client starts interacting with a control, it sends `CONTROL_GRAB`. The server grants ownership if the control is unowned or the previous ownership has expired. Ownership has a **2-second TTL** (`CONTROL_OWNERSHIP_TTL_MS = 2000`). If no `MIXER_SET` event refreshes the ownership within that window, the control becomes available for others.

`CONTROL_RELEASE` explicitly relinquishes ownership. When a client disconnects, the server cleans up all their owned controls.

### 4.5 Event Categories

Events are split into two categories for different handling:

| Category | Examples | Characteristics |
|----------|----------|----------------|
| **Continuous** | `CURSOR_MOVE`, `MIXER_SET` | High frequency, can be coalesced, last-writer-wins |
| **Discrete** | `DECK_PLAY`, `QUEUE_ADD`, `FX_TOGGLE` | Each event matters, must be processed in order |

This distinction affects rate limiting and broadcasting strategies. Continuous events can be throttled without losing meaning; discrete events cannot be dropped.

### 4.6 Rate Limiting and Validation

`apps/realtime/src/security/` provides:

- **Rate limiter** -- per-client, per-action-type token bucket. Deck actions are limited to 100/minute.
- **Bounds validation** -- `validateSeekPosition()` checks against track duration, `validateCuePosition()` similarly. Control values are checked against their defined ranges (e.g., gain/EQ: -1 to 1, faders: 0 to 1).
- **Schema validation** -- every incoming event is parsed with its Zod schema before processing. Invalid payloads are silently dropped.

### 4.7 BEACON_TICK Timer

`apps/realtime/src/timers/beacon.ts` runs a 250ms interval timer per room. Each tick:

1. Increments `epochSeq` for any playing deck
2. Calculates the current playhead from epoch fields:
   ```typescript
   const elapsedMs = serverTs - deck.epochStartTimeMs;
   const playhead = deck.epochStartPlayheadSec + (elapsedMs / 1000) * deck.playbackRate;
   ```
3. Broadcasts `BEACON_TICK` with payloads for both decks

This is the **primary sync mechanism**. See Section 5 for how clients consume it.

### 4.8 Legacy SYNC_TICK (Deprecated)

`apps/realtime/src/timers/syncTick.ts` runs at 2-second intervals. It uses the older `serverStartTime`-based playhead calculation. This timer is kept for backwards compatibility but its drift correction on the client is **disabled** because it interfered with manual tempo changes. All meaningful sync now happens through BEACON_TICK.

---

## 5. Real-time Synchronization

This is the most complex subsystem in puidBoard. It solves the problem: "How do we keep audio playback synchronized across multiple clients connected over the internet?"

### 5.1 The Epoch Model

An **epoch** represents a continuous, uninterrupted period of playback at a fixed rate from a known starting point. Any discontinuity creates a new epoch:

- Play, pause, stop
- Seek
- Tempo change
- Cue
- Track load

Each epoch is identified by a random UUID (`epochId`) and has:

```typescript
// From packages/shared/src/state.ts (DeckStateSchema)
epochId: z.string(),                  // UUID, changes on discontinuity
epochSeq: z.number(),                 // incremented each beacon tick
epochStartPlayheadSec: z.number(),    // playhead when epoch began
epochStartTimeMs: z.number(),         // server timestamp when epoch began
```

**Why epochs?** Without epochs, a client receiving a sync message has no way to know if it came from before or after a seek. Epoch IDs let clients detect when a discontinuity happened and do a hard reset instead of trying to smoothly correct.

On the server, `createNewEpoch()` is called for every discontinuity:

```typescript
// apps/realtime/src/handlers/deck.ts
function createNewEpoch(deck, serverTs, newPlayhead, newRate?) {
  deck.epochId = crypto.randomUUID();
  deck.epochSeq = 0;
  deck.epochStartPlayheadSec = newPlayhead;
  deck.epochStartTimeMs = serverTs;
  if (newRate !== undefined) deck.playbackRate = newRate;
}
```

**Tempo change special case:** When the tempo changes, the server must recalculate the playhead using the **old** rate before creating the new epoch with the **new** rate. Otherwise, the epoch start playhead would be wrong:

```typescript
// In handleDeckTempoSet:
// Calculate current playhead with OLD rate
const elapsed = (serverTs - deck.epochStartTimeMs) / 1000;
const currentPlayhead = deck.epochStartPlayheadSec + elapsed * deck.playbackRate;
// Create new epoch with corrected playhead and NEW rate
createNewEpoch(deck, serverTs, currentPlayhead, newRate);
```

### 5.2 Clock Synchronization (TIME_PING / TIME_PONG)

Before sync can work, clients need to know the server's clock. `apps/web/src/audio/sync/clock.ts` implements NTP-style clock synchronization.

**Protocol:**

1. Client sends `TIME_PING` with `t0 = Date.now()` every 2 seconds
2. Server responds with `TIME_PONG` containing `t0` and `serverTs` (server's `Date.now()`)
3. Client calculates:
   ```typescript
   const rttMs = Date.now() - t0;
   const oneWayMs = rttMs / 2;
   const estimatedClientTimeAtServer = t0 + oneWayMs;
   const offsetMs = serverTs - estimatedClientTimeAtServer;
   ```

**Noise rejection:**
- RTT spikes (>2.5x the current average) are rejected entirely
- Samples older than 60 seconds are discarded
- The last 7 samples are kept

**Weighted averaging:** Samples with lower RTT get higher weight (inversely proportional to RTT), since lower RTT means the one-way assumption is more accurate:

```typescript
const weight = 1 / (s.rttMs + 1);
```

The clock is considered "reliable" after 5 samples. Until then, sync corrections are more conservative.

**`getServerTime()`** returns `Date.now() + averageOffsetMs`, giving the best estimate of the server's current time.

### 5.3 DeckEngine -- The Single Writer

`apps/web/src/audio/DeckEngine.ts` is the central coordinator for deck transport state on each client. It implements the **single writer rule**: only DeckEngine modifies transport state. UI controls and server events all go through DeckEngine.

```typescript
class DeckEngine {
  private state: TransportState;     // authoritative local state
  private pllController: PLLController;
  private lastBeaconEpochSeq: number;
  private deck: Deck;                // audio playback

  applyServerBeacon(beacon: DeckBeaconPayload): void { /* ... */ }
  applyLocalAction(action: { type, playheadSec?, playbackRate? }): void { /* ... */ }
}
```

**Beacon processing (`applyServerBeacon`):**

```
Receive BEACON_TICK
    │
    ├── Is epochSeq <= lastBeaconEpochSeq? → Discard (stale)
    │
    ├── Is epochId different from current? → handleEpochChange() (hard reset)
    │
    └── Same epoch → applyPLLCorrection() (smooth adjustment)
```

**Epoch change (hard reset):** Full state replacement. The PLL is reset, and the local `Deck` is synced to the new state (play/pause/seek as needed).

**PLL correction (smooth adjustment):** See Section 5.4.

**Local actions (`applyLocalAction`):** For user-initiated actions (play, pause, seek, tempo change), DeckEngine applies the change **optimistically** to the local `Deck` immediately. The next beacon from the server will confirm and fine-tune.

### 5.4 Phase-Locked Loop (PLL) Drift Correction

`apps/web/src/audio/sync/pll.ts` implements smooth drift correction.

**Why PLL?** Directly snapping the playhead to the server's expected position causes audible glitches. Instead, the PLL gently adjusts the playback rate to gradually converge, like a real-world phase-locked loop in clock circuitry.

**Algorithm:**

1. **Measure drift:** Calculate the difference between local playhead and expected playhead (with latency compensation):
   ```typescript
   const oneWayLatencyMs = getAverageRtt() / 2;
   const latencyCompensatedElapsed = elapsedSinceBeacon + oneWayLatencyMs / 1000;
   const expectedPlayhead = beacon.playheadSec + latencyCompensatedElapsed * beacon.playbackRate;
   const driftMs = (localPlayhead - expectedPlayhead) * 1000;
   ```

2. **Median filter:** Push the drift measurement into a 5-sample window and take the median. This rejects noise and outliers:
   ```typescript
   const sorted = [...this.driftHistory].sort((a, b) => a - b);
   const medianDrift = sorted[Math.floor(sorted.length / 2)];
   ```

3. **Apply correction based on drift magnitude:**

   | Drift Range | Action |
   |-------------|--------|
   | < 10ms | Ignore (within tolerance) |
   | 10ms - 500ms | Proportional correction: `correction = -drift * 0.001` |
   | > 500ms | Hard snap to expected position + PLL reset |

4. **Proportional gain** is 0.001 (0.1% rate change per 100ms of drift), clamped to plus/minus 2%. This means the maximum rate adjustment is 2% faster or slower than the base rate.

5. **Apply effective rate:** The corrected rate (`baseRate * correctionFactor`) is applied directly to the `AudioBufferSourceNode.playbackRate.value`. This is the **only place** where sync modifies the playback rate:
   ```typescript
   private applyEffectiveRate(effectiveRate: number): void {
     const deckState = this.deck.getState();
     if (deckState.playState === "playing" && deckState.source) {
       deckState.source.playbackRate.value = effectiveRate;
     }
   }
   ```

### 5.5 Full Sync Lifecycle Example

Here is a complete example of what happens when User A presses Play:

1. **User A's browser:** `DeckEngine.applyLocalAction({ type: "PLAY" })` calls `deck.play()` immediately (optimistic).
2. **User A's browser:** Sends `DECK_PLAY` event to server.
3. **Server:** Validates, creates new epoch (`epochId=xyz`, `epochStartPlayheadSec=0`, `epochStartTimeMs=now`), sets `playState="playing"`, broadcasts `DECK_PLAY` mutation to all clients.
4. **Server:** Next `BEACON_TICK` (within 250ms) includes the new epoch in its payload.
5. **User B's browser:** Receives `BEACON_TICK`, `DeckEngine.applyServerBeacon()` detects epoch change (`epochId` differs), calls `handleEpochChange()` which resets state and starts playback at the epoch's playhead.
6. **Subsequent beacons:** Both clients now have the same `epochId`. Each beacon triggers `applyPLLCorrection()` which keeps playheads aligned within ~10ms through gentle rate adjustments.

### 5.6 DeckTransport -- Bridge Between Server and Audio

`apps/web/src/components/DeckTransport.tsx` is an invisible React component (renders nothing) that:

1. Watches server state changes for its deck (track loading, play state, BPM)
2. Syncs local `Deck` instance with server state
3. Routes `BEACON_TICK` payloads to `DeckEngine`

**`justLoadedRef` guard:** After loading a track, there is a 500ms window where auto-play from server state is suppressed. This prevents a race condition where the server's play command arrives before the client finishes loading the track.

**BPM display logic:** Prefers locally-detected BPM (which is available sooner), falls back to server-propagated BPM. The displayed BPM is always `detectedBpm * playbackRate`.

---

## 6. Performance Pads and Sampler

### 6.1 Performance Pad Panel

`apps/web/src/components/PerformancePadPanel.tsx` renders a 2x2 grid of pads per deck. Each pad has a fixed function:

| Pad | Function | Color | Click | Hold | Release |
|-----|----------|-------|-------|------|---------|
| 1 | Hot Cue | Red (#FF3B3B) | Jump to cue (or set if unset) | Override/re-set at current position | -- |
| 2 | Loop | Orange (#FF9F1C) | Toggle loop on/off | Cycle loop length: 1, 2, 4, 8 bars | -- |
| 3 | Roll | Blue (#3B82F6) | -- (hold-based only) | Start momentary roll, save return position | Stop roll, snap back to saved position |
| 4 | Jump | Purple (#8B5CF6) | Jump back 1 beat | Jump forward 1 bar (4 beats) | -- |

**Keyboard bindings:**
- Deck A: `1`, `2`, `3`, `4`
- Deck B: `7`, `8`, `9`, `0`

The Jump pad calculates beat/bar durations from the detected BPM:

```typescript
const beatsPerSecond = deck.bpm / 60;
const secondsPerBeat = 1 / beatsPerSecond;
// Tap: back 1 beat
const jumpBack = -secondsPerBeat;
// Hold: forward 1 bar
const jumpForward = secondsPerBeat * 4;
```

**Note:** Loop and Roll are currently placeholder implementations (marked with TODO comments). The Hot Cue and Jump pads are fully functional.

### 6.2 Sampler System

The sampler is a separate audio system that plays short samples **directly to the master gain**, bypassing the mixer chain entirely. This means samples always play at full volume regardless of crossfader, channel fader, or EQ settings.

**Architecture:**

```
SamplerPanel ─> playSample(slot) ─> AudioBufferSourceNode ─> GainNode(0.8) ─> MasterGain ─> Destination
```

**Sample slots:** 4 slots (0-3), each with a default sample:

| Slot | Default | Keybind |
|------|---------|---------|
| 0 | Kick | R |
| 1 | Snare | T |
| 2 | Hi-Hat | Y |
| 3 | Clap | U |

Samples are loaded from `/assets/audio/samples/*.wav`. If loading fails (e.g., files not found), each slot falls back to an **oscillator-based tone** with distinct frequency and waveform:

```typescript
const FALLBACK_CONFIGS = {
  0: { frequency: 440, duration: 0.15, type: "sine" },
  1: { frequency: 587.33, duration: 0.15, type: "square" },
  2: { frequency: 783.99, duration: 0.2, type: "triangle" },
  3: { frequency: 880, duration: 0.25, type: "sawtooth" },
};
```

**Custom samples:** The API supports loading custom samples via `loadCustomSample(slot, url, name)`. Custom samples override the defaults for their slot. `resetSlotToDefault(slot)` reverts to the original.

**Server-side sampler API:**
- `POST /api/sampler/upload` -- upload a custom sample sound
- `GET /api/sampler/sounds` -- list available sampler sounds
- `DELETE /api/sampler/sounds/:id` -- delete a custom sampler sound

**Event system:** `onSampleChange(listener)` lets components subscribe to slot changes for UI updates.

### 6.3 Sampler Panel Component

`apps/web/src/components/SamplerPanel.tsx` renders 4 buttons in a horizontal row. It handles keyboard events using `e.code` (e.g., `KeyR`, `KeyT`) for layout-independent detection. When a key is pressed, it triggers `playSample(slot)` and provides visual feedback via a 150ms pressed state.

All 4 buttons share the same orange color (#FF8C3B) for a unified look.

---

## 7. Key Architecture Decisions

### 7.1 Server-Authoritative State

**Decision:** All mutations flow through the server. Clients apply changes optimistically but the server's `BEACON_TICK` is the final authority.

**Why:** In a multi-user DJ session, conflicting operations (two users adjusting the same control, seeking at the same time) must resolve deterministically. Server authority ensures all clients converge to the same state. Without it, clients would diverge and require complex conflict resolution.

**Tradeoff:** Added latency for actions (round-trip to server). Mitigated by optimistic local updates -- the user sees the effect immediately and the server confirms within ~250ms.

### 7.2 Epoch-Based Sync over Continuous Timestamp Sync

**Decision:** Use epochs (UUID + sequence number + start position + start time) instead of continuously broadcasting absolute positions.

**Why:** With continuous timestamps, every seek or tempo change creates a discontinuity that confuses drift correction. The PLL would see a huge drift and try to correct for it, causing audio glitches. Epochs explicitly mark discontinuities, letting the system do a clean hard reset and then resume smooth correction.

**Tradeoff:** More complex protocol and state management. The benefit is dramatically more robust sync that handles seeks, tempo changes, and scrubbing gracefully.

### 7.3 PLL over Hard Snap

**Decision:** Use a proportional-gain PLL with median filtering for drift correction instead of directly seeking to the expected position.

**Why:** Hard snaps cause audible clicks and glitches. The PLL makes corrections invisible to the listener by adjusting playback rate by at most 2%. At 500ms+ drift, it does snap (the listener would notice being that far off anyway), but for normal network jitter (10-100ms), corrections are imperceptible.

**Tradeoff:** Convergence takes multiple beacon cycles (1-2 seconds to correct a 100ms drift). This is acceptable because the alternative (audible glitches) is worse.

### 7.4 Fixed Canvas + CSS Scale

**Decision:** Design the UI at a fixed resolution (1600x600) and use CSS `transform: scale()` instead of responsive CSS.

**Why:** The DJ board has 50+ precisely positioned controls that must align with the SVG background. Responsive layouts with flexbox/grid would require complex dynamic positioning that is fragile and hard to maintain. Fixed coordinates are simple, predictable, and trivially debuggable (change a number, see the result).

**Tradeoff:** The board scales uniformly -- it cannot rearrange for portrait mobile layouts. This is acceptable because a DJ controller is inherently a landscape interface.

### 7.5 Content-Addressed Storage

**Decision:** Use SHA256 hash of file contents as the storage key.

**Why:** Automatic deduplication with zero additional logic. Two users uploading the same song produce the same hash and the same storage key. The file is stored once. This saves storage space and simplifies the upload flow (just check if the hash exists already).

**Tradeoff:** No way to have multiple copies of the same file with different metadata (e.g., different titles). The system handles this by separating storage (file bytes, keyed by hash) from metadata (track records, which reference storage keys). Multiple track records can point to the same storage key.

### 7.6 Sampler Bypasses Mixer

**Decision:** Sampler output goes directly to master gain, not through the per-channel mixer chain.

**Why:** Samples (kick, snare, etc.) are performance elements that should always be audible regardless of crossfader position or channel fader settings. If they went through a channel, moving the crossfader would cut them off. Direct-to-master ensures consistent behavior.

**Tradeoff:** Samples cannot be EQ'd or filtered through the mixer. This is standard behavior in real DJ hardware (e.g., Pioneer DJM mixers route the sampler to a separate master bus).

### 7.7 Shared Package as Contract

**Decision:** All types, schemas, and event definitions live in `@puid-board/shared`, consumed by both client and server.

**Why:** Type safety across the network boundary. When the server sends a `BEACON_TICK`, both the server's emit and the client's handler reference the same TypeScript type derived from the same Zod schema. Schema changes are compile-time errors in both packages. This eliminates an entire class of bugs (mismatched field names, wrong types, missing fields).

**Tradeoff:** Changes to the shared package require rebuilding both dependent packages. In practice, Turborepo handles this automatically.

### 7.8 Single Writer Rule for Transport State

**Decision:** Only `DeckEngine` is allowed to modify deck transport state (playhead, playback rate, play state).

**Why:** Multiple code paths modifying transport state (UI handlers, sync corrections, server events) would create race conditions and inconsistencies. By funneling everything through DeckEngine, there is one place to reason about state transitions, one place to log, and one place to debug.

**Tradeoff:** UI code cannot directly call `deck.play()` -- it must go through `DeckEngine.applyLocalAction()`. This adds a level of indirection but provides much stronger correctness guarantees.

### 7.9 In-Memory Room State

**Decision:** Room state is held entirely in memory on the server (no database for real-time state).

**Why:** Latency. Every mixer knob adjustment, every beacon tick, every cursor move touches room state. Database round-trips would add unacceptable latency. In-memory access is nanoseconds vs. milliseconds for a database.

**Tradeoff:** State is lost on server restart. Rooms are inherently ephemeral (a DJ session), so this is acceptable. Track storage (the files themselves) uses persistent storage (filesystem or Supabase).

### 7.10 Zod for Runtime Validation

**Decision:** Use Zod schemas for both TypeScript types (compile-time) and event validation (runtime).

**Why:** The server processes untrusted input from WebSocket connections. Every event must be validated before it touches room state. Zod gives us both the TypeScript type (via `z.infer<>`) and the runtime validator (via `.safeParse()`) from a single schema definition. This eliminates drift between types and validation.

---

## Appendix: File Reference

| File | Description |
|------|-------------|
| `packages/shared/src/state.ts` | All state schemas (RoomState, DeckState, MixerState, etc.) |
| `packages/shared/src/events.ts` | All event schemas (client mutations, server broadcasts) |
| `packages/shared/src/controlIds.ts` | Control ID constants and ownership TTL |
| `packages/shared/src/validators.ts` | Bounds checking and validation utilities |
| `apps/web/src/audio/engine.ts` | AudioContext singleton |
| `apps/web/src/audio/deck.ts` | Deck class (per-deck playback) |
| `apps/web/src/audio/DeckEngine.ts` | Single writer for transport state, epoch + PLL sync |
| `apps/web/src/audio/mixerGraph.ts` | Full mixer audio graph (EQ, faders, crossfade, FX) |
| `apps/web/src/audio/params.ts` | Audio parameter smoothing utilities |
| `apps/web/src/audio/sampler.ts` | Sampler engine (sample loading, playback, fallback) |
| `apps/web/src/audio/useDeck.ts` | React hook for deck state + control methods |
| `apps/web/src/audio/useMixer.ts` | React hook for mixer state sync |
| `apps/web/src/audio/sync/pll.ts` | PLL drift correction controller |
| `apps/web/src/audio/sync/clock.ts` | TIME_PING/PONG clock synchronization |
| `apps/web/src/audio/sync/drift.ts` | Legacy drift correction (deprecated) |
| `apps/web/src/audio/analysis/bpmDetector.ts` | Autocorrelation-based BPM detection |
| `apps/web/src/audio/analysis/waveformGenerator.ts` | RMS waveform generation |
| `apps/web/src/audio/fx/manager.ts` | FX processor lifecycle and routing |
| `apps/web/src/components/DJBoard.tsx` | Main board component (layout, coordinates) |
| `apps/web/src/components/controls/JogWheel.tsx` | Dual-zone jog wheel |
| `apps/web/src/components/DeckTransport.tsx` | Server-to-audio sync bridge |
| `apps/web/src/components/SamplerPanel.tsx` | Sampler UI panel |
| `apps/web/src/components/PerformancePadPanel.tsx` | Performance pad UI panel |
| `apps/web/src/hooks/useBoardScale.ts` | Viewport scale calculation |
| `apps/web/src/realtime/client.ts` | RealtimeClient (Socket.IO wrapper) |
| `apps/web/src/app/room/[code]/page.tsx` | Room page with autoplay gate |
| `apps/realtime/src/server.ts` | HTTP + Socket.IO server setup |
| `apps/realtime/src/rooms/store.ts` | In-memory room state store |
| `apps/realtime/src/timers/beacon.ts` | BEACON_TICK timer (250ms) |
| `apps/realtime/src/timers/syncTick.ts` | SYNC_TICK timer (deprecated, 2s) |
| `apps/realtime/src/handlers/deck.ts` | Deck action handlers + epoch creation |
| `apps/realtime/src/protocol/handlers.ts` | Socket.IO event handler registration |
| `apps/realtime/src/services/storage.ts` | File storage (Supabase or local) |
| `apps/realtime/src/services/tracks.ts` | Track upload validation and deduplication |
| `apps/realtime/src/http/api.ts` | HTTP API endpoints |
