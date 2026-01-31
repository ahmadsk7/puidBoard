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
} from "@puid-board/shared";

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
    if (!this.socket?.connected) return;
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
