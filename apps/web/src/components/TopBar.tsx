"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import type { Member } from "@puid-board/shared";

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
  members?: Member[];
  clientId?: string;
  onRename?: (newName: string) => void;
};

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  background: "#374151",
  borderRadius: 12,
  fontSize: "0.75rem",
  color: "#f9fafb",
  whiteSpace: "nowrap" as const,
};

export default function TopBar({ roomCode, latencyMs, members, clientId, onRename }: TopBarProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [lastRenameAt, setLastRenameAt] = useState(0);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

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

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed.length === 0 || trimmed.length > 32) {
      setEditing(false);
      return;
    }
    if (Date.now() - lastRenameAt < 5000) {
      setEditing(false);
      return;
    }
    onRename?.(trimmed);
    setLastRenameAt(Date.now());
    setEditing(false);
  }, [editName, lastRenameAt, onRename]);

  const level = getLatencyColor(latencyMs);
  const latencyBg =
    level === "green" ? "#22c55e" : level === "yellow" ? "#eab308" : "#ef4444";

  // Build pills list
  const currentUser = members?.find((m) => m.clientId === clientId);
  const otherMembers = members
    ?.filter((m) => m.clientId !== clientId)
    .sort((a, b) => a.joinedAt - b.joinedAt) ?? [];
  const allPills = currentUser ? [currentUser, ...otherMembers] : otherMembers;
  const maxVisible = 5;
  const visiblePills = allPills.length > maxVisible ? allPills.slice(0, maxVisible - 1) : allPills;
  const overflowCount = allPills.length > maxVisible ? allPills.length - (maxVisible - 1) : 0;

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

      {/* Presence pills */}
      {members && members.length > 0 && (
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {visiblePills.map((member) => {
            const isMe = member.clientId === clientId;

            if (isMe && editing) {
              return (
                <div key={member.clientId} style={{ ...pillStyle, border: `1px solid ${member.color}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: member.color, flexShrink: 0 }} />
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    maxLength={32}
                    style={{
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "#f9fafb",
                      fontSize: "0.75rem",
                      fontFamily: "inherit",
                      width: "8em",
                      padding: 0,
                    }}
                  />
                </div>
              );
            }

            return (
              <div
                key={member.clientId}
                style={{
                  ...pillStyle,
                  ...(isMe ? { border: `1px solid ${member.color}`, cursor: "pointer" } : {}),
                }}
                onClick={isMe ? () => { setEditName(member.name); setEditing(true); } : undefined}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: member.color, flexShrink: 0 }} />
                <span>{member.name}{isMe ? " (You)" : ""}</span>
              </div>
            );
          })}
          {overflowCount > 0 && (
            <div style={pillStyle}>
              <span>+{overflowCount}</span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export { generateRoomCode };
