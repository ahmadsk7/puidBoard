"use client";

import { USE_MOCK_ROOM } from "@/dev/featureFlags";
import { MockRoomProvider, useMockRoom } from "@/dev/MockRoomProvider";
import type { ClientMutationEvent } from "@puid-board/shared";

function RoomContent() {
  const { state, sendEvent, room } = useMockRoom();

  const handleAddToQueue = () => {
    const event: ClientMutationEvent = {
      type: "QUEUE_ADD",
      roomId: state.roomId,
      clientId: state.hostId,
      clientSeq: room.nextClientSeq(),
      payload: {
        trackId: `track-${Date.now()}`,
        title: `Track ${state.queue.length + 1}`,
        durationSec: 180,
        url: "https://example.com/mock-track.mp3",
      },
    };
    sendEvent(event);
  };

  const handleCrossfaderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    const event: ClientMutationEvent = {
      type: "MIXER_SET",
      roomId: state.roomId,
      clientId: state.hostId,
      clientSeq: room.nextClientSeq(),
      payload: { controlId: "crossfader", value },
    };
    sendEvent(event);
  };

  const handleCursorMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const event: ClientMutationEvent = {
      type: "CURSOR_MOVE",
      roomId: state.roomId,
      clientId: state.hostId,
      clientSeq: room.nextClientSeq(),
      payload: { x, y },
    };
    sendEvent(event);
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
      <h1>Room: {state.roomCode}</h1>
      <p style={{ color: "#666", fontSize: "0.875rem" }}>
        Version: {state.version} · Mock harness (PR 0.3)
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Queue ({state.queue.length})</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {state.queue.map((item) => (
            <li
              key={item.id}
              style={{
                padding: "0.5rem 0.75rem",
                marginBottom: "0.25rem",
                background: "#f3f4f6",
                borderRadius: 4,
              }}
            >
              {item.title} · {Math.floor(item.durationSec / 60)}m
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={handleAddToQueue}
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 1rem",
            cursor: "pointer",
          }}
        >
          Add track to queue
        </button>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Mixer</h2>
        <label style={{ display: "block", marginBottom: "0.25rem" }}>
          Crossfader: {(state.mixer.crossfader * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.mixer.crossfader}
          onChange={handleCrossfaderChange}
          style={{ width: "100%", maxWidth: 300 }}
        />
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Cursor (click to move)</h2>
        <div
          role="button"
          tabIndex={0}
          onMouseMove={handleCursorMove}
          onClick={handleCursorMove}
          style={{
            width: "100%",
            height: 120,
            background: "#e5e7eb",
            borderRadius: 8,
            position: "relative",
            cursor: "crosshair",
          }}
        >
          {state.members[0]?.cursor && (
            <div
              style={{
                position: "absolute",
                left: `${state.members[0].cursor.x * 100}%`,
                top: `${state.members[0].cursor.y * 100}%`,
                width: 12,
                height: 12,
                marginLeft: -6,
                marginTop: -6,
                background: state.members[0].color,
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </section>
    </main>
  );
}

export default function RoomPage() {
  if (!USE_MOCK_ROOM) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Room</h1>
        <p>
          Mock room is disabled. Set <code>NEXT_PUBLIC_USE_MOCK_ROOM=true</code> in{" "}
          <code>.env.local</code> to use the dev harness.
        </p>
      </main>
    );
  }

  return (
    <MockRoomProvider>
      <RoomContent />
    </MockRoomProvider>
  );
}
