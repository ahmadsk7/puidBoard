/**
 * Apply server mutation events to local RoomState.
 * Used by the realtime client to update state when events are received.
 */

import type { RoomState, ServerMutationEvent } from "@puid-board/shared";
import {
  isValidControlId,
  isValidControlValue,
  queueItemExists,
  isValidReorderIndex,
  canPlayDeck,
  isValidSeekPosition,
} from "@puid-board/shared";

/**
 * Apply a server mutation event to room state.
 * Returns new state (immutable).
 */
export function applyServerEvent(
  state: RoomState,
  event: ServerMutationEvent
): RoomState {
  const base = {
    ...state,
    version: event.version,
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
            cursor: {
              x: event.payload.x,
              y: event.payload.y,
              lastUpdated: event.serverTs,
            },
          };
        }
      }
      return base;
    }

    case "CONTROL_GRAB": {
      const { controlId } = event.payload;
      if (!isValidControlId(controlId)) return state;
      base.controlOwners[controlId] = {
        clientId: event.clientId,
        acquiredAt: event.serverTs,
        lastMovedAt: event.serverTs,
      };
      return base;
    }

    case "CONTROL_RELEASE": {
      const { controlId } = event.payload;
      const next = { ...base.controlOwners };
      delete next[controlId];
      base.controlOwners = next;
      return base;
    }

    case "MIXER_SET": {
      const { controlId, value } = event.payload;
      if (!isValidControlId(controlId) || !isValidControlValue(controlId, value))
        return state;
      setMixerValue(base.mixer, controlId, value);
      // Update lastMovedAt for ownership
      if (base.controlOwners[controlId]) {
        base.controlOwners[controlId] = {
          ...base.controlOwners[controlId],
          lastMovedAt: event.serverTs,
        };
      }
      return base;
    }

    case "DECK_LOAD": {
      const { deckId, trackId, queueItemId } = event.payload;
      const deck = deckId === "A" ? base.deckA : base.deckB;
      if (!queueItemExists(state, queueItemId)) return state;
      const item = state.queue.find((q) => q.id === queueItemId);
      if (!item) return state;
      deck.loadedTrackId = trackId;
      deck.loadedQueueItemId = queueItemId;
      deck.playState = "stopped";
      deck.playheadSec = 0;
      deck.cuePointSec = null;
      deck.durationSec = item.durationSec;
      deck.serverStartTime = null;
      // Update queue item status
      const queueIdx = base.queue.findIndex((q) => q.id === queueItemId);
      if (queueIdx >= 0) {
        const queueItem = base.queue[queueIdx];
        if (queueItem) {
          base.queue[queueIdx] = {
            ...queueItem,
            status: deckId === "A" ? "loaded_A" : "loaded_B",
          };
        }
      }
      return base;
    }

    case "DECK_PLAY": {
      const deck = event.payload.deckId === "A" ? base.deckA : base.deckB;
      if (!canPlayDeck(deck)) return state;
      deck.playState = "playing";
      deck.serverStartTime = event.serverTs;
      // Update queue item status
      if (deck.loadedQueueItemId) {
        const queueIdx = base.queue.findIndex((q) => q.id === deck.loadedQueueItemId);
        if (queueIdx >= 0) {
          const queueItem = base.queue[queueIdx];
          if (queueItem) {
            base.queue[queueIdx] = {
              ...queueItem,
              status: event.payload.deckId === "A" ? "playing_A" : "playing_B",
            };
          }
        }
      }
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
      const id = `q-${event.serverTs}-${Math.random().toString(36).slice(2, 9)}`;
      const item = {
        id,
        trackId,
        title,
        durationSec,
        addedBy: event.clientId,
        addedAt: event.serverTs,
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
      if (param === "type")
        base.mixer.fx.type = value as "echo" | "reverb" | "filter" | "none";
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
