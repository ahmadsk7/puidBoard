"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { USE_MOCK_ROOM } from "@/dev/featureFlags";
import { MockRoomProvider, useMockRoom } from "@/dev/MockRoomProvider";
import TopBar from "@/components/TopBar";
import CursorsLayer, { buildMemberColorMap, getGrabGlowStyle } from "@/components/CursorsLayer";
import { useRealtimeRoom } from "@/realtime/useRealtimeRoom";
import type { ClientMutationEvent, RoomState } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";

/** Simulates latency for mock mode */
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

/** Shared room UI content */
function RoomContent({
  state,
  clientId,
  latencyMs,
  autoplayEnabled,
  sendEvent,
  nextSeq,
}: {
  state: RoomState;
  clientId: string;
  latencyMs: number;
  autoplayEnabled: boolean;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
}) {
  const cursorAreaRef = useRef<HTMLDivElement>(null);
  const [cursorAreaSize, setCursorAreaSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = cursorAreaRef.current;
    if (!el) return;
    const updateSize = () => {
      setCursorAreaSize({ width: el.offsetWidth, height: el.offsetHeight });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const memberColors = buildMemberColorMap(state.members);
  const crossfaderGlow = getGrabGlowStyle(
    "crossfader",
    state.controlOwners,
    memberColors,
    clientId
  );

  const handleAddToQueue = () => {
    sendEvent({
      type: "QUEUE_ADD",
      roomId: state.roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: {
        trackId: `track-${Date.now()}`,
        title: `Track ${state.queue.length + 1}`,
        durationSec: 180,
      },
    });
  };

  const handleCrossfaderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    sendEvent({
      type: "MIXER_SET",
      roomId: state.roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId: "crossfader", value: Number(e.target.value) },
    });
  };

  // Throttle cursor moves
  const lastCursorMove = useRef(0);
  const handleCursorMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastCursorMove.current < THROTTLE.CURSOR_MS) return;
    lastCursorMove.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    sendEvent({
      type: "CURSOR_MOVE",
      roomId: state.roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { x, y },
    });
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
          Version: {state.version} · Members: {state.members.length}
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
            style={{
              width: "100%",
              maxWidth: 300,
              borderRadius: 4,
              ...(crossfaderGlow || {}),
            }}
          />
        </section>

        <section style={{ marginTop: "1.5rem" }}>
          <h2>Cursors</h2>
          <div
            ref={cursorAreaRef}
            role="button"
            tabIndex={0}
            onMouseMove={handleCursorMove}
            onClick={handleCursorMove}
            style={{
              width: "100%",
              height: 180,
              background: "#e5e7eb",
              borderRadius: 8,
              position: "relative",
              cursor: "crosshair",
            }}
          >
            <CursorsLayer
              members={state.members}
              currentClientId={clientId}
              containerWidth={cursorAreaSize.width}
              containerHeight={cursorAreaSize.height}
            />
            {/* Own cursor (if set) */}
            {state.members.find((m) => m.clientId === clientId)?.cursor && (
              <div
                style={{
                  position: "absolute",
                  left: `${(state.members.find((m) => m.clientId === clientId)?.cursor?.x ?? 0) * 100}%`,
                  top: `${(state.members.find((m) => m.clientId === clientId)?.cursor?.y ?? 0) * 100}%`,
                  width: 12,
                  height: 12,
                  marginLeft: -6,
                  marginTop: -6,
                  background: state.members.find((m) => m.clientId === clientId)?.color ?? "#333",
                  borderRadius: "50%",
                  pointerEvents: "none",
                  border: "2px solid white",
                }}
              />
            )}
          </div>
        </section>
      </main>
    </>
  );
}

/** Mock room wrapper */
function MockRoomContent() {
  const { state, sendEvent, room } = useMockRoom();
  const latencyMs = useSimulatedLatency(1500);

  return (
    <RoomContent
      state={state}
      clientId={state.hostId}
      latencyMs={latencyMs}
      autoplayEnabled={true}
      sendEvent={sendEvent}
      nextSeq={() => room.nextClientSeq()}
    />
  );
}

/** Real room wrapper */
function RealtimeRoomContent({ roomCode }: { roomCode: string }) {
  // Generate a stable name for this session
  const [name] = useState(() => `User${Math.floor(Math.random() * 1000)}`);

  const { state, clientId, latencyMs, status, error, sendEvent } = useRealtimeRoom({
    roomCode,
    name,
  });

  const seqRef = useRef(0);
  const nextSeq = () => ++seqRef.current;

  if (status === "connecting") {
    return (
      <>
        <TopBar roomCode={roomCode} latencyMs={0} autoplayEnabled={false} />
        <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <p>Connecting to server...</p>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar roomCode={roomCode} latencyMs={0} autoplayEnabled={false} />
        <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <p style={{ color: "#ef4444" }}>Error: {error.message}</p>
        </main>
      </>
    );
  }

  if (!state || !clientId) {
    return (
      <>
        <TopBar roomCode={roomCode} latencyMs={0} autoplayEnabled={false} />
        <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <p>Waiting for room state...</p>
        </main>
      </>
    );
  }

  return (
    <RoomContent
      state={state}
      clientId={clientId}
      latencyMs={latencyMs}
      autoplayEnabled={true}
      sendEvent={sendEvent}
      nextSeq={nextSeq}
    />
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

  if (USE_MOCK_ROOM) {
    return (
      <MockRoomProvider roomCode={roomCode} roomId={roomId}>
        <MockRoomContent />
      </MockRoomProvider>
    );
  }

  return <RealtimeRoomContent roomCode={roomCode} />;
}
