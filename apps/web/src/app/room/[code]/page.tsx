"use client";

import { useParams } from "next/navigation";
import { useCallback, useRef, useState, useEffect } from "react";
import { USE_MOCK_ROOM } from "@/dev/featureFlags";
import { MockRoomProvider, useMockRoom } from "@/dev/MockRoomProvider";
import TopBar from "@/components/TopBar";
import DJBoard from "@/components/DJBoard";
import { useToasts, ToastContainer } from "@/components/Toast";
import { useRealtimeRoom } from "@/realtime/useRealtimeRoom";
import { initAudioEngine } from "@/audio/engine";
import { getUsername, setUsername } from "@/utils/username";
import type { ClientMutationEvent, RoomState } from "@puid-board/shared";
import { RoomLoadingScreen } from "../../../components/RoomLoadingScreen";

/** Shared room UI content */
function RoomContent({
  state,
  clientId,
  latencyMs,
  sendEvent,
  nextSeq,
  sendRename,
}: {
  state: RoomState;
  clientId: string;
  latencyMs: number;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  sendRename?: (newName: string) => void;
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

  const handleRename = useCallback((newName: string) => {
    setUsername(newName);
    sendRename?.(newName);
  }, [sendRename]);
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
        members={state.members}
        clientId={clientId}
        onRename={handleRename}
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
  const [name] = useState(() => getUsername());

  // If roomCode is "create", we want to create a new room, otherwise join existing
  const isCreating = roomCode.toLowerCase() === "create";

  const { toasts, addToast } = useToasts();
  const clientIdRef = useRef<string | null>(null);

  const handleMemberJoined = useCallback((p: { clientId: string; name: string; color: string }) => {
    if (clientIdRef.current && p.clientId === clientIdRef.current) return;
    addToast({ message: `${p.name} joined`, color: p.color, type: "join" });
  }, [addToast]);

  const handleMemberLeft = useCallback((p: { clientId: string; name: string; color: string }) => {
    addToast({ message: `${p.name} left`, color: p.color, type: "leave" });
  }, [addToast]);

  const handleMemberRenamed = useCallback((p: { clientId: string; oldName: string; newName: string }) => {
    addToast({ message: `${p.oldName} is now ${p.newName}`, color: "#9ca3af", type: "rename" });
  }, [addToast]);

  const { state, clientId, latencyMs, status, error, sendEvent, sendRename } = useRealtimeRoom({
    roomCode: isCreating ? undefined : roomCode,
    name,
    create: isCreating,
    autoCreate: false,
    onMemberJoined: handleMemberJoined,
    onMemberLeft: handleMemberLeft,
    onMemberRenamed: handleMemberRenamed,
  });

  // Keep the ref in sync
  clientIdRef.current = clientId;

  // Don't update URL - just show the actual room code in the UI
  // Updating URL causes navigation issues and disconnects

  const [roomReady, setRoomReady] = useState(false);

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
    const isPermanent = error.type === "ROOM_NOT_FOUND" || error.type === "CONNECTION_FAILED";
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
              textAlign: "center",
            }}
          >
            <p style={{ color: "#ef4444", margin: 0 }}>Error: {error.message}</p>
            {isPermanent && (
              <button
                type="button"
                onClick={() => window.location.href = "/"}
                style={{
                  marginTop: 16,
                  padding: "8px 20px",
                  background: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Back to Home
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (!state || !clientId) {
    // If disconnected with no state, show connection error instead of "waiting"
    const isDisconnected = status === "disconnected";
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
          {isDisconnected ? (
            <div
              style={{
                padding: 24,
                background: "#1f2937",
                borderRadius: 8,
                border: "1px solid #ef4444",
                textAlign: "center",
              }}
            >
              <p style={{ color: "#ef4444", margin: 0 }}>
                Unable to connect to server
              </p>
              <p style={{ color: "#9ca3af", margin: "8px 0 0", fontSize: "0.875rem" }}>
                Make sure the realtime server is running on {process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001"}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  marginTop: 16,
                  padding: "8px 20px",
                  background: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Retry
              </button>
            </div>
          ) : (
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
              <p style={{ color: "#9ca3af" }}>Joining room...</p>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}
        </main>
      </div>
    );
  }

  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

  // Phase 1: Loading screen — wait for assets
  if (!roomReady) {
    return (
      <RoomLoadingScreen
        state={state}
        realtimeUrl={realtimeUrl}
        onReady={() => setRoomReady(true)}
      />
    );
  }

  // Phase 2: Board is ready
  return (
    <>
      <RoomContent
        state={state}
        clientId={clientId}
        latencyMs={latencyMs}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
        sendRename={sendRename}
      />
      <ToastContainer toasts={toasts} />
    </>
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
