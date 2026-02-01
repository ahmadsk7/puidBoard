/**
 * Socket.IO client wrapper for the realtime protocol.
 * Handles connection, reconnection, snapshot handling, and event streaming.
 */

import { io, Socket } from "socket.io-client";
import type {
  RoomState,
  ClientMutationEvent,
  RoomSnapshotEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
  TimePongEvent,
  Member,
  DeckId,
} from "@puid-board/shared";
import {
  processPong,
  calculateDriftCorrection,
  resetDriftState,
  resetClockSync,
} from "../audio/sync";
import { getDeck } from "../audio/useDeck";

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

/** Time between ping requests (ms) */
const PING_INTERVAL_MS = 2000;

/** Reconnection settings */
const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RealtimeClientListener = (state: RoomState | null) => void;
export type StatusListener = (status: ConnectionStatus) => void;
export type LatencyListener = (latencyMs: number) => void;
export type ErrorListener = (error: { type: string; message: string }) => void;

/**
 * Realtime client for connecting to the server.
 * Manages socket lifecycle, room state, and event streaming.
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private state: RoomState | null = null;
  private clientId: string | null = null;
  private latencyMs = 0;
  private status: ConnectionStatus = "disconnected";
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private stateListeners = new Set<RealtimeClientListener>();
  private statusListeners = new Set<StatusListener>();
  private latencyListeners = new Set<LatencyListener>();
  private errorListeners = new Set<ErrorListener>();

  /** Pending room to rejoin on reconnect */
  private pendingRejoin: { roomCode: string; name: string } | null = null;

  getState(): RoomState | null {
    return this.state;
  }

  getClientId(): string | null {
    return this.clientId;
  }

  getLatencyMs(): number {
    return this.latencyMs;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Subscribe to state changes */
  onStateChange(listener: RealtimeClientListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to connection status changes */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribe to latency updates */
  onLatencyChange(listener: LatencyListener): () => void {
    this.latencyListeners.add(listener);
    return () => this.latencyListeners.delete(listener);
  }

  /** Subscribe to errors */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Connect to the realtime server */
  connect(): void {
    if (this.socket?.connected) return;

    this.setStatus("connecting");

    this.socket = io(REALTIME_URL, {
      reconnection: true,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      transports: ["websocket", "polling"],
    });

    this.registerSocketHandlers();
  }

  /** Disconnect from the server */
  disconnect(): void {
    this.stopPing();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.state = null;
    this.clientId = null;
    this.pendingRejoin = null;
    this.setStatus("disconnected");
    this.notifyStateListeners();

    // Reset sync state on disconnect
    resetClockSync();
    resetDriftState("A");
    resetDriftState("B");
  }

  /** Create a new room */
  createRoom(name: string): void {
    if (!this.socket?.connected) {
      this.emitError({ type: "NOT_CONNECTED", message: "Not connected to server" });
      return;
    }
    // Leave any existing room first
    if (this.state) {
      this.socket.emit("LEAVE_ROOM", { type: "LEAVE_ROOM", roomId: this.state.roomId });
      this.state = null;
    }
    this.pendingRejoin = { roomCode: "", name }; // Will be set on snapshot
    this.socket.emit("CREATE_ROOM", { type: "CREATE_ROOM", name });
  }

  /** Join an existing room by code */
  joinRoom(roomCode: string, name: string): void {
    if (!this.socket?.connected) {
      this.emitError({ type: "NOT_CONNECTED", message: "Not connected to server" });
      return;
    }
    // Leave any existing room first
    if (this.state) {
      this.socket.emit("LEAVE_ROOM", { type: "LEAVE_ROOM", roomId: this.state.roomId });
      this.state = null;
    }
    this.pendingRejoin = { roomCode, name };
    this.socket.emit("JOIN_ROOM", { type: "JOIN_ROOM", roomCode, name });
  }

  /** Leave the current room */
  leaveRoom(): void {
    if (!this.socket?.connected) return;
    if (this.state) {
      this.socket.emit("LEAVE_ROOM", { type: "LEAVE_ROOM", roomId: this.state.roomId });
    }
    this.state = null;
    this.pendingRejoin = null;
    this.notifyStateListeners();
  }

  /** Reset client state (useful when navigating to a new room) */
  resetState(): void {
    this.state = null;
    this.notifyStateListeners();
  }

  /** Check if currently in a room */
  isInRoom(): boolean {
    return this.state !== null;
  }

  /** Send a client mutation event */
  sendEvent(event: ClientMutationEvent): void {
    if (!this.socket?.connected) {
      console.warn("[RealtimeClient] sendEvent: socket not connected, dropping event:", event.type);
      return;
    }
    console.log(`[RealtimeClient] sendEvent: ${event.type}`, event);
    this.socket.emit(event.type, event);
  }

  private registerSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("[RealtimeClient] connected");
      this.setStatus("connected");
      this.startPing();

      // Rejoin room if we had one before disconnect
      if (this.pendingRejoin && this.pendingRejoin.roomCode) {
        this.socket?.emit("JOIN_ROOM", {
          type: "JOIN_ROOM",
          roomCode: this.pendingRejoin.roomCode,
          name: this.pendingRejoin.name,
        });
      }
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[RealtimeClient] disconnected:", reason);
      this.setStatus("disconnected");
      this.stopPing();
    });

    this.socket.on("connect_error", (error) => {
      console.log("[RealtimeClient] connect_error:", error.message);
      this.setStatus("disconnected");
    });

    this.socket.on("CLIENT_ID", (data: { clientId: string }) => {
      this.clientId = data.clientId;
      // Notify state listeners so the UI can update with the new clientId
      // This is important because ROOM_SNAPSHOT might arrive before CLIENT_ID
      this.notifyStateListeners();
    });

    this.socket.on("ROOM_SNAPSHOT", (event: RoomSnapshotEvent) => {
      this.state = event.state;
      // Update pending rejoin with actual room code
      if (this.pendingRejoin) {
        this.pendingRejoin.roomCode = event.state.roomCode;
      }
      this.notifyStateListeners();
    });

    this.socket.on("MEMBER_JOINED", (event: MemberJoinedEvent) => {
      if (!this.state) return;
      const newMember: Member = {
        clientId: event.payload.clientId,
        name: event.payload.name,
        color: event.payload.color,
        isHost: event.payload.isHost,
        joinedAt: event.serverTs,
        cursor: null,
        latencyMs: 0,
      };
      this.state = {
        ...this.state,
        members: [...this.state.members, newMember],
      };
      this.notifyStateListeners();
    });

    this.socket.on("MEMBER_LEFT", (event: MemberLeftEvent) => {
      if (!this.state) return;
      this.state = {
        ...this.state,
        members: this.state.members.filter(
          (m) => m.clientId !== event.payload.clientId
        ),
      };
      this.notifyStateListeners();
    });

    // Handle cursor updates from other members
    this.socket.on("CURSOR_UPDATE", (event: { roomId: string; clientId: string; cursor: { x: number; y: number; lastUpdated: number } }) => {
      if (!this.state) return;
      this.state = {
        ...this.state,
        members: this.state.members.map((m) =>
          m.clientId === event.clientId
            ? { ...m, cursor: event.cursor }
            : m
        ),
      };
      this.notifyStateListeners();
    });

    this.socket.on("TIME_PONG", (event: TimePongEvent) => {
      const now = Date.now();
      const rtt = now - event.t0;
      this.latencyMs = Math.round(rtt / 2);
      this.notifyLatencyListeners();

      // Process pong for clock synchronization
      processPong(event.t0, event.serverTs);
    });

    // Queue event handlers - update local state when server broadcasts queue changes
    this.socket.on("QUEUE_ADD", (event: {
      roomId: string;
      clientId: string;
      serverTs: number;
      payload: {
        trackId: string;
        title: string;
        durationSec: number;
        queueItemId: string;
        insertAt?: number;
      };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] QUEUE_ADD received:", event.payload);

      const queueItem = {
        id: event.payload.queueItemId,
        trackId: event.payload.trackId,
        title: event.payload.title,
        durationSec: event.payload.durationSec,
        addedBy: event.clientId,
        addedAt: event.serverTs,
        status: "queued" as const,
      };

      const insertAt = event.payload.insertAt ?? this.state.queue.length;
      const newQueue = [...this.state.queue];
      newQueue.splice(insertAt, 0, queueItem);

      this.state = {
        ...this.state,
        queue: newQueue,
      };
      this.notifyStateListeners();
    });

    this.socket.on("QUEUE_REMOVE", (event: {
      roomId: string;
      payload: { queueItemId: string };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] QUEUE_REMOVE received:", event.payload);

      this.state = {
        ...this.state,
        queue: this.state.queue.filter((q) => q.id !== event.payload.queueItemId),
      };
      this.notifyStateListeners();
    });

    this.socket.on("QUEUE_REORDER", (event: {
      roomId: string;
      payload: { queueItemId: string; newIndex: number };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] QUEUE_REORDER received:", event.payload);

      const itemIndex = this.state.queue.findIndex((q) => q.id === event.payload.queueItemId);
      if (itemIndex === -1) return;

      const newQueue = [...this.state.queue];
      const [item] = newQueue.splice(itemIndex, 1);
      if (item) {
        newQueue.splice(event.payload.newIndex, 0, item);
      }

      this.state = {
        ...this.state,
        queue: newQueue,
      };
      this.notifyStateListeners();
    });

    this.socket.on("QUEUE_EDIT", (event: {
      roomId: string;
      payload: { queueItemId: string; updates: { title?: string } };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] QUEUE_EDIT received:", event.payload);

      this.state = {
        ...this.state,
        queue: this.state.queue.map((q) =>
          q.id === event.payload.queueItemId
            ? { ...q, ...event.payload.updates }
            : q
        ),
      };
      this.notifyStateListeners();
    });

    // Deck event handlers
    this.socket.on("DECK_LOAD", (event: {
      roomId: string;
      clientId: string;
      serverTs: number;
      payload: { deckId: "A" | "B"; trackId: string; queueItemId: string };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] DECK_LOAD received:", event.payload);

      const { deckId, trackId, queueItemId } = event.payload;
      const item = this.state.queue.find((q) => q.id === queueItemId);
      if (!item) return;

      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };
      deck.loadedTrackId = trackId;
      deck.loadedQueueItemId = queueItemId;
      deck.playState = "stopped";
      deck.playheadSec = 0;
      deck.cuePointSec = null;
      deck.durationSec = item.durationSec;
      deck.serverStartTime = null;

      const newStatus = deckId === "A" ? "loaded_A" as const : "loaded_B" as const;
      const newQueue = this.state.queue.map((q) =>
        q.id === queueItemId
          ? { ...q, status: newStatus }
          : q
      );

      this.state = {
        ...this.state,
        queue: newQueue,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    this.socket.on("DECK_PLAY", (event: {
      roomId: string;
      serverTs: number;
      payload: { deckId: "A" | "B" };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] DECK_PLAY received:", event.payload);

      const { deckId } = event.payload;
      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };
      deck.playState = "playing";
      deck.serverStartTime = event.serverTs;

      const playingStatus = deckId === "A" ? "playing_A" as const : "playing_B" as const;
      const newQueue = this.state.queue.map((q) =>
        q.id === deck.loadedQueueItemId
          ? { ...q, status: playingStatus }
          : q
      );

      this.state = {
        ...this.state,
        queue: newQueue,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    this.socket.on("DECK_PAUSE", (event: {
      roomId: string;
      payload: { deckId: "A" | "B" };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] DECK_PAUSE received:", event.payload);

      const { deckId } = event.payload;
      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };
      deck.playState = "paused";
      deck.serverStartTime = null;

      this.state = {
        ...this.state,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    this.socket.on("DECK_CUE", (event: {
      roomId: string;
      payload: { deckId: "A" | "B"; cuePointSec?: number };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] DECK_CUE received:", event.payload);

      const { deckId, cuePointSec } = event.payload;
      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };

      if (cuePointSec !== undefined) {
        deck.cuePointSec = cuePointSec;
      }
      if (deck.cuePointSec !== null) {
        deck.playheadSec = deck.cuePointSec;
        deck.playState = "cued";
        deck.serverStartTime = null;
      }

      this.state = {
        ...this.state,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    this.socket.on("DECK_SEEK", (event: {
      roomId: string;
      payload: { deckId: "A" | "B"; positionSec: number };
    }) => {
      if (!this.state) return;

      const { deckId, positionSec } = event.payload;
      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };
      deck.playheadSec = positionSec;

      this.state = {
        ...this.state,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    this.socket.on("DECK_TEMPO_SET", (event: {
      roomId: string;
      clientId: string;
      payload: { deckId: "A" | "B"; playbackRate: number };
    }) => {
      if (!this.state) return;
      console.log("[RealtimeClient] DECK_TEMPO_SET received:", event.payload);

      const { deckId, playbackRate } = event.payload;
      const deck = deckId === "A" ? { ...this.state.deckA } : { ...this.state.deckB };
      deck.playbackRate = playbackRate;

      // Apply to local audio deck as well
      try {
        const localDeck = getDeck(deckId);
        if (localDeck) {
          localDeck.setPlaybackRate(playbackRate);
        }
      } catch (error) {
        console.debug(`[RealtimeClient] Could not apply tempo to local deck:`, error);
      }

      this.state = {
        ...this.state,
        ...(deckId === "A" ? { deckA: deck } : { deckB: deck }),
      };
      this.notifyStateListeners();
    });

    // SYNC_TICK for playback synchronization
    this.socket.on("SYNC_TICK", (event: {
      roomId: string;
      payload: {
        serverTs: number;
        version: number;
        deckA: { deckId: "A"; loadedTrackId: string | null; playState: string; serverStartTime: number | null; playheadSec: number };
        deckB: { deckId: "B"; loadedTrackId: string | null; playState: string; serverStartTime: number | null; playheadSec: number };
      };
    }) => {
      if (!this.state) return;

      const { deckA, deckB } = event.payload;
      this.state = {
        ...this.state,
        deckA: {
          ...this.state.deckA,
          playState: deckA.playState as "stopped" | "playing" | "paused" | "cued",
          serverStartTime: deckA.serverStartTime,
          playheadSec: deckA.playheadSec,
        },
        deckB: {
          ...this.state.deckB,
          playState: deckB.playState as "stopped" | "playing" | "paused" | "cued",
          serverStartTime: deckB.serverStartTime,
          playheadSec: deckB.playheadSec,
        },
      };

      // Apply drift correction for each deck
      this.applyDriftCorrection("A", deckA);
      this.applyDriftCorrection("B", deckB);

      this.notifyStateListeners();
    });

    // Mixer value updates
    // Server sends: { type: "MIXER_VALUE", roomId, controlId, value, clientId }
    this.socket.on("MIXER_VALUE", (event: {
      roomId: string;
      controlId: string;
      value: number;
      clientId: string;
    }) => {
      try {
        if (!this.state) return;

        // Defensive check - server sends controlId directly, not in payload
        const controlId = event.controlId;
        const value = event.value;

        if (typeof controlId !== "string" || typeof value !== "number") {
          console.warn("[RealtimeClient] MIXER_VALUE: invalid event format", event);
          return;
        }

        const mixer = { ...this.state.mixer };

        // Apply value to appropriate mixer control
        if (controlId === "crossfader") mixer.crossfader = value;
        else if (controlId === "masterVolume") mixer.masterVolume = value;
        else if (controlId.startsWith("channelA.")) {
          mixer.channelA = { ...mixer.channelA };
          if (controlId === "channelA.fader") mixer.channelA.fader = value;
          else if (controlId === "channelA.gain") mixer.channelA.gain = value;
          else if (controlId === "channelA.filter") mixer.channelA.filter = value;
          else if (controlId.startsWith("channelA.eq.")) {
            mixer.channelA.eq = { ...mixer.channelA.eq };
            if (controlId === "channelA.eq.low") mixer.channelA.eq.low = value;
            else if (controlId === "channelA.eq.mid") mixer.channelA.eq.mid = value;
            else if (controlId === "channelA.eq.high") mixer.channelA.eq.high = value;
          }
        } else if (controlId.startsWith("channelB.")) {
          mixer.channelB = { ...mixer.channelB };
          if (controlId === "channelB.fader") mixer.channelB.fader = value;
          else if (controlId === "channelB.gain") mixer.channelB.gain = value;
          else if (controlId === "channelB.filter") mixer.channelB.filter = value;
          else if (controlId.startsWith("channelB.eq.")) {
            mixer.channelB.eq = { ...mixer.channelB.eq };
            if (controlId === "channelB.eq.low") mixer.channelB.eq.low = value;
            else if (controlId === "channelB.eq.mid") mixer.channelB.eq.mid = value;
            else if (controlId === "channelB.eq.high") mixer.channelB.eq.high = value;
          }
        }

        this.state = { ...this.state, mixer };
        this.notifyStateListeners();
      } catch (error) {
        console.error("[RealtimeClient] MIXER_VALUE handler error:", error);
      }
    });

    // FX_SET - update FX parameters
    this.socket.on("FX_SET", (event: {
      roomId: string;
      clientId: string;
      serverTs: number;
      payload: {
        param: "type" | "wetDry" | "param";
        value: string | number;
      };
    }) => {
      try {
        if (!this.state) return;
        console.log("[RealtimeClient] FX_SET received:", event.payload);

        const mixer = { ...this.state.mixer };
        mixer.fx = { ...mixer.fx };

        const { param, value } = event.payload;
        if (param === "type") {
          mixer.fx.type = value as "echo" | "reverb" | "filter" | "none";
        } else if (param === "wetDry") {
          mixer.fx.wetDry = value as number;
        } else if (param === "param") {
          mixer.fx.param = value as number;
        }

        this.state = { ...this.state, mixer };
        this.notifyStateListeners();
      } catch (error) {
        console.error("[RealtimeClient] FX_SET handler error:", error);
      }
    });

    // FX_TOGGLE - toggle FX enabled state
    this.socket.on("FX_TOGGLE", (event: {
      roomId: string;
      clientId: string;
      serverTs: number;
      payload: {
        enabled: boolean;
      };
    }) => {
      try {
        if (!this.state) return;
        console.log("[RealtimeClient] FX_TOGGLE received:", event.payload);

        const mixer = { ...this.state.mixer };
        mixer.fx = { ...mixer.fx };
        mixer.fx.enabled = event.payload.enabled;

        this.state = { ...this.state, mixer };
        this.notifyStateListeners();
      } catch (error) {
        console.error("[RealtimeClient] FX_TOGGLE handler error:", error);
      }
    });

    // Control ownership updates
    // Server sends: { type: "CONTROL_OWNERSHIP", roomId, controlId, ownership }
    this.socket.on("CONTROL_OWNERSHIP", (event: {
      roomId: string;
      controlId: string;
      ownership: { clientId: string; acquiredAt: number; lastMovedAt: number } | null;
    }) => {
      try {
        if (!this.state) return;

        const { controlId, ownership } = event;
        const controlOwners = { ...this.state.controlOwners };

        if (ownership) {
          controlOwners[controlId] = ownership;
        } else {
          delete controlOwners[controlId];
        }

        this.state = { ...this.state, controlOwners };
        this.notifyStateListeners();
      } catch (error) {
        console.error("[RealtimeClient] CONTROL_OWNERSHIP handler error:", error);
      }
    });

    this.socket.on("ROOM_LEFT", () => {
      this.state = null;
      this.pendingRejoin = null;
      this.notifyStateListeners();
    });

    this.socket.on("ERROR", (error: { type: string; message: string }) => {
      console.log("[RealtimeClient] error:", error);
      this.emitError(error);
    });
  }

  /**
   * Apply drift correction for a deck based on server sync tick data.
   */
  private applyDriftCorrection(
    deckId: DeckId,
    serverDeckState: {
      loadedTrackId: string | null;
      playState: string;
      serverStartTime: number | null;
      playheadSec: number;
    }
  ): void {
    // Only correct if the deck is playing
    if (serverDeckState.playState !== "playing" || !serverDeckState.serverStartTime) {
      return;
    }

    try {
      const deck = getDeck(deckId);
      const localState = deck.getState();

      // Only correct if local deck is also playing
      if (localState.playState !== "playing") {
        return;
      }

      // Get current local playhead
      const localPlayhead = deck.getCurrentPlayhead();

      // Calculate drift correction
      const correction = calculateDriftCorrection(
        deckId,
        localPlayhead,
        serverDeckState.serverStartTime,
        serverDeckState.playheadSec,
        true // isPlaying
      );

      // Apply correction if needed
      if (correction.applied) {
        if (correction.type === "snap" && correction.snapToSec !== undefined) {
          // Large drift - snap to position with crossfade
          deck.seekSmooth(correction.snapToSec, 50);
          console.log(
            `[sync-${deckId}] Snap correction applied: drift=${correction.driftMs.toFixed(1)}ms -> ${correction.snapToSec.toFixed(2)}s`
          );
        } else if (correction.type === "rate_adjust") {
          // Small drift - adjust playback rate
          deck.setPlaybackRate(correction.playbackRate);
          console.log(
            `[sync-${deckId}] Rate correction applied: drift=${correction.driftMs.toFixed(1)}ms, rate=${correction.playbackRate.toFixed(3)}`
          );
        }
      }
    } catch (error) {
      // Deck may not be initialized yet, ignore
      console.debug(`[sync-${deckId}] Could not apply drift correction:`, error);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit("TIME_PING", { type: "TIME_PING", t0: Date.now() });
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((l) => l(status));
    }
  }

  private notifyStateListeners(): void {
    this.stateListeners.forEach((l) => l(this.state));
  }

  private notifyLatencyListeners(): void {
    this.latencyListeners.forEach((l) => l(this.latencyMs));
  }

  private emitError(error: { type: string; message: string }): void {
    this.errorListeners.forEach((l) => l(error));
  }
}

/** Singleton instance */
let clientInstance: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!clientInstance) {
    clientInstance = new RealtimeClient();
  }
  return clientInstance;
}
