/**
 * Event schemas for the Virtual DJ Rooms realtime protocol.
 *
 * Events flow:
 * 1. Client sends event to server
 * 2. Server validates, applies to state, assigns server_ts + event_id
 * 3. Server broadcasts to all room members (including sender for ack)
 *
 * Event metadata:
 * - room_id: which room this event belongs to
 * - event_id: unique ID assigned by server
 * - client_id: who sent the event
 * - client_seq: client-side sequence number for deduplication
 * - server_ts: when server processed the event
 */

import { z } from "zod";
import {
  ClientIdSchema,
  RoomIdSchema,
  EventIdSchema,
  TrackIdSchema,
  ControlIdSchema,
  DeckIdSchema,
  FxTypeSchema,
  RoomStateSchema,
} from "./state.js";

// ============================================================================
// Event Metadata
// ============================================================================

/** Base metadata for all events (client-side, before server processing) */
export const ClientEventMetaSchema = z.object({
  roomId: RoomIdSchema,
  clientId: ClientIdSchema,
  /** Client-side sequence number for deduplication/ordering */
  clientSeq: z.number().int().nonnegative(),
});
export type ClientEventMeta = z.infer<typeof ClientEventMetaSchema>;

/** Full metadata after server processing */
export const ServerEventMetaSchema = ClientEventMetaSchema.extend({
  /** Server-assigned unique event ID */
  eventId: EventIdSchema,
  /** Server timestamp when event was processed */
  serverTs: z.number(),
  /** Room version after this event was applied */
  version: z.number().int().nonnegative(),
});
export type ServerEventMeta = z.infer<typeof ServerEventMetaSchema>;

// ============================================================================
// Cursor Events
// ============================================================================

export const CursorMovePayloadSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type CursorMovePayload = z.infer<typeof CursorMovePayloadSchema>;

export const CursorMoveEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("CURSOR_MOVE"),
  payload: CursorMovePayloadSchema,
});
export type CursorMoveEvent = z.infer<typeof CursorMoveEventSchema>;

// ============================================================================
// Control Ownership Events
// ============================================================================

export const ControlGrabPayloadSchema = z.object({
  controlId: ControlIdSchema,
});
export type ControlGrabPayload = z.infer<typeof ControlGrabPayloadSchema>;

export const ControlGrabEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("CONTROL_GRAB"),
  payload: ControlGrabPayloadSchema,
});
export type ControlGrabEvent = z.infer<typeof ControlGrabEventSchema>;

export const ControlReleasePayloadSchema = z.object({
  controlId: ControlIdSchema,
});
export type ControlReleasePayload = z.infer<typeof ControlReleasePayloadSchema>;

export const ControlReleaseEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("CONTROL_RELEASE"),
  payload: ControlReleasePayloadSchema,
});
export type ControlReleaseEvent = z.infer<typeof ControlReleaseEventSchema>;

// ============================================================================
// Mixer Events
// ============================================================================

/** Union of all mixer control values that can be set */
export const MixerSetPayloadSchema = z.object({
  controlId: ControlIdSchema,
  value: z.number(),
});
export type MixerSetPayload = z.infer<typeof MixerSetPayloadSchema>;

export const MixerSetEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("MIXER_SET"),
  payload: MixerSetPayloadSchema,
});
export type MixerSetEvent = z.infer<typeof MixerSetEventSchema>;

// ============================================================================
// Deck Events
// ============================================================================

export const DeckLoadPayloadSchema = z.object({
  deckId: DeckIdSchema,
  trackId: TrackIdSchema,
  queueItemId: z.string().min(1),
});
export type DeckLoadPayload = z.infer<typeof DeckLoadPayloadSchema>;

export const DeckLoadEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_LOAD"),
  payload: DeckLoadPayloadSchema,
});
export type DeckLoadEvent = z.infer<typeof DeckLoadEventSchema>;

export const DeckPlayPayloadSchema = z.object({
  deckId: DeckIdSchema,
});
export type DeckPlayPayload = z.infer<typeof DeckPlayPayloadSchema>;

export const DeckPlayEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_PLAY"),
  payload: DeckPlayPayloadSchema,
});
export type DeckPlayEvent = z.infer<typeof DeckPlayEventSchema>;

export const DeckPausePayloadSchema = z.object({
  deckId: DeckIdSchema,
});
export type DeckPausePayload = z.infer<typeof DeckPausePayloadSchema>;

export const DeckPauseEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_PAUSE"),
  payload: DeckPausePayloadSchema,
});
export type DeckPauseEvent = z.infer<typeof DeckPauseEventSchema>;

export const DeckCuePayloadSchema = z.object({
  deckId: DeckIdSchema,
  /** If provided, sets a new cue point. Otherwise, jumps to existing cue. */
  cuePointSec: z.number().nonnegative().optional(),
});
export type DeckCuePayload = z.infer<typeof DeckCuePayloadSchema>;

export const DeckCueEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_CUE"),
  payload: DeckCuePayloadSchema,
});
export type DeckCueEvent = z.infer<typeof DeckCueEventSchema>;

export const DeckSeekPayloadSchema = z.object({
  deckId: DeckIdSchema,
  positionSec: z.number().nonnegative(),
});
export type DeckSeekPayload = z.infer<typeof DeckSeekPayloadSchema>;

export const DeckSeekEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_SEEK"),
  payload: DeckSeekPayloadSchema,
});
export type DeckSeekEvent = z.infer<typeof DeckSeekEventSchema>;

export const DeckTempoSetPayloadSchema = z.object({
  deckId: DeckIdSchema,
  /** Playback rate (0.92 to 1.08 for ±8% tempo range) */
  playbackRate: z.number().min(0.5).max(2.0),
});
export type DeckTempoSetPayload = z.infer<typeof DeckTempoSetPayloadSchema>;

export const DeckTempoSetEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("DECK_TEMPO_SET"),
  payload: DeckTempoSetPayloadSchema,
});
export type DeckTempoSetEvent = z.infer<typeof DeckTempoSetEventSchema>;

// ============================================================================
// Queue Events
// ============================================================================

export const QueueAddPayloadSchema = z.object({
  trackId: TrackIdSchema,
  title: z.string(),
  durationSec: z.number().nonnegative(),
  /** Optional: insert at specific position (0 = top). Default: end */
  insertAt: z.number().int().nonnegative().optional(),
  /** Server-generated queue item ID (included in mutation events) */
  queueItemId: z.string().min(1).optional(),
});
export type QueueAddPayload = z.infer<typeof QueueAddPayloadSchema>;

export const QueueAddEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("QUEUE_ADD"),
  payload: QueueAddPayloadSchema,
});
export type QueueAddEvent = z.infer<typeof QueueAddEventSchema>;

export const QueueRemovePayloadSchema = z.object({
  queueItemId: z.string().min(1),
});
export type QueueRemovePayload = z.infer<typeof QueueRemovePayloadSchema>;

export const QueueRemoveEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("QUEUE_REMOVE"),
  payload: QueueRemovePayloadSchema,
});
export type QueueRemoveEvent = z.infer<typeof QueueRemoveEventSchema>;

export const QueueReorderPayloadSchema = z.object({
  queueItemId: z.string().min(1),
  /** New position index */
  newIndex: z.number().int().nonnegative(),
});
export type QueueReorderPayload = z.infer<typeof QueueReorderPayloadSchema>;

export const QueueReorderEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("QUEUE_REORDER"),
  payload: QueueReorderPayloadSchema,
});
export type QueueReorderEvent = z.infer<typeof QueueReorderEventSchema>;

export const QueueEditPayloadSchema = z.object({
  queueItemId: z.string().min(1),
  /** Fields to update */
  updates: z.object({
    title: z.string().optional(),
  }),
});
export type QueueEditPayload = z.infer<typeof QueueEditPayloadSchema>;

export const QueueEditEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("QUEUE_EDIT"),
  payload: QueueEditPayloadSchema,
});
export type QueueEditEvent = z.infer<typeof QueueEditEventSchema>;

// ============================================================================
// FX Events
// ============================================================================

export const FxSetPayloadSchema = z.object({
  /** Which FX parameter: "type", "wetDry", "param" */
  param: z.enum(["type", "wetDry", "param"]),
  value: z.union([FxTypeSchema, z.number()]),
});
export type FxSetPayload = z.infer<typeof FxSetPayloadSchema>;

export const FxSetEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("FX_SET"),
  payload: FxSetPayloadSchema,
});
export type FxSetEvent = z.infer<typeof FxSetEventSchema>;

export const FxTogglePayloadSchema = z.object({
  enabled: z.boolean(),
});
export type FxTogglePayload = z.infer<typeof FxTogglePayloadSchema>;

export const FxToggleEventSchema = ClientEventMetaSchema.extend({
  type: z.literal("FX_TOGGLE"),
  payload: FxTogglePayloadSchema,
});
export type FxToggleEvent = z.infer<typeof FxToggleEventSchema>;

// ============================================================================
// Server → Client Events
// ============================================================================

/** Deck state for sync tick (subset of full state) */
export const SyncTickDeckStateSchema = z.object({
  deckId: DeckIdSchema,
  loadedTrackId: z.string().nullable(),
  playState: z.enum(["stopped", "playing", "paused", "cued"]),
  serverStartTime: z.number().nullable(),
  playheadSec: z.number().nonnegative(),
});
export type SyncTickDeckState = z.infer<typeof SyncTickDeckStateSchema>;

export const SyncTickPayloadSchema = z.object({
  /** Server timestamp when this tick was generated */
  serverTs: z.number(),
  /** Current room version */
  version: z.number().int().nonnegative(),
  /** Deck A state */
  deckA: SyncTickDeckStateSchema,
  /** Deck B state */
  deckB: SyncTickDeckStateSchema,
});
export type SyncTickPayload = z.infer<typeof SyncTickPayloadSchema>;

export const SyncTickEventSchema = z.object({
  type: z.literal("SYNC_TICK"),
  roomId: RoomIdSchema,
  payload: SyncTickPayloadSchema,
});
export type SyncTickEvent = z.infer<typeof SyncTickEventSchema>;

/** Full room snapshot sent on join */
export const RoomSnapshotEventSchema = z.object({
  type: z.literal("ROOM_SNAPSHOT"),
  roomId: RoomIdSchema,
  /** Server timestamp when snapshot was taken */
  serverTs: z.number(),
  /** Full room state */
  state: RoomStateSchema,
});
export type RoomSnapshotEvent = z.infer<typeof RoomSnapshotEventSchema>;

/** Time sync pong response */
export const TimePongEventSchema = z.object({
  type: z.literal("TIME_PONG"),
  /** Original client timestamp from TIME_PING */
  t0: z.number(),
  /** Server timestamp */
  serverTs: z.number(),
});
export type TimePongEvent = z.infer<typeof TimePongEventSchema>;

/** Member joined notification */
export const MemberJoinedEventSchema = z.object({
  type: z.literal("MEMBER_JOINED"),
  roomId: RoomIdSchema,
  serverTs: z.number(),
  payload: z.object({
    clientId: ClientIdSchema,
    name: z.string(),
    color: z.string(),
    isHost: z.boolean(),
  }),
});
export type MemberJoinedEvent = z.infer<typeof MemberJoinedEventSchema>;

/** Member left notification */
export const MemberLeftEventSchema = z.object({
  type: z.literal("MEMBER_LEFT"),
  roomId: RoomIdSchema,
  serverTs: z.number(),
  payload: z.object({
    clientId: ClientIdSchema,
  }),
});
export type MemberLeftEvent = z.infer<typeof MemberLeftEventSchema>;

/** Event acknowledgment from server */
export const EventAckSchema = z.object({
  type: z.literal("EVENT_ACK"),
  /** The client's sequence number being acknowledged */
  clientSeq: z.number().int().nonnegative(),
  /** Server-assigned event ID */
  eventId: EventIdSchema,
  /** Whether the event was accepted */
  accepted: z.boolean(),
  /** Error message if rejected */
  error: z.string().optional(),
});
export type EventAck = z.infer<typeof EventAckSchema>;

// ============================================================================
// Client → Server Events (requests)
// ============================================================================

/** Time sync ping request */
export const TimePingEventSchema = z.object({
  type: z.literal("TIME_PING"),
  /** Client timestamp when ping was sent */
  t0: z.number(),
});
export type TimePingEvent = z.infer<typeof TimePingEventSchema>;

/** Join room request */
export const JoinRoomEventSchema = z.object({
  type: z.literal("JOIN_ROOM"),
  roomCode: z.string().min(4).max(8),
  name: z.string().min(1).max(32),
});
export type JoinRoomEvent = z.infer<typeof JoinRoomEventSchema>;

/** Create room request */
export const CreateRoomEventSchema = z.object({
  type: z.literal("CREATE_ROOM"),
  name: z.string().min(1).max(32),
});
export type CreateRoomEvent = z.infer<typeof CreateRoomEventSchema>;

/** Leave room request */
export const LeaveRoomEventSchema = z.object({
  type: z.literal("LEAVE_ROOM"),
  roomId: RoomIdSchema,
});
export type LeaveRoomEvent = z.infer<typeof LeaveRoomEventSchema>;

// ============================================================================
// Union Types
// ============================================================================

/** All client → server state mutation events */
export const ClientMutationEventSchema = z.discriminatedUnion("type", [
  CursorMoveEventSchema,
  ControlGrabEventSchema,
  ControlReleaseEventSchema,
  MixerSetEventSchema,
  DeckLoadEventSchema,
  DeckPlayEventSchema,
  DeckPauseEventSchema,
  DeckCueEventSchema,
  DeckSeekEventSchema,
  DeckTempoSetEventSchema,
  QueueAddEventSchema,
  QueueRemoveEventSchema,
  QueueReorderEventSchema,
  QueueEditEventSchema,
  FxSetEventSchema,
  FxToggleEventSchema,
]);
export type ClientMutationEvent = z.infer<typeof ClientMutationEventSchema>;

/** All client → server events (including non-mutations) */
export const ClientEventSchema = z.union([
  ClientMutationEventSchema,
  TimePingEventSchema,
  JoinRoomEventSchema,
  CreateRoomEventSchema,
  LeaveRoomEventSchema,
]);
export type ClientEvent = z.infer<typeof ClientEventSchema>;

/** All server → client events */
export const ServerEventSchema = z.discriminatedUnion("type", [
  SyncTickEventSchema,
  RoomSnapshotEventSchema,
  TimePongEventSchema,
  MemberJoinedEventSchema,
  MemberLeftEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;

/** Server-processed mutation events (with full metadata) */
export const ServerMutationEventSchema = z.intersection(
  ServerEventMetaSchema,
  z.union([
    z.object({ type: z.literal("CURSOR_MOVE"), payload: CursorMovePayloadSchema }),
    z.object({ type: z.literal("CONTROL_GRAB"), payload: ControlGrabPayloadSchema }),
    z.object({ type: z.literal("CONTROL_RELEASE"), payload: ControlReleasePayloadSchema }),
    z.object({ type: z.literal("MIXER_SET"), payload: MixerSetPayloadSchema }),
    z.object({ type: z.literal("DECK_LOAD"), payload: DeckLoadPayloadSchema }),
    z.object({ type: z.literal("DECK_PLAY"), payload: DeckPlayPayloadSchema }),
    z.object({ type: z.literal("DECK_PAUSE"), payload: DeckPausePayloadSchema }),
    z.object({ type: z.literal("DECK_CUE"), payload: DeckCuePayloadSchema }),
    z.object({ type: z.literal("DECK_SEEK"), payload: DeckSeekPayloadSchema }),
    z.object({ type: z.literal("DECK_TEMPO_SET"), payload: DeckTempoSetPayloadSchema }),
    z.object({ type: z.literal("QUEUE_ADD"), payload: QueueAddPayloadSchema }),
    z.object({ type: z.literal("QUEUE_REMOVE"), payload: QueueRemovePayloadSchema }),
    z.object({ type: z.literal("QUEUE_REORDER"), payload: QueueReorderPayloadSchema }),
    z.object({ type: z.literal("QUEUE_EDIT"), payload: QueueEditPayloadSchema }),
    z.object({ type: z.literal("FX_SET"), payload: FxSetPayloadSchema }),
    z.object({ type: z.literal("FX_TOGGLE"), payload: FxTogglePayloadSchema }),
  ])
);
export type ServerMutationEvent = z.infer<typeof ServerMutationEventSchema>;

// ============================================================================
// Event Type Constants
// ============================================================================

/** All mutation event types */
export const MUTATION_EVENT_TYPES = [
  "CURSOR_MOVE",
  "CONTROL_GRAB",
  "CONTROL_RELEASE",
  "MIXER_SET",
  "DECK_LOAD",
  "DECK_PLAY",
  "DECK_PAUSE",
  "DECK_CUE",
  "DECK_SEEK",
  "DECK_TEMPO_SET",
  "QUEUE_ADD",
  "QUEUE_REMOVE",
  "QUEUE_REORDER",
  "QUEUE_EDIT",
  "FX_SET",
  "FX_TOGGLE",
] as const;

/** Continuous events (high-frequency, last-write-wins) */
export const CONTINUOUS_EVENT_TYPES = ["CURSOR_MOVE", "MIXER_SET"] as const;

/** Discrete events (require acks, must not be dropped) */
export const DISCRETE_EVENT_TYPES = [
  "CONTROL_GRAB",
  "CONTROL_RELEASE",
  "DECK_LOAD",
  "DECK_PLAY",
  "DECK_PAUSE",
  "DECK_CUE",
  "DECK_SEEK",
  "DECK_TEMPO_SET",
  "QUEUE_ADD",
  "QUEUE_REMOVE",
  "QUEUE_REORDER",
  "QUEUE_EDIT",
  "FX_SET",
  "FX_TOGGLE",
] as const;
