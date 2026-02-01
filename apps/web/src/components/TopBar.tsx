"use client";

import { useCallback, useState } from "react";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LEN = 6;

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export type LatencyLevel = "green" | "yellow" | "red";

export function getLatencyColor(ms: number): LatencyLevel {
  if (ms < 100) return "green";
  if (ms < 200) return "yellow";
  return "red";
}

export type TopBarProps = {
  roomCode: string;
  latencyMs: number;
};

export default function TopBar({ roomCode, latencyMs }: TopBarProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const inviteLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${encodeURIComponent(roomCode)}`
      : "";

  const copyRoomCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  }, [roomCode]);

  const copyInviteLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  }, [inviteLink]);

  const level = getLatencyColor(latencyMs);
  const latencyBg =
    level === "green" ? "#22c55e" : level === "yellow" ? "#eab308" : "#ef4444";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.75rem 1rem",
        background: "#1f2937",
        color: "#f9fafb",
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.875rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 600 }}>Room: {roomCode}</span>
      <button
        type="button"
        onClick={copyRoomCode}
        style={{
          padding: "0.25rem 0.5rem",
          background: "#374151",
          border: "none",
          borderRadius: 4,
          color: "#f9fafb",
          cursor: "pointer",
        }}
      >
        {copiedCode ? "Copied!" : "Copy code"}
      </button>
      <button
        type="button"
        onClick={copyInviteLink}
        style={{
          padding: "0.25rem 0.5rem",
          background: "#374151",
          border: "none",
          borderRadius: 4,
          color: "#f9fafb",
          cursor: "pointer",
        }}
      >
        {copiedLink ? "Copied!" : "Copy invite link"}
      </button>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: latencyBg,
          }}
          aria-hidden
        />
        <span>Latency: {latencyMs}ms</span>
      </span>
    </header>
  );
}

export { generateRoomCode };
