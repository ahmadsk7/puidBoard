# PRs.md — Virtual DJ Rooms (Multiplayer Mixer)

## North Star

Ship a production MVP where **2+ users** can join the same room, **see cursors**, **edit a shared queue**, **load the same track**, **press play**, stay **audibly in sync**, and **mix live** (crossfader/EQ/faders), with **reconnect** not losing state.

**Hard stance:** audio plays locally on each client. The server is authoritative for room state + event ordering.

---

## Tech assumptions (MVP)

* Frontend: Next.js/React + TypeScript
* Realtime server: Node.js + WebSocket (Socket.io ok)
* State: in-memory room state + Redis optional for scale
* DB: Postgres for metadata (rooms, uploads)
* Storage: S3-like object storage + CDN (uploads + sample pack)
* Deploy: Vercel for frontend; Fly.io or Render for backend; Cloudflare optional for CDN/DNS; managed Postgres via Neon / Supabase; Redis via Upstash.

If you’re using Amazon Web Services instead, swap storage/CDN to S3 + CloudFront.

---

## Repo conventions (enforced)

* **Single source of truth:** `RoomState` + ordered event log.
* **Server is authoritative** for:

  * queue mutations
  * deck load/play/pause/cue/seek commands
  * continuous control values after reconciliation (crossfader/faders/knobs)
  * version numbers (monotonic)
* **Clients predict** continuous controls locally for instant feel.
* **Discrete events are acked**; continuous events are throttled.
* **Schema-first protocol**: shared `zod`/JSON schema in `/shared`.
* **PR Definition of Done**

  * tests pass (unit + minimal integration)
  * types compile
  * feature flag / env wiring included
  * instrumentation hooks added (even if basic)

---

## Parallelization rule of thumb

Two dev lanes:

**Dev A (Client + Audio)**

* frontend UI, rendering, control interaction
* audio engine, waveform, drift correction, autoplay UX

**Dev B (Backend + Infra)**

* realtime server, room state, event ordering, permissions, rate limits
* storage/upload service, DB schema, deployment, observability

They should only block each other on:

* shared schema/contracts
* final sync integration (server tick ↔ client drift correction)

---

# Phase 0 — Foundation (unblocks parallel work)

## PR 0.1 ✅ — Monorepo scaffold + CI baseline (Dev B)

**Objective:** runnable skeleton with strict types, lint, test, and shared package.
**Scope**

* Create monorepo structure (e.g. pnpm workspaces):

  * `/apps/web` (frontend)
  * `/apps/realtime` (server)
  * `/packages/shared` (types/schemas)
* Add CI: typecheck, lint, unit tests
* Add env templates + local dev scripts
* Add PR template + conventional commit / changelog rules (optional)
  **Acceptance**
* `pnpm i && pnpm dev` runs web + server
* CI passes on a no-op change
  **Files**
* `pnpm-workspace.yaml`, root `package.json`, `turbo.json` (if using)
* `.github/workflows/ci.yml`
* `.env.example` (root + app-specific)

## PR 0.2 ✅ — Canonical RoomState + Event schemas (Dev B)

**Objective:** lock the contract so both devs can build confidently.
**Scope**

* Define `RoomState`, `DeckState`, `MixerState`, `QueueItem`, `Member`, `CursorState`
* Define event union + payload schema:

  * CURSOR_MOVE
  * CONTROL_GRAB / CONTROL_RELEASE
  * MIXER_SET
  * DECK_LOAD / PLAY / PAUSE / CUE / SEEK
  * QUEUE_ADD / REMOVE / REORDER / EDIT
  * FX_SET / FX_TOGGLE
  * SYNC_TICK (server→clients)
* Add versioning strategy:

  * `room.version` increments per accepted event
  * each event includes `room_id`, `event_id`, `client_id`, `client_seq`, `server_ts`
* Add event throttling guidance in shared constants
  **Acceptance**
* Shared package exports types + validators
* Server and client can import without circular deps
  **Files**
* `/packages/shared/src/state.ts`
* `/packages/shared/src/events.ts`
* `/packages/shared/src/validators.ts`

## PR 0.3 ✅ — Local dev “room simulator” harness (Dev A)

**Objective:** Dev A can build UI without waiting on full backend.
**Scope**

* In `/apps/web`, add a mock “room” provider:

  * local in-memory `RoomState`
  * applies events via the shared schema
  * simulates latency + acks
* Feature-flag it (`USE_MOCK_ROOM=true`)
  **Acceptance**
* Web app can load a room page and manipulate mock queue/controls
  **Files**
* `/apps/web/src/dev/mockRoom.ts`
* `/apps/web/src/dev/featureFlags.ts`

---

# Phase 1 — Realtime core (authoritative multiplayer)

## PR 1.1 ✅ — Realtime server: rooms + membership + snapshots (Dev B)

**Objective:** create/join room, presence, authoritative snapshots.
**Scope**

* Socket auth basics: `client_id` assignment
* Room lifecycle:

  * create room with code
  * join room by code
  * leave/disconnect cleanup
* Server maintains `RoomState` in memory
* On join: send `ROOM_SNAPSHOT` (full state) + server time info
* Heartbeat/ping measurement for latency indicator
  **Acceptance**
* Two browsers join same room and see member list update
* Server logs show room membership changes
  **Files**
* `/apps/realtime/src/server.ts`
* `/apps/realtime/src/rooms/store.ts`
* `/apps/realtime/src/protocol/handlers.ts`

## PR 1.2 ✅ — Cursor broadcast (Dev B)

**Objective:** shared “everyone is here” feeling fast.
**Scope**

* CURSOR_MOVE event handling (throttled)
* Store cursor positions in `RoomState.cursors`
* Broadcast cursor diffs (or events) to room
  **Acceptance**
* Two clients see each other’s cursor + name tag in real time (<120ms typical)
  **Files**
* `/apps/realtime/src/handlers/cursor.ts`
* shared constants for throttle rate

## PR 1.3 ✅ — Queue is source of truth (add/remove/reorder/edit) (Dev B)

**Objective:** queue mutations are serialized, replayable, optimistic-friendly.
**Scope**

* Implement queue event handlers:

  * QUEUE_ADD (with track_id, metadata)
  * QUEUE_REMOVE
  * QUEUE_REORDER (drag reorder)
  * QUEUE_EDIT
  * optional “send to top”
* Server assigns canonical ordering + state transitions:

  * queued | loaded_A/B | playing_A/B | played
* Acks for discrete events + retries strategy
  **Acceptance**
* Two clients reorder the queue and end in identical ordering
* Clients reconcile optimistic UI to server state (no divergence)
  **Files**
* `/apps/realtime/src/handlers/queue.ts`
* `/apps/realtime/src/protocol/ack.ts`

## PR 1.4 ✅ — Soft control locking + continuous controls (Dev B)

**Objective:** mixing feels cooperative, not janky.
**Scope**

* CONTROL_GRAB / CONTROL_RELEASE semantics:

  * ownership TTL = 2s since last movement
  * server stores `control_owners[control_id]`
* Continuous control handler:

  * MIXER_SET (crossfader, faders, gain, EQ, filter, master)
  * last-write-wins with smoothing hints
  * throttle continuous inputs server-side (e.g., 60Hz max)
* Broadcast ownership highlights
  **Acceptance**
* If User A grabs crossfader, User B sees subtle ownership highlight
* Both can still override (soft lock) and state remains consistent
  **Files**
* `/apps/realtime/src/handlers/controls.ts`
* `/packages/shared/src/controlIds.ts` (if needed)

---

# Phase 2 — Frontend MVP UI (real-time rig)

## PR 2.1 ✅ — Web app: create/join room + top bar status (Dev A)

**Objective:** <10s to create/join; surface latency + autoplay status.
**Scope**

* Landing page: Create Room / Join by code
* Room route: `/room/[code]`
* Top bar:

  * room code copy
  * invite link copy
  * latency indicator (green/yellow/red)
  * autoplay enabled status
    **Acceptance**
* New room created, link share works, join works
* UI shows latency color changing with ping
  **Files**
* `/apps/web/src/app/page.tsx`
* `/apps/web/src/app/room/[code]/page.tsx`
* `/apps/web/src/components/TopBar.tsx`

## PR 2.2 ✅ — Realtime client integration + cursor rendering (Dev A)

**Objective:** connect to server, render members + cursors cleanly.
**Scope**

* Socket client wrapper with:

  * reconnect + resubscribe
  * snapshot handling
  * event stream apply
* Render multiplayer cursors with name + color
* Show “grab glow” on controls by owner color (basic)
  **Acceptance**
* Two clients see cursors, presence, and control ownership highlights
  **Files**
* `/apps/web/src/realtime/client.ts`
* `/apps/web/src/realtime/applyEvent.ts`
* `/apps/web/src/components/CursorsLayer.tsx`

## PR 2.3 ✅ — Queue UI (drag reorder + status badges) (Dev A)

**Objective:** queue is *visibly* the source of truth.
**Scope**

* Right panel queue:

  * list items with: title, duration, added by, status (loaded/playing)
  * drag reorder (optimistic) → server reconcile
  * add/remove/edit
  * buttons: Add track, Clear (host-only later)
* Ensure deck load only from queue items
  **Acceptance**
* Two clients drag reorder simultaneously; end consistent
* Status badges update when a track is loaded/playing
  **Files**
* `/apps/web/src/components/QueuePanel.tsx`
* `/apps/web/src/components/QueueItemRow.tsx`

## PR 2.4 ✅ — DJ board UI: decks + mixer controls (no audio yet) (Dev A)

**Objective:** the “hand feel” of the rig is good before audio complexity.
**Scope**

* Layout: two decks + mixer + crossfader
* Controls wired to realtime state:

  * crossfader
  * channel faders
  * gain/trim
  * 3-band EQ each channel
  * master volume
* Interaction model:

  * mouse-down triggers CONTROL_GRAB
  * move sends MIXER_SET (throttled)
  * mouse-up triggers CONTROL_RELEASE
* Visual ownership glow on grabbed controls
  **Acceptance**
* Another client sees the fader positions move live while you drag
* Controls feel instant locally (client prediction), then reconcile
  **Files**
* `/apps/web/src/components/DJBoard.tsx`
* `/apps/web/src/components/controls/*`

---

# Phase 3 — Audio engine (local playback + mixing)

## PR 3.1 ✅ — Track asset pipeline (upload + metadata + CDN URLs) (Dev B)

**Objective:** a real track_id maps to a playable asset URL for every client.
**Scope**

* DB schema:

  * tracks(id, title, duration, owner_id?, source, created_at, mime, size, hash)
* Upload API:

  * direct-to-object-storage signed upload (preferred) OR server-proxy MVP
  * store metadata + return `track_id`
* Serve:

  * return CDN URL for `track_id`
  * support a “free sample pack” seed list for testing
    **Acceptance**
* Upload a track → receive `track_id` → add to queue → another client can fetch the URL
  **Files**
* `/apps/realtime/src/http/api.ts` (or separate `/apps/api`)
* `/apps/realtime/src/db/schema.sql` (or migrations)
* `/apps/realtime/src/services/tracks.ts`

## PR 3.2 ✅ — Deck transport + basic playback (Dev A)

**Objective:** Deck A/B can load + play/pause a track locally.
**Scope**

* Web Audio engine core:

  * decodeAudioData
  * per-deck buffer source management
  * play/pause with playhead tracking
* Implement DECK_LOAD / PLAY / PAUSE / CUE handling on client:

  * load track asset by id
  * maintain local playhead
* Autoplay permission UX:

  * “Enable audio” button if blocked
    **Acceptance**
* User loads a track into Deck A and plays; audio is audible and stable
* Pause resumes from correct playhead
  **Files**
* `/apps/web/src/audio/engine.ts`
* `/apps/web/src/audio/deck.ts`
* `/apps/web/src/components/AutoplayGate.tsx`

## PR 3.3 ✅ — Mixer routing + crossfader + EQ (Dev A)

**Objective:** real mixing works (it’s the whole point).
**Scope**

* Audio graph:

  * Deck A gain → EQ → channel gain node
  * Deck B gain → EQ → channel gain node
  * Crossfader (equal power curve) → master gain
* Map realtime `MixerState` to audio params smoothly
* Clipping/headroom indicator (simple)
  **Acceptance**
* Crossfader audibly blends between decks
* EQ knobs audibly affect sound
* Remote changes update your audio params
  **Files**
* `/apps/web/src/audio/mixerGraph.ts`
* `/apps/web/src/audio/params.ts`

## PR 3.4 ✅ — Minimal FX slot (Echo/Reverb/Filter) (Dev A)

**Objective:** one satisfying FX chain that’s fun + easy.
**Scope**

* FX module:

  * selector: echo, reverb, filter
  * wet/dry + one parameter + toggle
* Map FX state from realtime to audio nodes
  **Acceptance**
* FX toggle + wet/dry works live; remote sees + hears effect
  **Files**
* `/apps/web/src/audio/fx/*`
* `/apps/web/src/components/FXStrip.tsx`

---

# Phase 4 — Sync (the make-or-break)

## PR 4.1 ✅ — Server clock sync + SYNC_TICK protocol (Dev B)

**Objective:** every client can compute a shared server-time basis.
**Scope**

* Implement time sync handshake:

  * client sends `TIME_PING(t0)`
  * server replies `TIME_PONG(t0, server_ts)`
  * client estimates RTT + offset → `clock_skew_ms`
* Server emits `SYNC_TICK` every ~2s:

  * deck states: loaded track_id, play_state, server_start_time, initial_playhead
  * authoritative version
    **Acceptance**
* Client can display “server offset ms” debug
* Sync tick arrives at stable cadence
  **Files**
* `/apps/realtime/src/handlers/time.ts`
* `/apps/realtime/src/timers/syncTick.ts`

## PR 4.2 — Client drift correction + “micro-warp” (Dev A)

**Objective:** keep drift typically <40ms without nasty artifacts.
**Scope**

* On each SYNC_TICK:

  * compute expected playhead from server time
  * compare to actual
* Correction strategy:

  * small drift: temporarily adjust playbackRate slightly
  * big drift: snap with short fade
* Guardrails:

  * never warp beyond safe bounds
  * avoid oscillation (cooldown windows)
    **Acceptance**
* Two clients press play and remain audibly aligned over 2+ minutes
* Unplug/replug wifi causes temporary correction but recovers
  **Files**
* `/apps/web/src/audio/sync/drift.ts`
* `/apps/web/src/audio/sync/clock.ts`

## PR 4.3 ✅ — Server-authoritative deck actions (Dev B)

**Objective:** prevent “ghost playheads” and order deck actions cleanly.
**Scope**

* Server serializes DECK_LOAD/PLAY/PAUSE/CUE/SEEK:

  * assigns `server_start_time` on PLAY
  * validates seeks within track duration
* DeckState in RoomState updated only on accepted events
* Clients treat server tick as truth; local UI predicts but reconciles
  **Acceptance**
* If two users hit Play quickly, result is deterministic + consistent
* Deck play_state never diverges across clients
  **Files**
* `/apps/realtime/src/handlers/deck.ts`

---

# Phase 5 — Production hardening (reconnect, permissions, abuse)

## PR 5.1 — Reconnect resilience + state persistence (Dev B)

**Objective:** room survives disconnect/reconnect without state loss.
**Scope**

* Persist RoomState periodically (or event log) to Redis (MVP) or Postgres (later)
* On reconnect:

  * rejoin room
  * receive snapshot + resync time
* Ensure idempotency via `event_id` / `client_seq`
  **Acceptance**
* Client refreshes page → returns to same room state within 2s
* Queue + mixer state unchanged after reconnect
  **Files**
* `/apps/realtime/src/rooms/persistence.ts`
* `/apps/realtime/src/protocol/idempotency.ts`

## PR 5.2 — Roles/permissions + rate limiting (Dev B)

**Objective:** stop obvious abuse and prep for growth.
**Scope**

* Roles: Host + Everyone (MVP), scaffolding for DJ/Guest/Spectator
* Permissions:

  * Host-only: lock queue, clear queue, kick (optional)
  * Everyone: add/reorder/edit queue, control mixer/decks (MVP)
* Rate limiting:

  * continuous events per second cap
  * discrete spam caps (pads later)
* Validate every event server-side (bounds + schema)
  **Acceptance**
* Malformed events rejected without crashing the room
* Slider spam doesn’t DDoS other clients
  **Files**
* `/apps/realtime/src/security/limits.ts`
* `/apps/realtime/src/security/validate.ts`

## PR 5.3 — Deployment + observability (Dev B)

**Objective:** production-ready deploys + basic monitoring.
**Scope**

* Deploy frontend + realtime backend
* Add structured logs, request ids, room ids in logs
* Health endpoints + uptime check
* Basic metrics (room count, events/sec, avg RTT)
  **Acceptance**
* Staging + prod environments exist
* Can watch logs for a specific room during a session
  **Files**
* `/apps/realtime/src/observability/logger.ts`
* `deploy/*` (depending on platform)

---

# Phase 6 — MVP polish + “viral” (optional but high leverage)

## PR 6.1 — Waveform + jog (simple) (Dev A)

**Objective:** make decks feel like decks.
**Scope**

* Render basic waveform (canvas) per deck (decoded peaks)
* Jog wheel:

  * nudges playhead (seek small increments)
  * optional scratch-lite (MVP can be nudge-only)
    **Acceptance**
* Waveform shows and updates playhead position
* Jogging updates playhead locally and reconciles remotely
  **Files**
* `/apps/web/src/audio/waveform/peaks.ts`
* `/apps/web/src/components/Waveform.tsx`

## PR 6.2 — Soundboard pads (viral add-on) (Dev A + Dev B split)

**Objective:** shareable/funny moments; simple to sync.
**Scope (Dev B)**

* New discrete event: PAD_TRIGGER(pad_id)
* Rate limit + ack
  **Scope (Dev A)**
* 8–16 pads UI + keyboard mapping
* One-shot audio playback (not routed through deck graph unless you want)
* Highlight animation on trigger
  **Acceptance**
* Pad triggers are synchronized (everyone hears within reason)
* Keyboard triggers work + show highlight
  **Files**
* shared event schema update
* `/apps/web/src/components/Soundboard.tsx`

---

# Recommended PR ordering + concurrency map

## Merge gates (must land before many others)

1. PR 0.1 (repo/CI)
2. PR 0.2 (schemas)
   After that, Dev A and Dev B can sprint mostly independently.

## Dev B lane (backend/infra)

* PR 1.1 → 1.2 → 1.3 → 1.4
* PR 4.1 → 4.3
* PR 3.1
* PR 5.1 → 5.2 → 5.3

## Dev A lane (client/audio)

* PR 0.3 → 2.1 → 2.2 → 2.3 → 2.4
* PR 3.2 → 3.3 → 3.4
* PR 4.2
* PR 6.1 (optional) → 6.2 (optional)

## Critical integration checkpoints

* After PR 1.1 + PR 2.2: realtime room works end-to-end
* After PR 1.3 + PR 2.3: queue is truly shared
* After PR 4.1 + PR 4.2: sync is “real”
* After PR 5.1: reconnect criterion satisfied

---

# PR template (copy/paste into each PR)

## Objective

## Scope (what changes)

## Non-scope (explicitly not doing)

## Implementation notes

## Tests

## Acceptance checklist

* [ ] …

## Rollout / flags

## Screenshots / clips (if UI)

---

# MVP acceptance checklist (global)

* [ ] Two users join same room; see cursors
* [ ] Queue add/reorder/edit stays consistent for both
* [ ] Load same track to Deck A from queue
* [ ] Press play; stay in sync (typical <40ms drift; correction works)
* [ ] Move crossfader/EQ/faders; changes visible live and audible locally
* [ ] Disconnect/reconnect doesn’t lose room state

If you want, I can also generate a matching folder skeleton (exact filenames) and the canonical control_id map (so ownership + highlighting never gets messy).
