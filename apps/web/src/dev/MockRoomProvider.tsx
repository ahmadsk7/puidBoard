"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { RoomState, ClientMutationEvent } from "@puid-board/shared";
import {
  createInitialRoomState,
  MockRoom,
} from "./mockRoom";

type MockRoomContextValue = {
  state: RoomState;
  sendEvent: (event: ClientMutationEvent) => void;
  room: MockRoom;
};

const MockRoomContext = createContext<MockRoomContextValue | null>(null);

const DEFAULT_ROOM_ID = "mock-room-1";
const DEFAULT_ROOM_CODE = "MOCK1";

export function MockRoomProvider({
  roomId = DEFAULT_ROOM_ID,
  roomCode = DEFAULT_ROOM_CODE,
  clientId = "mock-client-1",
  name = "Dev A",
  children,
}: {
  roomId?: string;
  roomCode?: string;
  clientId?: string;
  name?: string;
  children: React.ReactNode;
}) {
  const room = useMemo(
    () =>
      new MockRoom(
        createInitialRoomState(roomId, roomCode, clientId, name)
      ),
    [roomId, roomCode, clientId, name]
  );
  const [state, setState] = useState<RoomState>(() => room.getState());

  useEffect(() => {
    return room.subscribe(setState);
  }, [room]);

  const sendEvent = useCallback(
    (event: ClientMutationEvent) => {
      room.sendEvent(event);
    },
    [room]
  );

  const value = useMemo<MockRoomContextValue>(
    () => ({ state, sendEvent, room }),
    [state, sendEvent, room]
  );

  return (
    <MockRoomContext.Provider value={value}>
      {children}
    </MockRoomContext.Provider>
  );
}

export function useMockRoom(): MockRoomContextValue {
  const ctx = useContext(MockRoomContext);
  if (!ctx) {
    throw new Error("useMockRoom must be used within MockRoomProvider");
  }
  return ctx;
}
