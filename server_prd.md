# Server & Multiplayer Improvement PRD

This document defines every planned change to improve puidBoard's server logic, multiplayer sync, and DJ functionality. Grouped into 3 sequential PRs by dependency.

**Execution order:** PR 1 → PR 2 → PR 3 (each builds on the last).

---

## PR 1: Foundation (Dead Code + Beacon + Rate Limits)

**Branch:** `feat/foundation-improvements`
**Effort:** 1 day
**Goal:** Clean slate, then infrastructure improvements. All low-risk, no new features.

Contains:
- Dead code cleanup + remove `serverStartTime`
- Beacon interval 250ms → 100ms + PLL jitter hardening
- Per-second burst rate limits

---

### 1A. Remove `serverStartTime` + Dead Code Cleanup

#### Problem

Deprecated code paths (`syncTick`, `drift.ts`, `serverStartTime`) create confusion and risk of accidental use. Dead files bloat the codebase.

#### Changes

| File | Change |
|------|--------|
| `packages/shared/src/state.ts` | Remove `serverStartTime` field from `DeckState` schema |
| `packages/shared/src/events.ts` | Remove `SYNC_TICK` event schema if still present |
| `apps/realtime/src/timers/syncTick.ts` | Delete file (already done on branch) |
| `apps/web/src/audio/sync/drift.ts` | Delete file (already done on branch) |
| `apps/web/src/audio/sync/index.ts` | Remove drift.ts re-exports |
| `apps/web/src/components/DJBoard.tsx` | Remove `setUserBaseRate` import (was a no-op from drift.ts) |
| `apps/web/src/audio/youtubePlayer.ts` | Delete file |
| `apps/web/src/components/AutoplayGate.tsx` | Delete file |
| `apps/web/src/components/FXStrip.tsx` | Delete file |
| `apps/web/src/components/controls/EQControl.tsx` | Delete file |
| `apps/web/src/components/controls/index.ts` | Remove `EQControl` export |
| `apps/web/src/components/displays/index.ts` | Remove `DeckStatusDisplay` export |
| `apps/web/src/components/displays/DeckStatusDisplay.tsx` | Delete file |
| `apps/web/src/components/ClippingIndicator.tsx` | Keep file (will be wired up in 3D) |
| Any handler referencing `serverStartTime` | Remove references, use only epoch fields |

#### Verification

- `pnpm build` succeeds in all three packages
- `grep -r "serverStartTime" packages/ apps/` returns zero results (except git history)
- `grep -r "syncTick\|SYNC_TICK" apps/` returns zero results
- `grep -r "setUserBaseRate\|drift" apps/web/src/` returns zero results (except git history)

---

### 1B. Beacon Interval 250ms to 100ms + PLL Jitter Hardening

#### 1B-i. Lower beacon interval

| File | Change |
|------|--------|
| `apps/realtime/src/timers/beacon.ts` line 15 | Change `BEACON_INTERVAL_MS` from `250` to `100` |

One-line change. PLL gets 10 samples/sec instead of 4.

#### 1B-ii. Harden PLL against jitter

With 100ms beacons, network jitter becomes a larger proportion of the interval. The PLL needs stronger smoothing.

| File | Change |
|------|--------|
| `apps/web/src/audio/sync/pll.ts` | Increase median filter window from 5 to 7 samples. Add exponential moving average (EMA) on top of median filter: `smoothedDrift = alpha * newDrift + (1 - alpha) * prevDrift` with alpha = 0.3. This prevents micro-wobbles in playback rate from jittery beacon arrivals. |

#### 1B-iii. Stale beacon rejection

| File | Change |
|------|--------|
| `apps/web/src/audio/DeckEngine.ts` | Add timestamp-based stale rejection: if a beacon's `serverTs` is older than the last processed beacon's `serverTs`, discard it. Prevents out-of-order processing when packets arrive in bursts. |

#### Test Plan

- Open two browsers, load and play same track
- Seek on one client — the other should converge noticeably faster than before
- Monitor with console logging: beacon processing rate should be ~10/sec
- Scratch with jog wheel — remote client should follow more tightly

---


### 1C. Per-Second Burst Rate Limits

#### Problem

Current rate limits are per-minute only. A malicious client could send 100 deck events in 1 second, then nothing for 59 seconds, and stay within limits while causing server strain.

#### Solution

Add a secondary burst window to the rate limiter.

#### Changes

| File | Change |
|------|--------|
| `apps/realtime/src/security/limits.ts` | Add `burstLimit` and `burstWindowMs` to rate limit config. Check both windows on each event. |

#### Configuration

```typescript
RATE_LIMITS = {
  DECK_ACTIONS: { perMinute: 100, burstPerSecond: 20 },
  DECK_SEEK:    { perMinute: 600, burstPerSecond: 40 },
  QUEUE_ADD:    { perMinute: 20,  burstPerSecond: 5 },
  QUEUE_REMOVE: { perMinute: 30,  burstPerSecond: 8 },
  QUEUE_REORDER:{ perMinute: 60,  burstPerSecond: 15 },
  QUEUE_EDIT:   { perMinute: 60,  burstPerSecond: 15 },
  SAMPLER_PLAY: { perMinute: 30,  burstPerSecond: 8 },
}
```

The existing sliding window algorithm works — just add a second window at 1-second granularity alongside the 60-second one.

---

## PR 2: Core Features (Optimistic Transport + Sampler Sync + Loop/Roll)

**Branch:** `feat/core-features`
**Effort:** 2-3 days
**Goal:** New protocol events + transport changes. All touch events.ts/state.ts/DeckEngine — must be together.

Contains:
- Optimistic deck transport
- Sampler sync across clients
- Server-authoritative loop + roll pads

---

### 2A. Optimistic Deck Transport

#### Problem

When a user clicks Play, the audio doesn't start until the server round-trip completes (~50-100ms). Humans feel this delay. Same for Pause, Cue, and Seek.

#### Solution

Apply deck transport actions **locally and immediately** on the client, then send the event to the server. The server confirms via the next beacon, and the PLL corrects any drift.

#### Files to Change

| File | Change |
|------|--------|
| `apps/web/src/components/DeckTransport.tsx` | On play/pause/cue click: call `deckEngine.applyLocalAction()` immediately, THEN send the server event |
| `apps/web/src/audio/DeckEngine.ts` | Verify `applyLocalAction()` handles all transport types: play, pause, cue, seek. Add guard to suppress the next beacon's epoch change if it matches the optimistic action |
| `apps/web/src/audio/deck.ts` | No changes needed — `play()`, `pause()`, `cue()` already work locally |

#### Behavior

```
User clicks Play
  -> Local Deck.play() fires IMMEDIATELY (audio starts)
  -> sendEvent(DECK_PLAY) goes to server
  -> Server creates epoch, broadcasts
  -> Next BEACON_TICK arrives
  -> DeckEngine sees same epoch, applies PLL correction (tiny adjustment)
  -> User never noticed any delay
```

#### Edge Cases

- If server rejects the event (rate limited, room gone), the next beacon will hard-reset the deck to the correct state via epoch change
- Two users pressing play simultaneously: server processes first one, second gets a no-op (deck already playing). Both converge via beacon.

#### Test Plan

- Open two browser tabs in same room
- Load same track on Deck A
- Click Play in Tab 1 — audio should start instantly (no perceptible delay)
- Tab 2 should start playing within ~100-200ms
- Click Pause in Tab 2 — should pause instantly locally
- Tab 1 should pause within ~100-200ms

---

### 2B. Sampler Sync Across Clients

#### Problem

When User A triggers a sampler pad, only User A hears it. This breaks the collaborative experience.

#### Solution

New event: `SAMPLER_PLAY`. Fire locally first (no round-trip delay), broadcast with server timestamp for remote scheduling.

#### Protocol Addition

Add to `packages/shared/src/events.ts`:

```typescript
// Client -> Server
SAMPLER_PLAY {
  ...ClientEventMeta,
  slot: 0 | 1 | 2 | 3
}

// Server -> All Clients (broadcast)
SAMPLER_PLAY {
  ...ServerEventMeta,
  slot: 0 | 1 | 2 | 3,
  sourceClientId: string  // who triggered it
}
```

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/events.ts` | Add `SamplerPlayEvent` schema and include in `ClientMutationEvent` / `ServerMutationEvent` unions |
| `apps/realtime/src/handlers/sampler.ts` | **New file.** Handler validates slot (0-3), broadcasts to room. Rate limit: 30/min per client. |
| `apps/realtime/src/protocol/handlers.ts` | Register sampler handler |
| `apps/web/src/components/SamplerPanel.tsx` | On pad press: play locally immediately, then `sendEvent(SAMPLER_PLAY)` |
| `apps/web/src/audio/sampler.ts` | Add `playRemoteSample(slot)` method that plays without sending a network event (for incoming broadcasts) |
| `apps/web/src/realtime/applyEvent.ts` | Handle `SAMPLER_PLAY` — if `sourceClientId !== myClientId`, call `playRemoteSample(slot)` |

#### Behavior

```
User A presses pad
  -> sampler.playSample(0) fires LOCALLY (instant audio)
  -> sendEvent(SAMPLER_PLAY, { slot: 0 })
  -> Server broadcasts with serverTs
  -> User B receives SAMPLER_PLAY
  -> User B's applyEvent calls playRemoteSample(0)
  -> User B hears sample ~50-100ms after User A (acceptable for samples)
```

#### Design Decision: No timestamp-based scheduling

The feedback suggested using `serverTs + networkOffset` to schedule remote playback precisely. **I'm not doing this** because:
- Samples are 0.5-2s long — 50ms of jitter is imperceptible
- Scheduling future audio adds complexity (need to buffer, handle cancellation)
- Fire-on-receive is simpler and good enough

If we later add a drum machine / step sequencer mode, THEN we'd need precise scheduling.

#### Test Plan

- Two browsers in same room
- User A triggers airhorn — both users should hear it
- User B triggers gunshot — both users should hear it
- Rapid pad mashing shouldn't cause rate limit errors for the local user (local playback is never blocked)

---

### 2C. Server-Authoritative Loop + Roll Pads

#### Problem

Loop and Roll performance pads are placeholder implementations. They need to be server-authoritative for multiplayer sync.

#### New Events

```typescript
// Loop
DECK_LOOP_SET {
  deckId: "A" | "B",
  enabled: boolean,
  startSec: number,
  endSec: number,
  lengthBars: 1 | 2 | 4 | 8
}

// Roll
DECK_ROLL_START {
  deckId: "A" | "B",
  startSec: number,
  lengthBars: 1 | 2 | 4 | 8,
  returnSec: number  // where to snap back on release
}

DECK_ROLL_STOP {
  deckId: "A" | "B"
}
```

#### State Addition

Add to `DeckState` in `packages/shared/src/state.ts`:

```typescript
loop: {
  enabled: boolean,
  startSec: number,
  endSec: number,
  lengthBars: number
} | null,

roll: {
  active: boolean,
  startSec: number,
  endSec: number,
  returnSec: number
} | null
```

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/state.ts` | Add `loop` and `roll` to `DeckState` schema |
| `packages/shared/src/events.ts` | Add loop/roll event schemas |
| `apps/realtime/src/handlers/deck.ts` | Add handlers for DECK_LOOP_SET, DECK_ROLL_START, DECK_ROLL_STOP. Loop: validate start < end, end - start matches bar length at detected BPM. Roll: save return position. |
| `apps/web/src/audio/deck.ts` | Implement loop enforcement: when playhead reaches `loop.endSec`, seek back to `loop.startSec`. Implement roll: same but restore `returnSec` on stop. |
| `apps/web/src/audio/DeckEngine.ts` | Handle loop/roll epoch transitions. Loop creates a new epoch each time it wraps. |
| `apps/web/src/components/PerformancePadPanel.tsx` | Replace placeholder implementations with real event sends |
| `apps/realtime/src/timers/beacon.ts` | Beacon playhead calculation must account for loops: if `playhead > loop.endSec && loop.enabled`, wrap to `loop.startSec` |

#### Audio Implementation

Loop enforcement happens in the `requestAnimationFrame` playhead update loop in `deck.ts`. When the calculated playhead exceeds `loop.endSec`:

```typescript
if (loop?.enabled && playhead >= loop.endSec) {
  const overshoot = playhead - loop.endSec;
  const loopLength = loop.endSec - loop.startSec;
  const newPlayhead = loop.startSec + (overshoot % loopLength);
  this.seekTo(newPlayhead);  // creates new AudioBufferSourceNode at loop start
}
```

Server beacon does the same calculation to keep all clients in sync.

---

## PR 3: Audio & Polish (Reconnection + Headphone Cue + EQ + Clipping)

**Branch:** `feat/audio-polish`
**Effort:** 2-3 days
**Goal:** Reliability + audio graph improvements + UI polish. Independent from PR 2's protocol changes.

Contains:
- Reconnection state recovery
- Headphone cue / PFL
- Full 3-band EQ (low + mid knobs)
- Clipping indicator

---

### 3A. Reconnection State Recovery

#### Problem

When a client disconnects and reconnects, they get a fresh `ROOM_SNAPSHOT`. This works but:
- Brief audio gap while re-syncing
- If they were the one controlling a fader, they lose ownership
- Other clients see them leave and rejoin (MEMBER_LEFT + MEMBER_JOINED)

#### Solution

Use the existing idempotency store's rolling event window to provide catch-up events on reconnect.

#### Protocol Changes

Add `REJOIN_ROOM` event (distinct from `JOIN_ROOM`):

```typescript
// Client -> Server
REJOIN_ROOM {
  roomCode: string,
  name: string,
  previousClientId: string,  // client's old ID
  lastVersion: number        // last room version they saw
}

// Server -> Client (response)
ROOM_REJOIN_SNAPSHOT {
  room: RoomState,
  clientId: string,  // may be same as previousClientId if still in room
  missedEvents: ServerMutationEvent[]  // events since lastVersion (if available)
}
```

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/events.ts` | Add `RejoinRoomEvent` and `RoomRejoinSnapshot` schemas |
| `apps/realtime/src/protocol/handlers.ts` | Add `REJOIN_ROOM` handler: look up client by `previousClientId`, if still tracked in room (within disconnect grace period), restore their membership instead of creating new. Send snapshot + missed events from idempotency store. |
| `apps/realtime/src/protocol/idempotency.ts` | Add `getEventsSince(roomId, version)` method that returns events from the rolling window with version > requested |
| `apps/realtime/src/rooms/store.ts` | Add disconnect grace period: on disconnect, mark member as "disconnected" instead of removing immediately. Remove after 30s if no rejoin. |
| `apps/web/src/realtime/client.ts` | On reconnect: if we have a `previousClientId` and `lastVersion`, send `REJOIN_ROOM` instead of `JOIN_ROOM`. Apply missed events in order. |

#### Grace Period Behavior

```
Client disconnects (network drop)
  -> Server marks member as "disconnected" (NOT removed)
  -> Other clients see latency indicator go grey, no MEMBER_LEFT yet
  -> 0-30 seconds pass
  -> Client reconnects, sends REJOIN_ROOM
  -> Server restores membership, sends snapshot + missed events
  -> Other clients see member come back online (no leave/join flicker)
  -> If 30s expires without rejoin: normal MEMBER_LEFT, cleanup
```

#### Test Plan

- Join room with two browsers
- Kill network on one (DevTools > Network > Offline)
- Restore network within 30s
- Client should rejoin seamlessly without the other client seeing leave/join
- Audio should resume from correct position

---

### 3B. Headphone Cue / PFL

#### Problem

The headphone cue mix knob is rendered but hardcoded to 0.5 with no audio routing.

#### Solution

Split the mixer graph into two output paths: Main and Headphone (PFL = Pre-Fader Listen).

#### Audio Graph Change

```
Current:
  Channels -> Crossfader -> PreMaster -> FX -> Master -> Destination

New:
  Channels -> Crossfader -> PreMaster -> FX -> Main Gain ---------> Destination (speakers)
                                                  |
  Channel A Pre-Fader -> PFL Gain A --+           |
  Channel B Pre-Fader -> PFL Gain B --+-> CueMix -+-> Headphone Gain -> Destination (same output)
                                         ^
                                    cueMix knob (0=PFL, 1=Main)
```

**Reality check:** The Web Audio API only has one `AudioContext.destination`. True headphone routing requires either:
1. A system with multiple audio outputs (rare in browsers)
2. A stereo split: left channel = main, right channel = headphone (common DJ practice)
3. Simply mix PFL into the main output at the cue mix ratio (simplest, what we'll do)

#### Approach: Cue Mix Blend

The cue mix knob blends between the main mix and the pre-fader channel signal. At 0.0, you hear only PFL (the raw channel before fader/crossfader). At 1.0, you hear only the main mix. This is useful for previewing a track before bringing it into the mix.

#### Files to Change

| File | Change |
|------|--------|
| `apps/web/src/audio/mixerGraph.ts` | Add PFL tap points after EQ but before channel fader. Add CueMix gain node that blends PFL and main. Route through headphone gain to destination. |
| `apps/web/src/audio/useMixer.ts` | Handle `headphoneMix` control ID, route to CueMix crossfade |
| `apps/web/src/components/DJBoard.tsx` | Wire up headphone cue knob to send `MIXER_SET` with `controlId: "headphoneMix"` |
| `packages/shared/src/controlIds.ts` | Add `headphoneMix` to control IDs if not present |

---

### 3C. Full 3-Band EQ (Low + Mid Knobs)

#### Problem

Only EQ High is exposed per channel. The mixer graph already has Low and Mid BiquadFilterNodes wired up but no UI knobs for them.

#### Solution

Add 4 more knobs to the mixer section. This requires SVG background changes or a layout rearrangement.

#### Files to Change

| File | Change |
|------|--------|
| `apps/web/src/components/DJBoard.tsx` | Add knob positions for `channelA.eq.low`, `channelA.eq.mid`, `channelB.eq.low`, `channelB.eq.mid`. Rearrange mixer knob layout from 2x2 to accommodate 6 EQ knobs + master + headphone = 8 knobs total. |
| `packages/shared/src/controlIds.ts` | Add new control IDs if not already present |
| `apps/web/public/assets/dj-controls/backgrounds/mixer-panel-background.svg` | Add knob slots for the new EQ positions |

#### Layout Options

**Option A:** 3 rows of knobs per channel (HI/MID/LOW stacked vertically) — mimics real DJ mixers like Pioneer DJM-900.

**Option B:** Keep current 2x2 grid, replace headphone cue knob with EQ selector (tap to cycle HI/MID/LOW). Less ideal but no SVG changes needed.

**Recommendation:** Option A. Real DJ mixers always show all 3 EQ bands simultaneously. Worth the SVG update.

---

### 3D. Clipping Indicator

#### Problem

`ClippingIndicator.tsx` exists but is commented out in `DJBoard.tsx`. The mixer graph already runs peak detection via its analyser node.

#### Files to Change

| File | Change |
|------|--------|
| `apps/web/src/components/DJBoard.tsx` | Uncomment ClippingIndicator import. Position it near the master volume knob. Pass the analyser's clipping state as a prop. |
| `apps/web/src/components/ClippingIndicator.tsx` | Verify it reads from the mixer graph's `isClipping()` function. Should flash red when peak > 0.99. |
| `apps/web/src/audio/mixerGraph.ts` | Verify `isClipping()` or equivalent is exported and running in the RAF loop |

#### Behavior

- LED-style indicator near master volume
- Green when headroom is fine
- Orange when peak > 0.9
- Red flash when peak > 0.99 (clipping)
- Holds red for 500ms after last clip event (so it's visible)

---

### 3E. Update system_overview.md

After all PR 3 changes are complete, update `system_overview.md` to reflect:
- New events added (REJOIN_ROOM, SAMPLER_PLAY, DECK_LOOP_SET, DECK_ROLL_START/STOP)
- New DeckState fields (loop, roll)
- Reconnection grace period behavior
- Headphone cue / PFL audio graph changes
- Full 3-band EQ layout
- Clipping indicator wired up
- Remove any remaining references to dead code that was deleted in PR 1
- Update the Appendix file reference table with new/changed files
- Update Section 8 (Dead Code) to reflect everything that was cleaned up
- Update Section 10 (Architecture Analysis) with any new scaling boundaries or design decisions

---

### Architecture Note: Deterministic Playhead Scales to All DJ Functions

The epoch + deterministic playhead model is the core architectural advantage of this system. It avoids the hardest problem in multiplayer: synchronizing continuous simulation. Every client independently calculates the exact playhead from `epochStart + elapsed * rate` without needing constant server correction.

This scales to loops and rolls — but only if they are modeled as **deterministic timeline transforms**, not as repeated seek events.

The base equation:

```
rawPlayhead = epochStartPlayhead + elapsed * rate
```

Works perfectly for: play, pause, seek, tempo change — all simple linear transforms.

Loops and rolls add a periodic transform on top:

```
if loop:
    playhead = loopStart + ((rawPlayhead - loopStart) mod loopLength)
else:
    playhead = rawPlayhead
```

This keeps everything deterministic. Every client computes the same playhead from the same epoch data. No repeated seek events, no accumulated drift, no server round-trips per loop iteration.

**Key insight:** Every DJ function should be modeled as a change to the playback function, not a stream of events. The server sets the function parameters (epoch, rate, loop bounds), and clients evaluate the function independently. This is why the architecture works — and why the beacon only needs to correct drift, not drive playback.

This is similar in spirit to Ableton Link, which synchronizes music playback across devices without any server at all by sharing tempo and phase information — each device independently calculates its own timeline position. Our system uses a server for authority (correct for multiplayer with untrusted clients) but the same principle of deterministic local evaluation applies.

---

## PR 4: Shared State Bug Fixes (Sampler Sounds + Hot Cues + Nudge)

**Branch:** `fix/shared-state-sync`
**Effort:** 2 days
**Goal:** Fix all cases where one client's actions don't reproduce correctly on other clients. The board is ONE shared instrument — every control, sound, and marker must be identical across all connected clients.

Contains:
- Room-scoped sampler sounds (custom sounds shared by all clients)
- Server-authoritative hot cues
- Auto-load custom sounds on room join
- Headphone cue wiring (3B, was not done)
- Clipping indicator wiring (3D, was not done)

---

### 4A. Room-Scoped Sampler Sounds

#### Problem

Custom sampler sounds are scoped per-client (`clientId + roomId + slot`). When User A uploads a custom airhorn to slot 0 and presses the pad:
- User A hears: custom airhorn
- User B hears: default airhorn (or User B's own custom sound)

The `SAMPLER_PLAY` event only sends `{ slot: 0 }` — no sound URL. Each client plays whatever buffer it has locally for that slot. This breaks the "one shared board" model.

#### Root Cause

`samplerSoundStore` indexes by `(clientId, roomId, slot)`. The `GET /api/sampler/sounds` endpoint filters by `clientId`. There is no concept of room-level shared sounds.

#### Solution

Make sampler sounds **room-scoped**. All 4 slots belong to the room, not individual users. When anyone uploads a custom sound, all clients in the room get it.

#### New Event

```typescript
// Server -> All Clients (broadcast)
SAMPLER_SOUND_CHANGED {
  ...ServerEventMeta,
  slot: 0 | 1 | 2 | 3,
  name: string,
  url: string,         // CDN URL for the audio file
  isDefault: boolean,  // true = reset to default
  changedBy: string    // clientId who made the change
}
```

#### State Addition

Add to `RoomState` in `packages/shared/src/state.ts`:

```typescript
sampler: {
  slots: [
    { name: string, url: string | null, isDefault: boolean },  // slot 0
    { name: string, url: string | null, isDefault: boolean },  // slot 1
    { name: string, url: string | null, isDefault: boolean },  // slot 2
    { name: string, url: string | null, isDefault: boolean },  // slot 3
  ]
}
```

Factory default:

```typescript
sampler: {
  slots: [
    { name: "Airhorn", url: null, isDefault: true },
    { name: "Horse Neigh", url: null, isDefault: true },
    { name: "Gunshot", url: null, isDefault: true },
    { name: "Explosion", url: null, isDefault: true },
  ]
}
```

`url: null` means use the client-side default from `/assets/audio/samples/`. A non-null URL means fetch from the server.

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/state.ts` | Add `sampler` field to `RoomStateSchema` with `SamplerStateSchema` (4 slots). Add factory default. |
| `packages/shared/src/events.ts` | Add `SamplerSoundChangedEvent` schema. Include in `ServerMutationEvent` union. |
| `apps/realtime/src/db/samplerSoundStore.ts` | Re-scope from `(clientId, roomId, slot)` to `(roomId, slot)`. Remove `clientId` from primary key. |
| `apps/realtime/src/services/samplerSounds.ts` | Update `upload()` to accept `roomId + slot` (no `clientId` in storage key). Update `getClientRoomSounds()` → `getRoomSounds(roomId)`. |
| `apps/realtime/src/http/api.ts` | `POST /api/sampler/upload`: after storing file, update `RoomState.sampler.slots[slot]` and broadcast `SAMPLER_SOUND_CHANGED` to room. `GET /api/sampler/sounds`: change to `?roomId=Y` (remove `clientId` filter). `POST /api/sampler/reset`: update room state and broadcast. |
| `apps/realtime/src/rooms/store.ts` | Add `sampler` to `RoomState` initialization with factory defaults. Add `updateSamplerSlot(roomId, slot, name, url, isDefault)` method. |
| `apps/web/src/realtime/client.ts` | Handle `SAMPLER_SOUND_CHANGED` event: call `loadCustomSample(slot, url, name)` or `resetSlotToDefault(slot)`. Update local `RoomState.sampler`. |
| `apps/web/src/components/SamplerSettings.tsx` | Remove `clientId` from API calls. Fetch room sounds on open (`?roomId=Y`). After upload/reset, no need to manually call `loadCustomSample` — the broadcast handler does it. |
| `apps/web/src/audio/sampler.ts` | No changes needed — `loadCustomSample()` and `resetSlotToDefault()` already work. |

#### Auto-Load on Room Join

When a client receives `ROOM_SNAPSHOT`, it must load any custom sampler sounds:

| File | Change |
|------|--------|
| `apps/web/src/realtime/client.ts` | In `ROOM_SNAPSHOT` handler: iterate `state.sampler.slots`. For each slot where `isDefault === false && url !== null`, call `loadCustomSample(slot, url, name)`. |

This replaces the current pattern where custom sounds only load when `SamplerSettings` modal is opened.

#### Behavior

```
User A uploads "Custom Horn.mp3" to slot 0
  -> POST /api/sampler/upload (roomId=room1, slot=0)
  -> Server stores file, updates RoomState.sampler.slots[0]
  -> Server broadcasts SAMPLER_SOUND_CHANGED { slot: 0, name: "Custom Horn", url: "...", isDefault: false }
  -> ALL clients receive event
  -> ALL clients call loadCustomSample(0, url, "Custom Horn")
  -> ALL clients now have identical slot 0 buffer

User A presses pad 0
  -> User A hears: Custom Horn (local optimistic)
  -> SAMPLER_PLAY { slot: 0 } broadcast
  -> User B receives, plays slot 0
  -> User B hears: Custom Horn (same buffer)

User C joins the room later
  -> Receives ROOM_SNAPSHOT with sampler.slots[0] = { name: "Custom Horn", url: "...", isDefault: false }
  -> Auto-loads custom sound for slot 0
  -> User C has identical sampler state
```

#### Test Plan

- Two browsers in same room
- User A opens Sampler Settings, uploads custom sound to slot 0
- User B should see the sound name update (if settings open) and hear the custom sound when pad 0 is triggered by either user
- User A resets slot 0 to default — User B should revert to default airhorn
- Third browser joins room — should auto-load the custom sound without opening settings
- Rapid upload of different sounds to same slot — last one wins, no race conditions

---

### 4B. Server-Authoritative Hot Cues

#### Problem

Hot cue points (`hotCuePointSec`) exist only in the client-side `Deck` class. They are not in the shared `DeckState` schema. When User A sets a hot cue:
- User A sees the marker on the waveform and can tap to jump
- User B has no hot cue — sees nothing, can't jump to it
- On track reload, hot cue is lost

The hot cue **jump** does sync (it sends `DECK_SEEK`), but the hot cue **position** does not.

#### Solution

Add `hotCuePointSec` to the shared `DeckState` and create a new `DECK_HOT_CUE_SET` event.

#### New Event

```typescript
// Client -> Server
DECK_HOT_CUE_SET {
  ...ClientEventMeta,
  deckId: "A" | "B",
  hotCuePointSec: number | null  // null = clear hot cue
}
```

#### State Addition

Add to `DeckState` in `packages/shared/src/state.ts`:

```typescript
hotCuePointSec: z.number().nullable().default(null)
```

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/state.ts` | Add `hotCuePointSec` to `DeckStateSchema`. Default `null`. |
| `packages/shared/src/events.ts` | Add `DeckHotCueSetEvent` schema. Include in `ClientMutationEvent` and `ServerMutationEvent` unions. |
| `apps/realtime/src/handlers/deck.ts` | Add `DECK_HOT_CUE_SET` handler: validate `hotCuePointSec` is within track duration (or null to clear), update `DeckState.hotCuePointSec`, broadcast. On `DECK_LOAD`: clear `hotCuePointSec` (new track = no hot cue). |
| `apps/realtime/src/protocol/handlers.ts` | Register `DECK_HOT_CUE_SET` in deck handler registration. |
| `apps/web/src/components/PerformancePadPanel.tsx` | On hot cue **hold** (set): send `DECK_HOT_CUE_SET` event with current playhead. On hot cue **tap** (jump): keep existing `DECK_SEEK` behavior. Read hot cue position from server state instead of local `deck.hotCuePointSec`. |
| `apps/web/src/realtime/client.ts` | Handle `DECK_HOT_CUE_SET` broadcast: update `DeckState.hotCuePointSec` in local state. |
| `apps/web/src/realtime/applyEvent.ts` | Add `DECK_HOT_CUE_SET` case: set `deck.hotCuePointSec = event.payload.hotCuePointSec`. |
| `apps/web/src/audio/deck.ts` | Keep local `hotCuePointSec` for immediate UI feedback, but treat server state as authoritative. `setHotCue()` and `clearHotCue()` remain for optimistic local updates. |
| `apps/web/src/components/displays/WaveformDisplay.tsx` | Read hot cue from server state (via props) instead of local deck state, so all clients see the marker. |

#### Behavior

```
User A holds Hot Cue pad at playhead = 45.2s
  -> Local: deck.setHotCue() (immediate marker on waveform)
  -> Send: DECK_HOT_CUE_SET { deckId: "A", hotCuePointSec: 45.2 }
  -> Server: updates DeckState.hotCuePointSec = 45.2, broadcasts
  -> User B: receives, sees hot cue marker on waveform at 45.2s

User B taps Hot Cue pad
  -> Reads hotCuePointSec = 45.2 from server state
  -> Sends DECK_SEEK { deckId: "A", positionSec: 45.2 }
  -> Both clients jump to 45.2s

User A loads new track on Deck A
  -> Server: DECK_LOAD handler clears hotCuePointSec = null
  -> All clients: hot cue marker disappears
```

#### Test Plan

- Two browsers, load track on Deck A
- User A holds hot cue pad — both users should see marker on waveform
- User B taps hot cue pad — both users jump to the marked position
- Load a new track — hot cue should clear on both clients
- User A holds hot cue pad again at different position — marker updates for both

---

### 4C. Headphone Cue / PFL Wiring

#### Problem

The headphone cue mix knob is rendered in `MixerKnobs` but hardcoded to `value={0.5}` with no audio routing or event handling. This was specified in PR 3B but not implemented.

#### Solution

Wire the cue mix knob to the mixer graph. Use the simplified approach from PR 3B: blend PFL (pre-fader listen) signal into the main output based on the cue mix knob position.

#### Files to Change

| File | Change |
|------|--------|
| `packages/shared/src/controlIds.ts` | Add `headphoneMix` control ID if not present. Add to `ALL_CONTROL_IDS`. Bounds: 0-1. |
| `packages/shared/src/state.ts` | Add `headphoneMix` field to `MixerStateSchema`. Default `1.0` (full main mix, no PFL). |
| `apps/web/src/audio/mixerGraph.ts` | Add PFL tap points after EQ but before channel fader for each channel. Add `cueMixGain` node. At `headphoneMix = 0.0`: output is 100% PFL (pre-fader channel signals). At `headphoneMix = 1.0`: output is 100% main mix (post-fader, post-crossfader). Add `setHeadphoneMix(value)` export. |
| `apps/web/src/audio/useMixer.ts` | Handle `headphoneMix` control value changes from server state. Call `setHeadphoneMix()` on the mixer graph. |
| `apps/web/src/components/DJBoard.tsx` | Wire the CUE knob to send `MIXER_SET` with `controlId: "headphoneMix"`. Read value from server state instead of hardcoded 0.5. |

#### Audio Graph Addition

```
Existing main path (unchanged):
  Channel -> EQ -> ChannelFader -> CrossfaderGain -> PreMaster -> FX -> MainGain -> Destination

New PFL tap (added):
  Channel A -> EQ -> [PFL tap A] -> pflGainA --+
  Channel B -> EQ -> [PFL tap B] -> pflGainB --+--> pflSum -> cueMixGain -+
                                                                          |
  MainGain -------------------------------------------------> mainMixGain -+--> finalOutput -> Destination
                                                                          ^
                                                              headphoneMix knob (0=PFL, 1=Main)
```

PFL taps connect **after EQ but before channel fader**, so you hear the track with EQ applied but unaffected by fader/crossfader position. This matches real DJ hardware behavior.

#### Cue Mix Crossfade

```typescript
function setHeadphoneMix(value: number): void {
  // value 0 = PFL only, value 1 = Main only
  const angle = value * (Math.PI / 2);
  pflSum.gain.value = Math.cos(angle);      // PFL fades out as knob goes right
  mainMixGain.gain.value = Math.sin(angle); // Main fades in as knob goes right
}
```

#### Test Plan

- Load track on Deck A, start playing, crossfader full to Deck B (Deck A silent in main mix)
- Turn cue mix knob toward 0 (PFL) — should hear Deck A through PFL despite crossfader position
- Turn cue mix knob back to 1 (Main) — Deck A goes silent again (crossfader blocks it)
- Verify knob syncs across two clients

---

### 4D. Clipping Indicator Wiring

#### Problem

`ClippingIndicator.tsx` exists but is commented out in `DJBoard.tsx`. The mixer graph already runs peak detection via its analyser node.

#### Files to Change

| File | Change |
|------|--------|
| `apps/web/src/components/DJBoard.tsx` | Uncomment `ClippingIndicator` import. Position near master volume knob. Pass clipping state from mixer graph. |
| `apps/web/src/components/ClippingIndicator.tsx` | Verify it reads from the mixer graph's peak detection. Implement 3-state indicator: green (peak < 0.9), orange (peak 0.9-0.99), red flash (peak > 0.99). Red holds for 500ms after last clip. |
| `apps/web/src/audio/mixerGraph.ts` | Verify `isClipping()` or peak level getter is exported. If not, add `getPeakLevel(): number` that reads from the analyser node's `getFloatTimeDomainData()`. |

#### Behavior

- LED-style indicator near master volume knob
- Green when headroom is fine (peak < 0.9)
- Orange when approaching clip (peak 0.9-0.99)
- Red flash when clipping (peak > 0.99)
- Red holds for 500ms after last clip event so it's visible
- Local only — no network sync needed (each client has its own audio levels)

---

### 4E. Update system_overview.md

After all PR 4 changes are complete, update `system_overview.md` to reflect:
- `RoomState.sampler` field and room-scoped sampler sounds
- `SAMPLER_SOUND_CHANGED` event
- `DeckState.hotCuePointSec` field and `DECK_HOT_CUE_SET` event
- `MixerState.headphoneMix` field and PFL audio graph
- `headphoneMix` control ID
- Clipping indicator wired up
- Remove Section 10.4 "Sampler Sync Gap" (no longer a gap)
- Update Section 6 (Performance Pads) to document synced hot cues
- Update Section 6.2 (Sampler System) to document room-scoped custom sounds
- Update Appendix file reference with new/changed files

---

## Summary

| PR | Branch | Contents | Effort |
|----|--------|----------|--------|
| **PR 1: Foundation** | `feat/foundation-improvements` | 1A Dead code cleanup, 1B Beacon 100ms + PLL hardening, 1C Burst rate limits | 1 day |
| **PR 2: Core Features** | `feat/core-features` | 2A Optimistic deck transport, 2B Sampler sync, 2C Loop/Roll pads | 2-3 days |
| **PR 3: Audio & Polish** | `feat/audio-polish` | 3A Reconnection recovery, 3B Headphone cue, 3C Full EQ, 3D Clipping indicator | 2-3 days |
| **PR 4: Shared State Fixes** | `fix/shared-state-sync` | 4A Room-scoped sampler sounds, 4B Server-authoritative hot cues, 4C Headphone cue wiring, 4D Clipping indicator wiring | 2 days |

**Total:** ~7-8 days. Sequential: PR 1 → PR 2 → PR 3 → PR 4.

---

## Rejected Suggestions

These were proposed in external feedback but rejected for puidBoard:

| Suggestion | Why Rejected |
|---|---|
| **Interest-based event broadcasting / QoS channels** | Over-engineering. <20 clients per room, cursor events already throttled at 33ms. Socket.IO rooms already scope events. Zero measurable improvement at our scale. |
| **Event sourcing instead of snapshots** | Massive complexity for ephemeral rooms. The idempotency store's rolling 1000-event window gives us catch-up capability (3A) without a full event sourcing system. |
| **Multi-server room distribution** | Single Fly.io instance handles our load. Would need sticky sessions or distributed state. Not needed until ~1000+ concurrent rooms. |
| **Raw WebSockets over Socket.IO** | Weeks of migration work for negligible overhead reduction at our scale. Socket.IO's reconnection, room abstraction, and fallback to polling are valuable. |
| **Timestamp-based sampler scheduling** | Samples are 0.5-2s long. 50ms of jitter between clients is imperceptible. Fire-on-receive is simpler and good enough. Revisit only if we add a step sequencer. |
