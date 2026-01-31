"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomState, ClientMutationEvent } from "@puid-board/shared";
import {
  getRealtimeClient,
  RealtimeClient,
  ConnectionStatus,
} from "./client";

export type UseRealtimeRoomOptions = {
  /** Room code to join (if joining existing room) */
  roomCode?: string;
  /** Display name */
  name: string;
  /** Whether to create a new room instead of joining */
  create?: boolean;
};

export type UseRealtimeRoomResult = {
  state: RoomState | null;
  clientId: string | null;
  latencyMs: number;
  status: ConnectionStatus;
  error: { type: string; message: string } | null;
  sendEvent: (event: ClientMutationEvent) => void;
  leaveRoom: () => void;
};

/**
 * Hook to connect to a realtime room.
 * Handles connection, joining/creating room, and state updates.
 */
export function useRealtimeRoom(
  options: UseRealtimeRoomOptions
): UseRealtimeRoomResult {
  const { roomCode, name, create = false } = options;

  const [state, setState] = useState<RoomState | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<{ type: string; message: string } | null>(
    null
  );
  const [client] = useState<RealtimeClient>(() => getRealtimeClient());
  const [hasJoined, setHasJoined] = useState(false);

  // Connect and join/create room on mount
  useEffect(() => {
    const unsubState = client.onStateChange((newState) => {
      setState(newState);
      if (newState) {
        setClientId(client.getClientId());
      }
    });

    const unsubStatus = client.onStatusChange((newStatus) => {
      setStatus(newStatus);

      // Join or create room when connected (if not already done)
      if (newStatus === "connected" && !hasJoined) {
        setHasJoined(true);
        if (create) {
          client.createRoom(name);
        } else if (roomCode) {
          client.joinRoom(roomCode, name);
        }
      }
    });

    const unsubLatency = client.onLatencyChange(setLatencyMs);

    const unsubError = client.onError((err) => {
      setError(err);
      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    });

    // Connect if not already connected
    if (client.getStatus() === "disconnected") {
      client.connect();
    } else if (client.getStatus() === "connected" && !hasJoined) {
      // Already connected, join/create immediately
      setHasJoined(true);
      if (create) {
        client.createRoom(name);
      } else if (roomCode) {
        client.joinRoom(roomCode, name);
      }
    }

    // Initialize from current state
    setState(client.getState());
    setClientId(client.getClientId());
    setLatencyMs(client.getLatencyMs());
    setStatus(client.getStatus());

    return () => {
      unsubState();
      unsubStatus();
      unsubLatency();
      unsubError();
    };
  }, [client, roomCode, name, create, hasJoined]);

  const sendEvent = useCallback(
    (event: ClientMutationEvent) => {
      client.sendEvent(event);
    },
    [client]
  );

  const leaveRoom = useCallback(() => {
    client.leaveRoom();
    setHasJoined(false);
  }, [client]);

  return {
    state,
    clientId,
    latencyMs,
    status,
    error,
    sendEvent,
    leaveRoom,
  };
}
