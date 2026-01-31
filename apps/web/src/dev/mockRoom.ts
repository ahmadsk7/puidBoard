/**
 * Local dev "room simulator" harness (PR 0.3).
 * In-memory RoomState, applies events via shared schema, simulates latency + acks.
 */

import type { RoomState, Member, ClientMutationEvent } from "@puid-board/shared";
import {
  RoomStateSchema,
  createDefaultMixer,
  createDefaultDeck,
  validateClientMutationEvent,
  isValidControlId,
  isValidControlValue,
  queueItemExists,
  isValidReorderIndex,
  canPlayDeck,
  isValidSeekPosition,
} from "@puid-board/shared";
import type { ClientId, RoomId } from "@puid-board/shared";

const MOCK_LATENCY_MS = 50;
const MOCK_CLIENT_ID = "mock-client-1";
const MOCK_MEMBER_COLOR = "#3b82f6";

/** Create initial room state for the mock (single member, empty queue). */
export function createInitialRoomState(
  roomId: RoomId,
  roomCode: string,
  clientId: ClientId = MOCK_CLIENT_ID,
  name: string = "Dev A"
): RoomState {
  const now = Date.now();
  const member: Member = {
    clientId,
    name,
    color: MOCK_MEMBER_COLOR,
    joinedAt: now,
    isHost: true,
    cursor: null,
    latencyMs: 0,
  };
  return RoomStateSchema.parse({
    roomId,
    roomCode: roomCode.slice(0, 8).padEnd(4, "0").slice(0, 8),
    version: 0,
    createdAt: now,
    hostId: clientId,
    members: [member],
    queue: [],
    deckA: createDefaultDeck("A"),
    deckB: createDefaultDeck("B"),
    mixer: createDefaultMixer(),
    controlOwners: {},
  });
}

/** Apply a validated client mutation to state; returns new state (immutable). */
export function applyMutation(
  state: RoomState,
  event: ClientMutationEvent,
  serverTs: number,
  _eventId: string
): RoomState {
  const nextVersion = state.version + 1;
  const base = {
    ...state,
    version: nextVersion,
    members: state.members.map((m) => ({ ...m })),
    queue: state.queue.map((q) => ({ ...q })),
    deckA: { ...state.deckA },
    deckB: { ...state.deckB },
    mixer: {
      ...state.mixer,
      channelA: { ...state.mixer.channelA, eq: { ...state.mixer.channelA.eq } },
      channelB: { ...state.mixer.channelB, eq: { ...state.mixer.channelB.eq } },
      fx: { ...state.mixer.fx },
    },
    controlOwners: { ...state.controlOwners },
  };

  switch (event.type) {
    case "CURSOR_MOVE": {
      const idx = base.members.findIndex((m) => m.clientId === event.clientId);
      if (idx >= 0) {
        const member = base.members[idx];
        if (member) {
          base.members[idx] = {
            ...member,
            cursor: { x: event.payload.x, y: event.payload.y, lastUpdated: serverTs },
          };
        }
      }
      return base;
    }

    case "CONTROL_GRAB": {
      const payload = event.payload;
      if (!isValidControlId(payload.controlId)) return state;
      base.controlOwners[payload.controlId] = {
        clientId: event.clientId,
        acquiredAt: serverTs,
        lastMovedAt: serverTs,
      };
      return base;
    }

    case "CONTROL_RELEASE": {
      const payload = event.payload;
      const next = { ...base.controlOwners };
      delete next[payload.controlId];
      base.controlOwners = next;
      return base;
    }

    case "MIXER_SET": {
      const { controlId, value } = event.payload;
      if (!isValidControlId(controlId) || !isValidControlValue(controlId, value))
        return state;
      setMixerValue(base.mixer, controlId, value);
      return base;
    }

    case "DECK_LOAD": {
      const { deckId, trackId, queueItemId } = event.payload;
      const deck = deckId === "A" ? base.deckA : base.deckB;
      if (!queueItemExists(state, queueItemId)) return state;
      const item = state.queue.find((q) => q.id === queueItemId)!;
      deck.loadedTrackId = trackId;
      deck.loadedQueueItemId = queueItemId;
      deck.playState = "stopped";
      deck.playheadSec = 0;
      deck.cuePointSec = null;
      deck.durationSec = item.durationSec;
      deck.serverStartTime = null;
      return base;
    }

    case "DECK_PLAY": {
      const deck = event.payload.deckId === "A" ? base.deckA : base.deckB;
      if (!canPlayDeck(deck)) return state;
      deck.playState = "playing";
      deck.serverStartTime = serverTs;
      return base;
    }

    case "DECK_PAUSE": {
      const deck = event.payload.deckId === "A" ? base.deckA : base.deckB;
      deck.playState = "paused";
      deck.serverStartTime = null;
      return base;
    }

    case "DECK_CUE": {
      const deck = event.payload.deckId === "A" ? base.deckA : base.deckB;
      if (event.payload.cuePointSec !== undefined) {
        deck.cuePointSec = event.payload.cuePointSec;
      }
      if (deck.cuePointSec !== null) {
        deck.playheadSec = deck.cuePointSec;
        deck.playState = "cued";
        deck.serverStartTime = null;
      }
      return base;
    }

    case "DECK_SEEK": {
      const deck = event.payload.deckId === "A" ? base.deckA : base.deckB;
      if (!isValidSeekPosition(deck, event.payload.positionSec)) return state;
      deck.playheadSec = event.payload.positionSec;
      return base;
    }

    case "QUEUE_ADD": {
      const { trackId, title, durationSec, insertAt } = event.payload;
      const id = `q-${serverTs}-${Math.random().toString(36).slice(2, 9)}`;
      const item = {
        id,
        trackId,
        title,
        durationSec,
        addedBy: event.clientId,
        addedAt: serverTs,
        status: "queued" as const,
      };
      const idx = insertAt ?? base.queue.length;
      base.queue = [...base.queue.slice(0, idx), item, ...base.queue.slice(idx)];
      return base;
    }

    case "QUEUE_REMOVE": {
      base.queue = base.queue.filter((q) => q.id !== event.payload.queueItemId);
      return base;
    }

    case "QUEUE_REORDER": {
      const { queueItemId, newIndex } = event.payload;
      if (!isValidReorderIndex(state, newIndex)) return state;
      const arr = [...base.queue];
      const idx = arr.findIndex((q) => q.id === queueItemId);
      if (idx < 0) return state;
      const [item] = arr.splice(idx, 1);
      if (!item) return base;
      base.queue = [...arr.slice(0, newIndex), item, ...arr.slice(newIndex)];
      return base;
    }

    case "QUEUE_EDIT": {
      const { queueItemId, updates } = event.payload;
      const i = base.queue.findIndex((q) => q.id === queueItemId);
      if (i < 0) return state;
      const existing = base.queue[i];
      if (!existing) return base;
      base.queue[i] = {
        ...existing,
        title: updates.title !== undefined ? updates.title : existing.title,
      };
      return base;
    }

    case "FX_SET": {
      const { param, value } = event.payload;
      if (param === "type") base.mixer.fx.type = value as "echo" | "reverb" | "filter" | "none";
      else if (param === "wetDry") base.mixer.fx.wetDry = value as number;
      else if (param === "param") base.mixer.fx.param = value as number;
      return base;
    }

    case "FX_TOGGLE": {
      base.mixer.fx.enabled = event.payload.enabled;
      return base;
    }

    default:
      return state;
  }
}

function setMixerValue(
  mixer: RoomState["mixer"],
  controlId: string,
  value: number
): void {
  const clamp = (min: number, max: number) => Math.min(max, Math.max(min, value));
  switch (controlId) {
    case "crossfader":
      mixer.crossfader = clamp(0, 1);
      break;
    case "masterVolume":
      mixer.masterVolume = clamp(0, 1);
      break;
    case "channelA.fader":
      mixer.channelA.fader = clamp(0, 1);
      break;
    case "channelA.gain":
      mixer.channelA.gain = clamp(-1, 1);
      break;
    case "channelA.eq.low":
      mixer.channelA.eq.low = clamp(-1, 1);
      break;
    case "channelA.eq.mid":
      mixer.channelA.eq.mid = clamp(-1, 1);
      break;
    case "channelA.eq.high":
      mixer.channelA.eq.high = clamp(-1, 1);
      break;
    case "channelA.filter":
      mixer.channelA.filter = clamp(0, 1);
      break;
    case "channelB.fader":
      mixer.channelB.fader = clamp(0, 1);
      break;
    case "channelB.gain":
      mixer.channelB.gain = clamp(-1, 1);
      break;
    case "channelB.eq.low":
      mixer.channelB.eq.low = clamp(-1, 1);
      break;
    case "channelB.eq.mid":
      mixer.channelB.eq.mid = clamp(-1, 1);
      break;
    case "channelB.eq.high":
      mixer.channelB.eq.high = clamp(-1, 1);
      break;
    case "channelB.filter":
      mixer.channelB.filter = clamp(0, 1);
      break;
    case "fx.wetDry":
      mixer.fx.wetDry = clamp(0, 1);
      break;
    case "fx.param":
      mixer.fx.param = clamp(0, 1);
      break;
    default:
      break;
  }
}

export type MockRoomListener = (state: RoomState) => void;
export type EventAckListener = (args: {
  clientSeq: number;
  eventId: string;
  accepted: boolean;
  error?: string;
}) => void;

/** In-memory mock room: holds state, applies events, simulates latency and acks. */
export class MockRoom {
  private state: RoomState;
  private listeners = new Set<MockRoomListener>();
  private ackListeners = new Set<EventAckListener>();
  private clientSeq = 0;
  private eventIdCounter = 0;

  constructor(initialState: RoomState) {
    this.state = initialState;
  }

  getState(): RoomState {
    return this.state;
  }

  subscribe(listener: MockRoomListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onAck(listener: EventAckListener): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /** Send a client mutation; validate, apply after latency, then ack and notify. */
  sendEvent(event: ClientMutationEvent): void {
    const result = validateClientMutationEvent(event);
    const clientSeq = event.clientSeq;
    const eventId = `mock-${++this.eventIdCounter}`;
    const serverTs = Date.now();

    if (!result.success) {
      setTimeout(() => {
        this.ackListeners.forEach((l) =>
          l({ clientSeq, eventId, accepted: false, error: result.error })
        );
      }, MOCK_LATENCY_MS);
      return;
    }

    setTimeout(() => {
      this.state = applyMutation(this.state, result.data, serverTs, eventId);
      this.ackListeners.forEach((l) =>
        l({ clientSeq, eventId, accepted: true })
      );
      this.listeners.forEach((l) => l(this.state));
    }, MOCK_LATENCY_MS);
  }

  /** Next client sequence number (call before sending). */
  nextClientSeq(): number {
    return ++this.clientSeq;
  }
}
