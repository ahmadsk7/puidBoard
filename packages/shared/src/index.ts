/**
 * @puid-board/shared
 *
 * Shared types, schemas, and utilities for Virtual DJ Rooms.
 * This package is the single source of truth for the realtime protocol.
 */

// ============================================================================
// Version
// ============================================================================

export const VERSION = "0.1.0";

// ============================================================================
// Constants
// ============================================================================

/** Throttle rates for various event types */
export const THROTTLE = {
  /** Cursor updates: max 30 per second */
  CURSOR_MS: 33,
  /** Continuous controls (faders, knobs): max 60 per second */
  CONTROL_MS: 16,
} as const;

// ============================================================================
// State Exports
// ============================================================================

export {
  // Primitive schemas
  ClientIdSchema,
  RoomIdSchema,
  TrackIdSchema,
  EventIdSchema,
  ControlIdSchema,
  DeckIdSchema,
  PlayStateSchema,
  QueueItemStatusSchema,
  FxTypeSchema,
  TrackSourceSchema,
  LoadingStageSchema,
  LoadingStateSchema,
  // State schemas
  CursorStateSchema,
  MemberSchema,
  QueueItemSchema,
  DeckStateSchema,
  EqStateSchema,
  ChannelStateSchema,
  FxStateSchema,
  MixerStateSchema,
  ControlOwnershipSchema,
  RoomStateSchema,
  SamplerSlotStateSchema,
  SamplerStateSchema,
  // Factory functions
  createDefaultEq,
  createDefaultChannel,
  createDefaultFx,
  createDefaultMixer,
  createDefaultDeck,
  createDefaultSampler,
} from "./state.js";

export type {
  ClientId,
  RoomId,
  TrackId,
  EventId,
  ControlId,
  DeckId,
  PlayState,
  QueueItemStatus,
  FxType,
  TrackSource,
  LoadingStage,
  LoadingState,
  CursorState,
  Member,
  QueueItem,
  DeckState,
  EqState,
  ChannelState,
  FxState,
  MixerState,
  ControlOwnership,
  RoomState,
  SamplerSlotState,
  SamplerState,
} from "./state.js";

// ============================================================================
// Event Exports
// ============================================================================

export {
  // Metadata schemas
  ClientEventMetaSchema,
  ServerEventMetaSchema,
  // Cursor events
  CursorMovePayloadSchema,
  CursorMoveEventSchema,
  // Control events
  ControlGrabPayloadSchema,
  ControlGrabEventSchema,
  ControlReleasePayloadSchema,
  ControlReleaseEventSchema,
  // Mixer events
  MixerSetPayloadSchema,
  MixerSetEventSchema,
  // Deck events
  DeckLoadPayloadSchema,
  DeckLoadEventSchema,
  DeckPlayPayloadSchema,
  DeckPlayEventSchema,
  DeckPausePayloadSchema,
  DeckPauseEventSchema,
  DeckCuePayloadSchema,
  DeckCueEventSchema,
  DeckSeekPayloadSchema,
  DeckSeekEventSchema,
  DeckTempoSetPayloadSchema,
  DeckTempoSetEventSchema,
  DeckBpmDetectedPayloadSchema,
  DeckBpmDetectedEventSchema,
  // Hot cue events
  DeckHotCueSetPayloadSchema,
  DeckHotCueSetEventSchema,
  // Sampler events
  SamplerPlayPayloadSchema,
  SamplerPlayEventSchema,
  SamplerSoundChangedPayloadSchema,
  SamplerSoundChangedEventSchema,
  // Loop / Roll events
  DeckLoopSetPayloadSchema,
  DeckLoopSetEventSchema,
  DeckRollStartPayloadSchema,
  DeckRollStartEventSchema,
  DeckRollStopPayloadSchema,
  DeckRollStopEventSchema,
  // Queue events
  QueueAddPayloadSchema,
  QueueAddEventSchema,
  QueueRemovePayloadSchema,
  QueueRemoveEventSchema,
  QueueReorderPayloadSchema,
  QueueReorderEventSchema,
  QueueEditPayloadSchema,
  QueueEditEventSchema,
  // FX events
  FxSetPayloadSchema,
  FxSetEventSchema,
  FxTogglePayloadSchema,
  FxToggleEventSchema,
  // Server events
  DeckBeaconPayloadSchema,
  BeaconTickEventSchema,
  RoomSnapshotEventSchema,
  TimePongEventSchema,
  MemberJoinedEventSchema,
  MemberLeftEventSchema,
  EventAckSchema,
  // Client request events
  TimePingEventSchema,
  JoinRoomEventSchema,
  CreateRoomEventSchema,
  LeaveRoomEventSchema,
  RejoinRoomEventSchema,
  // Member rename events
  MemberRenamePayloadSchema,
  MemberRenameEventSchema,
  MemberRenamedEventSchema,
  RoomRejoinSnapshotEventSchema,
  // Union schemas
  ClientMutationEventSchema,
  ClientEventSchema,
  ServerEventSchema,
  ServerMutationEventSchema,
  // Event type constants
  MUTATION_EVENT_TYPES,
  CONTINUOUS_EVENT_TYPES,
  DISCRETE_EVENT_TYPES,
} from "./events.js";

export type {
  ClientEventMeta,
  ServerEventMeta,
  CursorMovePayload,
  CursorMoveEvent,
  ControlGrabPayload,
  ControlGrabEvent,
  ControlReleasePayload,
  ControlReleaseEvent,
  MixerSetPayload,
  MixerSetEvent,
  DeckLoadPayload,
  DeckLoadEvent,
  DeckPlayPayload,
  DeckPlayEvent,
  DeckPausePayload,
  DeckPauseEvent,
  DeckCuePayload,
  DeckCueEvent,
  DeckSeekPayload,
  DeckSeekEvent,
  DeckTempoSetPayload,
  DeckTempoSetEvent,
  DeckBpmDetectedPayload,
  DeckBpmDetectedEvent,
  DeckHotCueSetPayload,
  DeckHotCueSetEvent,
  SamplerPlayPayload,
  SamplerPlayEvent,
  SamplerSoundChangedPayload,
  SamplerSoundChangedEvent,
  DeckLoopSetPayload,
  DeckLoopSetEvent,
  DeckRollStartPayload,
  DeckRollStartEvent,
  DeckRollStopPayload,
  DeckRollStopEvent,
  QueueAddPayload,
  QueueAddEvent,
  QueueRemovePayload,
  QueueRemoveEvent,
  QueueReorderPayload,
  QueueReorderEvent,
  QueueEditPayload,
  QueueEditEvent,
  FxSetPayload,
  FxSetEvent,
  FxTogglePayload,
  FxToggleEvent,
  DeckBeaconPayload,
  BeaconTickEvent,
  RoomSnapshotEvent,
  TimePongEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
  EventAck,
  TimePingEvent,
  JoinRoomEvent,
  CreateRoomEvent,
  LeaveRoomEvent,
  RejoinRoomEvent,
  MemberRenamePayload,
  MemberRenameEvent,
  MemberRenamedEvent,
  RoomRejoinSnapshotEvent,
  ClientMutationEvent,
  ClientEvent,
  ServerEvent,
  ServerMutationEvent,
} from "./events.js";

// ============================================================================
// Validator Exports
// ============================================================================

export {
  VALID_CONTROL_IDS,
  isValidControlId,
  getControlBounds,
  isValidControlValue,
  validateClientMutationEvent,
  validateClientEvent,
  validateServerEvent,
  validateRoomState,
  isValidSeekPosition,
  canPlayDeck,
  queueItemExists,
  isValidReorderIndex,
  isContinuousEvent,
  isDiscreteEvent,
} from "./validators.js";

export type { ValidControlId, ValidationResult } from "./validators.js";

// ============================================================================
// Control ID Exports
// ============================================================================

export {
  // Individual control IDs
  CROSSFADER,
  MASTER_VOLUME,
  CHANNEL_A_FADER,
  CHANNEL_A_GAIN,
  CHANNEL_A_EQ_LOW,
  CHANNEL_A_EQ_MID,
  CHANNEL_A_EQ_HIGH,
  CHANNEL_A_FILTER,
  CHANNEL_B_FADER,
  CHANNEL_B_GAIN,
  CHANNEL_B_EQ_LOW,
  CHANNEL_B_EQ_MID,
  CHANNEL_B_EQ_HIGH,
  CHANNEL_B_FILTER,
  FX_WET_DRY,
  FX_PARAM,
  HEADPHONE_MIX,
  DECK_A_JOG,
  DECK_B_JOG,
  DECK_A_TEMPO,
  DECK_B_TEMPO,
  // Grouped control IDs
  ALL_CONTROL_IDS,
  CHANNEL_A_CONTROLS,
  CHANNEL_B_CONTROLS,
  EQ_CONTROLS,
  CONTINUOUS_CONTROLS,
  // Ownership
  CONTROL_OWNERSHIP_TTL_MS,
} from "./controlIds.js";
