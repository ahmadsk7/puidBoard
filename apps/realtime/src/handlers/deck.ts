/**
 * Deck action handlers for Virtual DJ Rooms.
 *
 * Implements server-authoritative deck control:
 * - DECK_LOAD: Load track into deck
 * - DECK_PLAY: Start playback (assigns server_start_time)
 * - DECK_PAUSE: Pause playback
 * - DECK_CUE: Set/jump to cue point
 * - DECK_SEEK: Seek to position
 *
 * All deck actions are serialized through the server to ensure
 * deterministic, consistent state across all clients.
 */

import type { Server, Socket } from "socket.io";
import {
  DeckLoadEventSchema,
  DeckPlayEventSchema,
  DeckPauseEventSchema,
  DeckCueEventSchema,
  DeckSeekEventSchema,
  type DeckLoadEvent,
  type DeckPlayEvent,
  type DeckPauseEvent,
  type DeckCueEvent,
  type DeckSeekEvent,
  type ServerMutationEvent,
  type DeckId,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";
import { sendAcceptedAck, sendRejectedAck } from "../protocol/ack.js";

/**
 * Get deck from room by deck ID.
 */
function getDeck(room: ReturnType<typeof roomStore.getRoom>, deckId: DeckId) {
  if (!room) return null;
  return deckId === "A" ? room.deckA : room.deckB;
}

/**
 * Handle DECK_LOAD event.
 * Loads a track from the queue into a deck.
 */
export function handleDeckLoad(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = DeckLoadEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[DECK_LOAD] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as DeckLoadEvent;
  const { deckId, trackId, queueItemId } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[DECK_LOAD] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Validate queue item exists
  const queueItem = room.queue.find((item) => item.id === queueItemId);
  if (!queueItem) {
    console.log(`[DECK_LOAD] queue item not found queueItemId=${queueItemId}`);
    sendRejectedAck(socket, event.clientSeq, "", "Queue item not found");
    return;
  }

  // Validate track ID matches
  if (queueItem.trackId !== trackId) {
    console.log(
      `[DECK_LOAD] track ID mismatch expected=${queueItem.trackId} got=${trackId}`
    );
    sendRejectedAck(socket, event.clientSeq, "", "Track ID mismatch");
    return;
  }

  // Get the deck
  const deck = getDeck(room, deckId);
  if (!deck) {
    sendRejectedAck(socket, event.clientSeq, "", "Invalid deck ID");
    return;
  }

  // Update deck state
  deck.loadedTrackId = trackId;
  deck.loadedQueueItemId = queueItemId;
  deck.playState = "stopped";
  deck.serverStartTime = null;
  deck.playheadSec = 0;
  deck.durationSec = queueItem.durationSec;

  // Update queue item status
  queueItem.status = deckId === "A" ? "loaded_A" : "loaded_B";

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "DECK_LOAD",
    payload: { deckId, trackId, queueItemId },
  };

  io.to(room.roomId).emit("DECK_LOAD", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[DECK_LOAD] deck=${deckId} trackId=${trackId} queueItemId=${queueItemId} roomId=${room.roomId}`
  );
}

/**
 * Handle DECK_PLAY event.
 * Starts playback and assigns server_start_time for sync.
 */
export function handleDeckPlay(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = DeckPlayEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[DECK_PLAY] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as DeckPlayEvent;
  const { deckId } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[DECK_PLAY] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Get the deck
  const deck = getDeck(room, deckId);
  if (!deck) {
    sendRejectedAck(socket, event.clientSeq, "", "Invalid deck ID");
    return;
  }

  // Validate deck has a track loaded
  if (!deck.loadedTrackId) {
    console.log(`[DECK_PLAY] no track loaded deck=${deckId}`);
    sendRejectedAck(socket, event.clientSeq, "", "No track loaded");
    return;
  }

  // Assign server start time (critical for sync)
  const serverTs = Date.now();
  deck.serverStartTime = serverTs;
  deck.playState = "playing";

  // Update queue item status
  const queueItem = room.queue.find(
    (item) => item.id === deck.loadedQueueItemId
  );
  if (queueItem) {
    queueItem.status = deckId === "A" ? "playing_A" : "playing_B";
  }

  // Increment version
  room.version++;

  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "DECK_PLAY",
    payload: { deckId },
  };

  io.to(room.roomId).emit("DECK_PLAY", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[DECK_PLAY] deck=${deckId} serverStartTime=${serverTs} playhead=${deck.playheadSec}s roomId=${room.roomId}`
  );
}

/**
 * Handle DECK_PAUSE event.
 * Pauses playback and calculates current playhead position.
 */
export function handleDeckPause(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = DeckPauseEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[DECK_PAUSE] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as DeckPauseEvent;
  const { deckId } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[DECK_PAUSE] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Get the deck
  const deck = getDeck(room, deckId);
  if (!deck) {
    sendRejectedAck(socket, event.clientSeq, "", "Invalid deck ID");
    return;
  }

  // Calculate current playhead if currently playing
  if (deck.playState === "playing" && deck.serverStartTime !== null) {
    const serverTs = Date.now();
    const elapsedSec = (serverTs - deck.serverStartTime) / 1000;
    deck.playheadSec = Math.max(0, deck.playheadSec + elapsedSec);

    // Clamp to track duration if available
    if (deck.durationSec !== null) {
      deck.playheadSec = Math.min(deck.playheadSec, deck.durationSec);
    }
  }

  // Update state
  deck.playState = "paused";
  deck.serverStartTime = null;

  // Update queue item status
  const queueItem = room.queue.find(
    (item) => item.id === deck.loadedQueueItemId
  );
  if (queueItem) {
    queueItem.status = deckId === "A" ? "loaded_A" : "loaded_B";
  }

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "DECK_PAUSE",
    payload: { deckId },
  };

  io.to(room.roomId).emit("DECK_PAUSE", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[DECK_PAUSE] deck=${deckId} playhead=${deck.playheadSec.toFixed(2)}s roomId=${room.roomId}`
  );
}

/**
 * Handle DECK_CUE event.
 * Sets or jumps to cue point.
 */
export function handleDeckCue(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = DeckCueEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[DECK_CUE] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as DeckCueEvent;
  const { deckId, cuePointSec } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[DECK_CUE] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Get the deck
  const deck = getDeck(room, deckId);
  if (!deck) {
    sendRejectedAck(socket, event.clientSeq, "", "Invalid deck ID");
    return;
  }

  // Validate deck has a track loaded
  if (!deck.loadedTrackId) {
    console.log(`[DECK_CUE] no track loaded deck=${deckId}`);
    sendRejectedAck(socket, event.clientSeq, "", "No track loaded");
    return;
  }

  // Set new cue point if provided
  if (cuePointSec !== undefined) {
    // Validate cue point is within track duration
    if (deck.durationSec !== null && cuePointSec > deck.durationSec) {
      console.log(
        `[DECK_CUE] cue point beyond duration cue=${cuePointSec} duration=${deck.durationSec}`
      );
      sendRejectedAck(socket, event.clientSeq, "", "Cue point beyond track duration");
      return;
    }
    deck.cuePointSec = cuePointSec;
  }

  // Jump to cue point
  if (deck.cuePointSec !== null) {
    deck.playheadSec = deck.cuePointSec;
  } else {
    // If no cue point set, default to 0
    deck.playheadSec = 0;
  }

  deck.playState = "cued";
  deck.serverStartTime = null;

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "DECK_CUE",
    payload: { deckId, cuePointSec },
  };

  io.to(room.roomId).emit("DECK_CUE", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[DECK_CUE] deck=${deckId} cuePoint=${deck.cuePointSec}s playhead=${deck.playheadSec}s roomId=${room.roomId}`
  );
}

/**
 * Handle DECK_SEEK event.
 * Seeks to a specific position in the track.
 */
export function handleDeckSeek(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = DeckSeekEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[DECK_SEEK] invalid payload socket=${socket.id}`);
    return;
  }

  const event = parsed.data as DeckSeekEvent;
  const { deckId, positionSec } = event.payload;

  // Get client and room
  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    console.log(`[DECK_SEEK] unauthorized socket=${socket.id}`);
    sendRejectedAck(socket, event.clientSeq, "", "Not in a room");
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) {
    sendRejectedAck(socket, event.clientSeq, "", "Room not found");
    return;
  }

  // Get the deck
  const deck = getDeck(room, deckId);
  if (!deck) {
    sendRejectedAck(socket, event.clientSeq, "", "Invalid deck ID");
    return;
  }

  // Validate deck has a track loaded
  if (!deck.loadedTrackId) {
    console.log(`[DECK_SEEK] no track loaded deck=${deckId}`);
    sendRejectedAck(socket, event.clientSeq, "", "No track loaded");
    return;
  }

  // Validate seek position is within track duration
  if (deck.durationSec !== null && positionSec > deck.durationSec) {
    console.log(
      `[DECK_SEEK] seek beyond duration pos=${positionSec} duration=${deck.durationSec}`
    );
    sendRejectedAck(socket, event.clientSeq, "", "Seek position beyond track duration");
    return;
  }

  // Update playhead
  deck.playheadSec = positionSec;

  // If currently playing, update server start time to maintain sync
  if (deck.playState === "playing") {
    deck.serverStartTime = Date.now();
  }

  // Increment version
  room.version++;

  const serverTs = Date.now();
  const eventId = `${room.roomId}-${room.version}`;

  // Broadcast to all clients in room
  const serverEvent: ServerMutationEvent = {
    eventId,
    serverTs,
    version: room.version,
    roomId: room.roomId,
    clientId: client.clientId,
    clientSeq: event.clientSeq,
    type: "DECK_SEEK",
    payload: { deckId, positionSec },
  };

  io.to(room.roomId).emit("DECK_SEEK", serverEvent);

  // Send ack
  sendAcceptedAck(socket, event.clientSeq, eventId);

  console.log(
    `[DECK_SEEK] deck=${deckId} position=${positionSec.toFixed(2)}s playing=${deck.playState === "playing"} roomId=${room.roomId}`
  );
}

/**
 * Register deck event handlers on a socket.
 */
export function registerDeckHandlers(io: Server, socket: Socket): void {
  socket.on("DECK_LOAD", (data: unknown) => {
    handleDeckLoad(io, socket, data);
  });

  socket.on("DECK_PLAY", (data: unknown) => {
    handleDeckPlay(io, socket, data);
  });

  socket.on("DECK_PAUSE", (data: unknown) => {
    handleDeckPause(io, socket, data);
  });

  socket.on("DECK_CUE", (data: unknown) => {
    handleDeckCue(io, socket, data);
  });

  socket.on("DECK_SEEK", (data: unknown) => {
    handleDeckSeek(io, socket, data);
  });
}
