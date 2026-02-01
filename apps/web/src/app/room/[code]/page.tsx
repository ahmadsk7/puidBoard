"use client";

import { useParams } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { USE_MOCK_ROOM } from "@/dev/featureFlags";
import { MockRoomProvider, useMockRoom } from "@/dev/MockRoomProvider";
import TopBar from "@/components/TopBar";
import DJBoard from "@/components/DJBoard";
import { useRealtimeRoom } from "@/realtime/useRealtimeRoom";
import { initAudioEngine } from "@/audio/engine";
import type { ClientMutationEvent, RoomState } from "@puid-board/shared";

/** Shared room UI content */
function RoomContent({
  state,
  clientId,
  latencyMs,
  sendEvent,
  nextSeq,
}: {
  state: RoomState;
  clientId: string;
  latencyMs: number;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
}) {
  // Initialize audio on first user interaction (click anywhere)
  useEffect(() => {
    const handleFirstClick = async () => {
      try {
        await initAudioEngine();
        console.log("[Room] Audio engine initialized on first click");
        // Remove listener after first successful initialization
        document.removeEventListener("click", handleFirstClick);
      } catch (err) {
        console.error("[Room] Failed to initialize audio:", err);
      }
    };

    document.addEventListener("click", handleFirstClick);
    return () => document.removeEventListener("click", handleFirstClick);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0a0a0b",
      }}
    >
      <TopBar
        roomCode={state.roomCode}
        latencyMs={latencyMs}
      />
      {/* Main content area - full width DJ board with integrated queue */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          overflow: "hidden",
          background: "linear-gradient(180deg, #0a0a0b 0%, #111113 100%)",
        }}
      >
        <DJBoard
          state={state}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
        />
      </main>
    </div>
  );
}

/** Mock room wrapper */
function MockRoomContent() {
  const { state, sendEvent, room } = useMockRoom();
  // Use a fixed latency value for mock mode
  const latencyMs = 50;

  return (
    <RoomContent
      state={state}
      clientId={state.hostId}
      latencyMs={latencyMs}
      sendEvent={sendEvent}
      nextSeq={() => room.nextClientSeq()}
    />
  );
}

/** Real room wrapper */
function RealtimeRoomContent({ roomCode }: { roomCode: string }) {
  // Generate a stable name for this session
  const [name] = useState(() => `User${Math.floor(Math.random() * 1000)}`);

  // If roomCode is "create", we want to create a new room, otherwise join existing
  const isCreating = roomCode.toLowerCase() === "create";

  const { state, clientId, latencyMs, status, error, sendEvent } = useRealtimeRoom({
    roomCode: isCreating ? undefined : roomCode,
    name,
    create: isCreating, // Create new room if code is "create"
    autoCreate: false, // Don't auto-create for join attempts
  });

  // Don't update URL - just show the actual room code in the UI
  // Updating URL causes navigation issues and disconnects

  const seqRef = useRef(0);
  const nextSeq = () => ++seqRef.current;

  // Show actual room code if we have it, otherwise show status
  const displayCode = state?.roomCode || (isCreating ? "Creating..." : roomCode);

  if (status === "connecting") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#0a0a0b",
        }}
      >
        <TopBar roomCode={displayCode} latencyMs={0} />
        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                border: "3px solid #3b82f6",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <p style={{ color: "#9ca3af" }}>
              {isCreating ? "Creating room..." : "Connecting to server..."}
            </p>
          </div>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#0a0a0b",
        }}
      >
        <TopBar roomCode={displayCode} latencyMs={0} />
        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              padding: 24,
              background: "#1f2937",
              borderRadius: 8,
              border: "1px solid #ef4444",
            }}
          >
            <p style={{ color: "#ef4444", margin: 0 }}>Error: {error.message}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!state || !clientId) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#0a0a0b",
        }}
      >
        <TopBar roomCode={displayCode} latencyMs={0} />
        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <p style={{ color: "#9ca3af" }}>Waiting for room state...</p>
        </main>
      </div>
    );
  }

  return (
    <RoomContent
      state={state}
      clientId={clientId}
      latencyMs={latencyMs}
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
      <main
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0a0a0b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ color: "#ef4444" }}>Missing room code.</p>
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
