"use client";

import { useCallback, useEffect, useState, useRef } from "react";
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
  /** Auto-create room if join fails (room not found) */
  autoCreate?: boolean;
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
  const { roomCode, name, create = false, autoCreate = false } = options;

  const [state, setState] = useState<RoomState | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<{ type: string; message: string } | null>(
    null
  );
  const [client] = useState<RealtimeClient>(() => getRealtimeClient());

  // Use refs to track join state to prevent duplicate joins
  const hasJoinedRef = useRef(false);
  const hasTriedCreateRef = useRef(false);
  // Track the room code we've joined to detect navigation changes
  const joinedRoomCodeRef = useRef<string | null>(null);

  // Reset join state when options change (navigation to different room)
  useEffect(() => {
    const targetRoom = create ? "create" : roomCode;
    if (joinedRoomCodeRef.current !== targetRoom) {
      hasJoinedRef.current = false;
      hasTriedCreateRef.current = false;
      joinedRoomCodeRef.current = null;
    }
  }, [create, roomCode]);

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

      // Join or create room when connected (if not already done for this room)
      if (newStatus === "connected" && !hasJoinedRef.current) {
        hasJoinedRef.current = true;
        joinedRoomCodeRef.current = create ? "create" : roomCode || null;
        if (create) {
          client.createRoom(name);
        } else if (roomCode) {
          client.joinRoom(roomCode, name);
        }
      }
    });

    const unsubLatency = client.onLatencyChange(setLatencyMs);

    const unsubError = client.onError((err) => {
      // If room not found and autoCreate is enabled, create it
      if (err.type === "ROOM_NOT_FOUND" && autoCreate && !hasTriedCreateRef.current) {
        hasTriedCreateRef.current = true;
        client.createRoom(name);
        return; // Don't show error, we're auto-creating
      }

      setError(err);
      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    });

    // Connect if not already connected
    if (client.getStatus() === "disconnected") {
      client.connect();
    } else if (client.getStatus() === "connected" && !hasJoinedRef.current) {
      // Already connected, join/create immediately
      hasJoinedRef.current = true;
      joinedRoomCodeRef.current = create ? "create" : roomCode || null;
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
  }, [client, roomCode, name, create, autoCreate]);

  const sendEvent = useCallback(
    (event: ClientMutationEvent) => {
      client.sendEvent(event);
    },
    [client]
  );

  const leaveRoom = useCallback(() => {
    client.leaveRoom();
    hasJoinedRef.current = false;
    joinedRoomCodeRef.current = null;
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
