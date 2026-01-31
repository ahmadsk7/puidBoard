## S2

Below is a full PRD for a shared, real-time, single “virtual DJ rig” where the queue is the source of truth and everyone sees each other’s cursor + can manipulate the same controls.

## PRD — Virtual DJ Rooms (Multiplayer Mixer)

## 0) One-liner

A web app where multiple people join a room and collaboratively control one shared DJ mixer + decks in real time, while audio plays locally on each person’s speakers in sync.

## 1) Goals

* Feel like “one physical DJ table” shared across browsers.
* Queue is source of truth: everyone can add/edit/reorder; decks load from it.
* Ultra-responsive UI (mouse feels like a hand).
* Audio stays synchronized across clients (tight enough for a party).
* Easy: create room / join code in <10 seconds.

## 2) Non-Goals (for MVP)

* Streaming copyrighted music from consumer platforms (skip until later).
* Pro-grade DJ features (key analysis, stems, advanced FX chains).
* Perfect sub-10ms sync (unrealistic in consumer networks).

## 3) User Flows

### A) Create Room

1. Landing → “Create Room”
2. Gets room code + share link
3. Room loads with empty queue + default deck state

### B) Join Room

1. Enter room code
2. See mixer + queue + other cursors instantly
3. Audio engine primes (autoplay permission flow)

### C) Core loop

* Add tracks → reorder queue → load to deck → play → mix → next track

## 4) Product Principles (opinionated)

* Authoritative server state for everything that matters.
* Client predicts interactions so controls feel instant.
* Soft control locking so fights are fun, not chaos.
* Queue edits are always consistent and replayable (event log).

## 5) UI Layout (simple + fun)

### Top bar

* Room code (copy)
* “Invite link”
* Latency indicator (green/yellow/red)
* “Autoplay enabled” status
* Optional: voice/chat toggle (later)

### Center: DJ Board (primary)

* Two decks: Deck A (left) and Deck B (right)
* Mixer strip in the middle
* Crossfader at bottom center

### Right side: Queue (source of truth)

* Queue list (drag reorder)
* Each item: title, duration, added by, status (loaded A/B, playing)
* Buttons: “Add track”, “Shuffle”, “Clear” (permissions apply)

### Left side: Library / Add panel

* Search
* Upload / import
* “Soundboard pads” (optional in MVP, but it’s viral)

### Multiplayer cursors

* Everyone’s cursor shown with name tag + color
* When someone grabs a control, show a subtle glow in their color

## 6) DJ Board Controls (what you should ship)

### Deck (per deck)

**Must-have**

* Play / Pause
* Cue (jump to cue point + pause)
* Jog wheel (scratch / nudge)
* Tempo/Pitch slider (+/- 8% for MVP)
* Waveform view (basic)
* Track time elapsed/remaining
* Load button (load selected queue track into this deck)

**Nice-to-have (still simple)**

* Sync (match BPM to other deck)
* Key lock (preserve pitch while changing tempo)
* Loop in/out + loop length (1/2/4/8 beats)
* 4 Hot Cues (A/B/C/D)

### Mixer (center)

**Must-have**

* Crossfader
* Channel faders (A and B volume)
* Gain/Trim knobs (A/B)
* 3-band EQ (Low/Mid/High) per channel
* Master volume
* Headroom indicator / clipping warning

**Nice-to-have**

* Channel filter knob (one knob, feels great)
* VU meters per channel + master

### FX (keep it minimal but satisfying)

* 1 FX slot with selector:

  * Echo
  * Reverb
  * Filter (if not already)
* FX controls:

  * Wet/Dry
  * One parameter knob (echo time / reverb size)
* On/off toggle

### Soundboard Pads (viral add-on)

* 8–16 pads (airhorn, “hey!”, riser, clap)
* Each pad has:

  * Trigger
  * Volume
  * “Stop” if it loops
* Pads fire as “one-shot” events (easy to sync)
* **Keyboard controls (small set):** a small amount of keyboard controls (e.g., airhorn). When a player hits these, it triggers the mapped soundboard control and shows a small highlight animation on the mixer for whatever soundboard control was hit.

## 7) Queue Spec (Source of Truth)

### Queue rules

* Queue is the canonical ordering of what should be played next.
* Decks can only load tracks that exist in the queue (prevents “ghost tracks”).
* Queue supports:

  * Add track
  * Remove track
  * Reorder track
  * Edit metadata (rename, tags)
  * “Mark as next” / “Send to top”
  * “Lock queue” (host-only)

### Queue item state

* queued | loaded_A | loaded_B | playing_A | playing_B | played
* added_by, added_at, duration, source

### Conflict handling

* Server serializes queue operations (single ordered event stream).
* Clients do optimistic UI, then reconcile on server ack.

## 8) Multiplayer Control Model (so it doesn’t feel awful)

### Control “grab” semantics (soft locking)

* When user mouse-down on a knob/fader:

  * They “own” it for 2 seconds since last movement (extend on move)
  * Others can still override, but they’ll see the ownership highlight
* Optional room setting:

  * Co-op mode: soft lock (default)
  * Host mode: hard lock (only one controller)
  * Party mode: no locks (chaos)

### Event priority

* Server is authoritative
* Last-write wins for continuous controls (with smoothing)
* Discrete actions (play/cue/load) are strictly ordered by server timestamp

## 9) Audio + Sync (the part that makes or breaks it)

### Hard stance

Do not stream audio from one user to others.
Each client plays audio locally.

### Sync approach

* Everyone has the same track asset (by ID)
* Server sends:

  * track_id
  * server_start_time
  * initial_playhead_seconds
  * periodic sync_tick updates
* Client:

  * Keeps a local clock offset to server (clock_skew_ms)
  * Computes playhead = (now_server - start_time) + initial_playhead

### Drift correction

* Every ~2s, compare expected playhead vs actual
* If drift small: subtly adjust playbackRate (micro-warp)
* If drift big: snap with short fade to hide artifact

### Prefetch

* Prefetch next 1–2 queue tracks after room join
* Decode in advance (Web Audio decodeAudioData)

## 10) System Architecture

### Clients (Web)

* React + TypeScript
* Web Audio API engine
* Real-time transport: WebSocket
* Rendering:

  * DOM for controls
  * Canvas for waveform + cursors (optional but slick)

### Real-time server (authoritative state)

* Node.js + WebSocket (Socket.io is fine for speed)
* Maintains:

  * Room state (decks, mixer, fx, queue, cursor positions)
  * Event ordering + version numbers
* Broadcasts:

  * State diffs (or event stream) to all clients

### Storage

* Postgres: rooms metadata, users, permissions, track metadata
* Redis: room state cache + pubsub if you scale horizontally
* Object storage (S3-like): uploaded audio assets
* CDN for track delivery

## 11) Room State Model (canonical)

### RoomState (high level)

* room_id
* members[] (id, name, color, role)
* cursors{member_id: {x,y,down,target_control}}
* queue[]
* deckA, deckB
* mixer
* fx
* version (monotonic integer)

### DeckState

* loaded_track_id | null
* play_state: stopped | playing | paused
* cue_point_seconds
* playhead_seconds
* tempo_ratio
* hot_cues[]
* loop{enabled, start, end}

### MixerState

* crossfader (0..1)
* channelA{fader,gain,eq_low,eq_mid,eq_high,filter}
* channelB{...}
* master_volume

## 12) Real-time Protocol (events)

### Event types

* CURSOR_MOVE
* CONTROL_GRAB, CONTROL_RELEASE
* MIXER_SET (crossfader/fader/knob)
* DECK_LOAD
* DECK_PLAY, DECK_PAUSE, DECK_CUE
* DECK_SEEK (jog / scrub)
* QUEUE_ADD, QUEUE_REMOVE, QUEUE_REORDER, QUEUE_EDIT
* FX_SET, FX_TOGGLE
* SYNC_TICK (server → clients)

### Reliability rules

* Discrete events must be acked (retries on loss)
* Continuous controls can be throttled (e.g. 30–60Hz max)

## 13) Permissions / Roles

* Host (created room): can lock queue, kick, set mode
* DJ: can control decks/mixer, edit queue
* Guest: can add to queue, trigger pads (optional)
* Spectator: view only
  MVP can be just Host + Everyone.

## 14) Performance Targets (you should actually enforce)

* UI input → local response: < 16ms (one frame)
* Input → remote visible update: < 120ms typical
* Join room to “ready”: < 3 seconds on decent wifi
* Sync drift between clients: < 40ms typical, < 100ms worst-case (with correction)

## 15) Security / Abuse basics

* Rate-limit events per user (prevent spam sliders)
* Validate all events server-side (no client trust)
* Room codes hard to guess (8+ chars, mixed)
* Optional: signed invite links

## 16) Projects / Workstreams (what you’ll actually build)

### P0 — MVP (2–4 weeks if you move)

1. Frontend UI

   * Mixer + 2 decks + queue
   * Cursor rendering
2. Audio engine

   * Load/decode tracks
   * Mixer routing + EQ + filter
3. Realtime backend

   * Rooms + state store + event ordering
   * Presence + cursor broadcast
4. Track service

   * Upload + metadata
   * CDN delivery
5. Sync

   * Server clock sync + drift correction
6. Polish

   * Autoplay permission UX
   * Mobile “spectator” view (optional)

### P1 — Viral additions

* Soundboard pads
* Party/Host/Co-op modes
* Spectator link
* Session recording (state log + “render later”)

### P2 — Growth / integrations

* Optional platform imports (careful with licensing)
* Public rooms / discovery
* User accounts + profiles

## 17) MVP Acceptance Criteria

* Two users join same room and:

  * See each other’s cursors
  * Edit queue and both stay consistent
  * Load the same track to Deck A
  * Press play and stay audibly in sync
  * Move crossfader and see changes live
* Room survives one user disconnect/reconnect without state loss

## 18) Biggest Risks (and how you avoid them)

* Audio sync feels off → server clock + drift correction from day one
* Control fighting feels bad → soft lock ownership highlight
* Music licensing → start with uploads / free packs; don’t promise Spotify

## 19) Hosting / Deployment (simple)

### Frontend

* **Vercel** for the Next.js/React frontend (fast deploys, global edge, easy env vars).
* Static assets (UI images) served via Vercel CDN automatically.

### Backend (Realtime Server)

* Deploy the Node.js WebSocket server on:

  * **Fly.io** (good for websocket-y apps + regions), or
  * **Render** (simple), or
  * **AWS ECS/Fargate** (more setup, more control).
* Use sticky sessions if you run multiple instances (Socket.io can do this) or ensure all realtime messages route through Redis pubsub.

### Database / Cache

* **Postgres** (managed): Neon / Supabase / RDS.
* **Redis** (managed): Upstash / Redis Cloud (for room state cache + pubsub).

### Track storage + delivery

* **Object storage**: Cloudflare R2 or AWS S3 for uploads.
* **CDN**: Cloudflare (or S3 + CloudFront) to serve audio fast and reduce origin load.

### Domains + TLS

* Cloudflare for DNS + TLS (or keep it on Vercel and add Cloudflare later).

If you want, I can follow this with:

* a pixel-level wireframe (layout + spacing + components), or
* the exact state schema + event schema you hand to engineering, or
* a milestone plan broken into tickets (frontend/backend/audio).
