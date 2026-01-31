import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInitialRoomState,
  applyMutation,
  MockRoom,
} from "./mockRoom";

describe("mockRoom", () => {
  const roomId = "room-1";
  const roomCode = "MOCK1";
  const clientId = "client-1";

  describe("createInitialRoomState", () => {
    it("creates valid room state with one host member", () => {
      const state = createInitialRoomState(roomId, roomCode, clientId, "Dev A");
      const member = state.members[0];
      expect(state.roomId).toBe(roomId);
      expect(state.roomCode).toBe(roomCode);
      expect(state.version).toBe(0);
      expect(state.hostId).toBe(clientId);
      expect(state.members).toHaveLength(1);
      expect(member).toBeDefined();
      expect(member!.clientId).toBe(clientId);
      expect(member!.name).toBe("Dev A");
      expect(member!.isHost).toBe(true);
      expect(state.queue).toHaveLength(0);
      expect(state.deckA.playState).toBe("stopped");
      expect(state.deckB.playState).toBe("stopped");
    });
  });

  describe("applyMutation", () => {
    let state: ReturnType<typeof createInitialRoomState>;

    beforeEach(() => {
      state = createInitialRoomState(roomId, roomCode, clientId);
    });

    it("applies CURSOR_MOVE and updates member cursor", () => {
      const next = applyMutation(
        state,
        {
          type: "CURSOR_MOVE",
          roomId,
          clientId,
          clientSeq: 1,
          payload: { x: 0.5, y: 0.25 },
        },
        Date.now(),
        "ev-1"
      );
      expect(next.version).toBe(state.version + 1);
      const member = next.members[0];
      expect(member).toBeDefined();
      expect(member!.cursor).toEqual({
        x: 0.5,
        y: 0.25,
        lastUpdated: expect.any(Number),
      });
    });

    it("applies QUEUE_ADD and appends to queue", () => {
      const next = applyMutation(
        state,
        {
          type: "QUEUE_ADD",
          roomId,
          clientId,
          clientSeq: 1,
          payload: {
            trackId: "track-1",
            title: "Test Track",
            durationSec: 120,
          },
        },
        Date.now(),
        "ev-1"
      );
      expect(next.version).toBe(state.version + 1);
      expect(next.queue).toHaveLength(1);
      const item = next.queue[0];
      expect(item).toBeDefined();
      expect(item!.trackId).toBe("track-1");
      expect(item!.title).toBe("Test Track");
      expect(item!.durationSec).toBe(120);
      expect(item!.status).toBe("queued");
    });

    it("applies MIXER_SET crossfader", () => {
      const next = applyMutation(
        state,
        {
          type: "MIXER_SET",
          roomId,
          clientId,
          clientSeq: 1,
          payload: { controlId: "crossfader", value: 0.75 },
        },
        Date.now(),
        "ev-1"
      );
      expect(next.version).toBe(state.version + 1);
      expect(next.mixer.crossfader).toBe(0.75);
    });
  });

  describe("MockRoom", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds state and notifies on sendEvent after simulated latency", () => {
      const state = createInitialRoomState(roomId, roomCode, clientId);
      const room = new MockRoom(state);
      const listener = vi.fn();
      room.subscribe(listener);

      room.sendEvent({
        type: "QUEUE_ADD",
        roomId,
        clientId,
        clientSeq: room.nextClientSeq(),
        payload: {
          trackId: "t1",
          title: "Track 1",
          durationSec: 60,
        },
      });

      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      const lastState = lastCall?.[0];
      expect(lastState).toBeDefined();
      expect(lastState!.queue).toHaveLength(1);
      expect(lastState!.queue[0]).toBeDefined();
      expect(lastState!.queue[0]!.title).toBe("Track 1");
    });

    it("calls ack listener with accepted: true for valid event", () => {
      const state = createInitialRoomState(roomId, roomCode, clientId);
      const room = new MockRoom(state);
      const ackListener = vi.fn();
      room.onAck(ackListener);

      const seq = room.nextClientSeq();
      room.sendEvent({
        type: "CURSOR_MOVE",
        roomId,
        clientId,
        clientSeq: seq,
        payload: { x: 0, y: 0 },
      });

      vi.advanceTimersByTime(100);
      expect(ackListener).toHaveBeenCalledWith(
        expect.objectContaining({
          clientSeq: seq,
          accepted: true,
        })
      );
    });
  });
});
