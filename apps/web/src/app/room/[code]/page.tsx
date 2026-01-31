"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { USE_MOCK_ROOM } from "@/dev/featureFlags";
import { MockRoomProvider, useMockRoom } from "@/dev/MockRoomProvider";
import TopBar from "@/components/TopBar";
import type { ClientMutationEvent } from "@puid-board/shared";

/** Simulates latency changing over time so TopBar color (green/yellow/red) updates. */
function useSimulatedLatency(intervalMs = 1500): number {
  const [latencyMs, setLatencyMs] = useState(50);

  useEffect(() => {
    const t = setInterval(() => {
      setLatencyMs(Math.floor(30 + Math.random() * 220));
    }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return latencyMs;
}

function RoomContentWithTopBar() {
  const { state, sendEvent, room } = useMockRoom();
  const latencyMs = useSimulatedLatency(1500);
  const autoplayEnabled = true;

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
    <>
      <TopBar
        roomCode={state.roomCode}
        latencyMs={latencyMs}
        autoplayEnabled={autoplayEnabled}
      />
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
        <p style={{ color: "#666", fontSize: "0.875rem" }}>
          Version: {state.version} · Mock harness
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
            style={{ marginTop: "0.5rem", padding: "0.5rem 1rem", cursor: "pointer" }}
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
    </>
  );
}

export default function RoomByCodePage() {
  const params = useParams();
  const code = typeof params?.code === "string" ? params.code : "";

  if (!code) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p>Missing room code.</p>
      </main>
    );
  }

  const roomCode = code.slice(0, 8).toUpperCase();
  const roomId = `room-${roomCode}`;

  if (!USE_MOCK_ROOM) {
    return (
      <>
        <TopBar
          roomCode={roomCode}
          latencyMs={0}
          autoplayEnabled={false}
        />
        <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Room: {roomCode}</h1>
          <p>Connect to the realtime server to join. (PR 1.1 not yet integrated.)</p>
          <p style={{ fontSize: "0.875rem", color: "#666" }}>
            Set <code>NEXT_PUBLIC_USE_MOCK_ROOM=true</code> to use the mock room.
          </p>
        </main>
      </>
    );
  }

  return (
    <MockRoomProvider roomCode={roomCode} roomId={roomId}>
      <RoomContentWithTopBar />
    </MockRoomProvider>
  );
}
