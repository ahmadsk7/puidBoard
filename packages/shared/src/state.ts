/**
 * Canonical state schemas for Virtual DJ Rooms.
 * These are the authoritative definitions - the server maintains this state
 * and clients receive snapshots + apply events.
 */

import { z } from "zod";

// ============================================================================
// Primitives & Common Types
// ============================================================================

/** Unique identifiers */
export const ClientIdSchema = z.string().min(1);
export const RoomIdSchema = z.string().min(1);
export const TrackIdSchema = z.string().min(1);
export const EventIdSchema = z.string().min(1);
export const ControlIdSchema = z.string().min(1);

export type ClientId = z.infer<typeof ClientIdSchema>;
export type RoomId = z.infer<typeof RoomIdSchema>;
export type TrackId = z.infer<typeof TrackIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ControlId = z.infer<typeof ControlIdSchema>;

/** Deck identifier - only two decks in MVP */
export const DeckIdSchema = z.enum(["A", "B"]);
export type DeckId = z.infer<typeof DeckIdSchema>;

/** Play state for a deck */
export const PlayStateSchema = z.enum(["stopped", "playing", "paused", "cued"]);
export type PlayState = z.infer<typeof PlayStateSchema>;

/** Queue item status */
export const QueueItemStatusSchema = z.enum([
  "queued",
  "loaded_A",
  "loaded_B",
  "playing_A",
  "playing_B",
  "played",
]);
export type QueueItemStatus = z.infer<typeof QueueItemStatusSchema>;

/** FX type selector */
export const FxTypeSchema = z.enum(["echo", "reverb", "filter", "none"]);
export type FxType = z.infer<typeof FxTypeSchema>;

// ============================================================================
// Member & Cursor State
// ============================================================================

/** Cursor position for a member */
export const CursorStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  /** Timestamp of last update (client time) */
  lastUpdated: z.number(),
});
export type CursorState = z.infer<typeof CursorStateSchema>;

/** A room member */
export const MemberSchema = z.object({
  clientId: ClientIdSchema,
  /** Display name */
  name: z.string().min(1).max(32),
  /** Assigned color for cursor/highlights (hex) */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** When they joined (server timestamp) */
  joinedAt: z.number(),
  /** Is this the room host? */
  isHost: z.boolean(),
  /** Current cursor state (null if not tracking) */
  cursor: CursorStateSchema.nullable(),
  /** Latency estimate in ms */
  latencyMs: z.number().nonnegative(),
});
export type Member = z.infer<typeof MemberSchema>;

// ============================================================================
// Queue State
// ============================================================================

/** Track source type */
export const TrackSourceSchema = z.enum(["upload", "youtube"]);
export type TrackSource = z.infer<typeof TrackSourceSchema>;

/** Loading stage for YouTube tracks */
export const LoadingStageSchema = z.enum(["idle", "extracting", "downloading", "decoding", "analyzing", "error"]);
export type LoadingStage = z.infer<typeof LoadingStageSchema>;

/** Loading state for YouTube tracks */
export const LoadingStateSchema = z.object({
  stage: LoadingStageSchema,
  progress: z.number().min(0).max(1),
  error: z.string().nullable(),
});
export type LoadingState = z.infer<typeof LoadingStateSchema>;

/** A track in the queue */
export const QueueItemSchema = z.object({
  /** Unique ID for this queue entry */
  id: z.string().min(1),
  /** Reference to the track asset */
  trackId: TrackIdSchema,
  /** Track title (denormalized for display) */
  title: z.string(),
  /** Track duration in seconds */
  durationSec: z.number().nonnegative(),
  /** Track URL for playback (denormalized to avoid backend lookup) */
  url: z.string().url(),
  /** Who added this to the queue */
  addedBy: ClientIdSchema,
  /** When it was added (server timestamp) */
  addedAt: z.number(),
  /** Current status */
  status: QueueItemStatusSchema,
  /** Track source type (upload or youtube) */
  source: TrackSourceSchema.default("upload"),
  /** YouTube video ID (only for youtube source) */
  youtubeVideoId: z.string().nullable().default(null),
  /** Thumbnail URL for display */
  thumbnailUrl: z.string().url().nullable().default(null),
  /** Loading state (for YouTube tracks, client-side only) */
  loading: LoadingStateSchema.optional(),
  /** Pre-loaded audio buffer (client-side only, for YouTube tracks) */
  audioBuffer: z.any().optional(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

// ============================================================================
// Deck State
// ============================================================================

/** State of a single deck */
export const DeckStateSchema = z.object({
  /** Which deck */
  deckId: DeckIdSchema,
  /** Currently loaded track (null if empty) */
  loadedTrackId: TrackIdSchema.nullable(),
  /** Queue item ID that's loaded (null if empty) */
  loadedQueueItemId: z.string().nullable(),
  /** Current play state */
  playState: PlayStateSchema,
  /**
   * Server timestamp when playback started.
   * Used with clock sync to compute expected playhead.
   * Null if not playing.
   * @deprecated Use epochStartTimeMs instead
   */
  serverStartTime: z.number().nullable(),
  /**
   * Playhead position (in seconds) at serverStartTime.
   * For paused/cued states, this is the current position.
   */
  playheadSec: z.number().nonnegative(),
  /** Cue point position in seconds (null if not set) */
  cuePointSec: z.number().nonnegative().nullable(),
  /** Track duration in seconds (null if no track loaded) */
  durationSec: z.number().nonnegative().nullable(),
  /** Playback rate (0.92 to 1.08 for ±8% tempo range, default 1.0) */
  playbackRate: z.number().min(0.5).max(2.0).default(1.0),
  /**
   * Detected BPM from client-side audio analysis.
   * Null if track not loaded or BPM detection failed/incomplete.
   * This is the original detected BPM - actual BPM = detectedBpm * playbackRate.
   */
  detectedBpm: z.number().min(20).max(300).nullable(),
  /**
   * Epoch ID - changes on any discontinuity (play, seek, tempo, scrub).
   * Used to detect stale sync messages and reset PLL.
   */
  epochId: z.string(),
  /**
   * Epoch sequence number - incremented on each beacon tick for playing decks.
   * Used to detect out-of-order or duplicate messages.
   */
  epochSeq: z.number().int().nonnegative(),
  /**
   * Playhead position (in seconds) when this epoch started.
   * Combined with epochStartTimeMs to calculate current position.
   */
  epochStartPlayheadSec: z.number().nonnegative(),
  /**
   * Server timestamp (ms) when this epoch started.
   * Combined with epochStartPlayheadSec to calculate current position.
   */
  epochStartTimeMs: z.number(),
});
export type DeckState = z.infer<typeof DeckStateSchema>;

// ============================================================================
// Mixer State
// ============================================================================

/** 3-band EQ state */
export const EqStateSchema = z.object({
  /** Low frequency gain (-1 to 1, 0 = neutral) */
  low: z.number().min(-1).max(1),
  /** Mid frequency gain (-1 to 1, 0 = neutral) */
  mid: z.number().min(-1).max(1),
  /** High frequency gain (-1 to 1, 0 = neutral) */
  high: z.number().min(-1).max(1),
});
export type EqState = z.infer<typeof EqStateSchema>;

/** Per-channel mixer state */
export const ChannelStateSchema = z.object({
  /** Channel fader position (0 to 1) */
  fader: z.number().min(0).max(1),
  /** Gain/trim adjustment (-1 to 1, 0 = unity) */
  gain: z.number().min(-1).max(1),
  /** 3-band EQ */
  eq: EqStateSchema,
  /** Filter cutoff (0 to 1, 0.5 = neutral/off) */
  filter: z.number().min(0).max(1),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;

/** FX slot state */
export const FxStateSchema = z.object({
  /** Selected effect type */
  type: FxTypeSchema,
  /** Wet/dry mix (0 = dry, 1 = wet) */
  wetDry: z.number().min(0).max(1),
  /** Effect parameter (meaning depends on type) */
  param: z.number().min(0).max(1),
  /** Is the effect enabled? */
  enabled: z.boolean(),
});
export type FxState = z.infer<typeof FxStateSchema>;

/** Full mixer state */
export const MixerStateSchema = z.object({
  /** Crossfader position (0 = full A, 1 = full B) */
  crossfader: z.number().min(0).max(1),
  /** Master volume (0 to 1) */
  masterVolume: z.number().min(0).max(1),
  /** Channel A state */
  channelA: ChannelStateSchema,
  /** Channel B state */
  channelB: ChannelStateSchema,
  /** FX slot (MVP: single FX) */
  fx: FxStateSchema,
});
export type MixerState = z.infer<typeof MixerStateSchema>;

// ============================================================================
// Control Ownership
// ============================================================================

/** Ownership info for a control */
export const ControlOwnershipSchema = z.object({
  /** Who currently owns this control */
  clientId: ClientIdSchema,
  /** When ownership was acquired (server timestamp) */
  acquiredAt: z.number(),
  /** When the control was last moved (server timestamp) */
  lastMovedAt: z.number(),
});
export type ControlOwnership = z.infer<typeof ControlOwnershipSchema>;

// ============================================================================
// Room State (Top Level)
// ============================================================================

/** Complete room state - the authoritative source of truth */
export const RoomStateSchema = z.object({
  /** Room identifier */
  roomId: RoomIdSchema,
  /** Room code for joining (short, human-readable) */
  roomCode: z.string().min(4).max(8),
  /** Monotonically increasing version number */
  version: z.number().int().nonnegative(),
  /** When the room was created (server timestamp) */
  createdAt: z.number(),
  /** Host client ID */
  hostId: ClientIdSchema,
  /** All members currently in the room */
  members: z.array(MemberSchema),
  /** The track queue */
  queue: z.array(QueueItemSchema),
  /** Deck A state */
  deckA: DeckStateSchema,
  /** Deck B state */
  deckB: DeckStateSchema,
  /** Mixer state */
  mixer: MixerStateSchema,
  /**
   * Control ownership map.
   * Key is control ID (e.g., "crossfader", "channelA.fader", "deckA.jog")
   */
  controlOwners: z.record(ControlIdSchema, ControlOwnershipSchema),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

// ============================================================================
// Factory Functions
// ============================================================================

/** Create default EQ state (neutral) */
export function createDefaultEq(): EqState {
  return { low: 0, mid: 0, high: 0 };
}

/** Create default channel state */
export function createDefaultChannel(): ChannelState {
  return {
    fader: 1,
    gain: 0,
    eq: createDefaultEq(),
    filter: 0.5,
  };
}

/** Create default FX state (off) */
export function createDefaultFx(): FxState {
  return {
    type: "none",
    wetDry: 0,
    param: 0.5,
    enabled: false,
  };
}

/** Create default mixer state */
export function createDefaultMixer(): MixerState {
  return {
    crossfader: 0.5,
    masterVolume: 0.8,
    channelA: createDefaultChannel(),
    channelB: createDefaultChannel(),
    fx: createDefaultFx(),
  };
}

/** Create default deck state */
export function createDefaultDeck(deckId: DeckId): DeckState {
  return {
    deckId,
    loadedTrackId: null,
    loadedQueueItemId: null,
    playState: "stopped",
    serverStartTime: null,
    playheadSec: 0,
    cuePointSec: null,
    durationSec: null,
    playbackRate: 1.0,
    detectedBpm: null,
    // Epoch tracking fields
    epochId: crypto.randomUUID(),
    epochSeq: 0,
    epochStartPlayheadSec: 0,
    epochStartTimeMs: Date.now(),
  };
}
