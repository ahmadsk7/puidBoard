"use client";

import type { QueueItem, QueueItemStatus, Member } from "@puid-board/shared";

/** Status badge colors - dark theme optimized */
const STATUS_COLORS: Record<QueueItemStatus, { bg: string; text: string; glow?: string }> = {
  queued: { bg: "#262626", text: "#737373" },
  loaded_A: { bg: "rgba(59, 130, 246, 0.15)", text: "#60a5fa", glow: "0 0 8px rgba(59, 130, 246, 0.3)" },
  loaded_B: { bg: "rgba(139, 92, 246, 0.15)", text: "#a78bfa", glow: "0 0 8px rgba(139, 92, 246, 0.3)" },
  playing_A: { bg: "rgba(34, 197, 94, 0.2)", text: "#4ade80", glow: "0 0 10px rgba(34, 197, 94, 0.4)" },
  playing_B: { bg: "rgba(34, 197, 94, 0.2)", text: "#4ade80", glow: "0 0 10px rgba(34, 197, 94, 0.4)" },
  played: { bg: "#1a1a1a", text: "#525252" },
};

/** Status display text */
const STATUS_TEXT: Record<QueueItemStatus, string> = {
  queued: "QUEUED",
  loaded_A: "DECK A",
  loaded_B: "DECK B",
  playing_A: "PLAYING",
  playing_B: "PLAYING",
  played: "PLAYED",
};

export type QueueItemRowProps = {
  item: QueueItem;
  index: number;
  members: Member[];
  isOwnItem: boolean;
  onRemove?: (queueItemId: string) => void;
  onLoadToDeck?: (queueItemId: string, deckId: "A" | "B") => void;
  /** Drag handlers for reordering */
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  isDragOver?: boolean;
};

/** Format duration as M:SS */
function formatDuration(sec: number): string {
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Get member name by clientId */
function getMemberName(members: Member[], clientId: string): string {
  const member = members.find((m) => m.clientId === clientId);
  return member?.name ?? "Unknown";
}

export default function QueueItemRow({
  item,
  index,
  members,
  isOwnItem: _isOwnItem,
  onRemove,
  onLoadToDeck,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: QueueItemRowProps) {
  const statusColor = STATUS_COLORS[item.status];
  const statusText = STATUS_TEXT[item.status];
  const addedByName = getMemberName(members, item.addedBy);
  const canLoad = item.status === "queued" || item.status === "played";
  const isPlaying = item.status === "playing_A" || item.status === "playing_B";
  const isLoaded = item.status === "loaded_A" || item.status === "loaded_B";

  return (
    <li
      draggable
      onDragStart={(e) => onDragStart?.(e, index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.(e, index);
      }}
      onDrop={(e) => onDrop?.(e, index)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.625rem 0.75rem",
        marginBottom: "0.375rem",
        background: isDragOver
          ? "rgba(59, 130, 246, 0.1)"
          : isPlaying
          ? "rgba(34, 197, 94, 0.05)"
          : isLoaded
          ? "rgba(255, 255, 255, 0.02)"
          : "#141414",
        borderRadius: 8,
        cursor: "grab",
        transition: "all 0.15s ease",
        boxShadow: isDragOver
          ? "inset 0 0 0 1px rgba(59, 130, 246, 0.4)"
          : isPlaying
          ? "inset 0 0 0 1px rgba(34, 197, 94, 0.2)"
          : "none",
      }}
    >
      {/* Drag handle */}
      <span
        style={{
          color: "#404040",
          fontSize: "0.75rem",
          cursor: "grab",
          userSelect: "none",
          letterSpacing: "-0.05em",
        }}
      >
        ::
      </span>

      {/* Track info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: "0.8125rem",
            color: isPlaying ? "#e5e5e5" : "#a3a3a3",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.4,
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            fontSize: "0.6875rem",
            color: "#525252",
            marginTop: "0.125rem",
          }}
        >
          {formatDuration(item.durationSec)}
          <span style={{ margin: "0 0.375rem", opacity: 0.5 }}>|</span>
          {addedByName}
        </div>
      </div>

      {/* Status badge */}
      <span
        style={{
          padding: "0.1875rem 0.5rem",
          fontSize: "0.5625rem",
          fontWeight: 600,
          borderRadius: 4,
          background: statusColor.bg,
          color: statusColor.text,
          letterSpacing: "0.05em",
          boxShadow: statusColor.glow,
        }}
      >
        {statusText}
      </span>

      {/* Load to deck buttons (only if queued or played) */}
      {canLoad && onLoadToDeck && (
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <button
            type="button"
            onClick={() => onLoadToDeck(item.id, "A")}
            title="Load to Deck A"
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.625rem",
              fontWeight: 600,
              background: "rgba(59, 130, 246, 0.15)",
              color: "#60a5fa",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(59, 130, 246, 0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)";
            }}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => onLoadToDeck(item.id, "B")}
            title="Load to Deck B"
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.625rem",
              fontWeight: 600,
              background: "rgba(139, 92, 246, 0.15)",
              color: "#a78bfa",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(139, 92, 246, 0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(139, 92, 246, 0.15)";
            }}
          >
            B
          </button>
        </div>
      )}

      {/* Remove button */}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          title="Remove from queue"
          style={{
            padding: "0.25rem 0.375rem",
            fontSize: "0.6875rem",
            background: "transparent",
            color: "#525252",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            transition: "all 0.15s ease",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#ef4444";
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#525252";
            e.currentTarget.style.background = "transparent";
          }}
        >
          x
        </button>
      )}
    </li>
  );
}
