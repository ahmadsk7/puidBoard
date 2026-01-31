"use client";

import type { QueueItem, QueueItemStatus, Member } from "@puid-board/shared";

/** Status badge colors */
const STATUS_COLORS: Record<QueueItemStatus, { bg: string; text: string }> = {
  queued: { bg: "#6b7280", text: "#fff" },
  loaded_A: { bg: "#3b82f6", text: "#fff" },
  loaded_B: { bg: "#8b5cf6", text: "#fff" },
  playing_A: { bg: "#22c55e", text: "#fff" },
  playing_B: { bg: "#22c55e", text: "#fff" },
  played: { bg: "#9ca3af", text: "#fff" },
};

/** Status display text */
const STATUS_TEXT: Record<QueueItemStatus, string> = {
  queued: "Queued",
  loaded_A: "Deck A",
  loaded_B: "Deck B",
  playing_A: "▶ A",
  playing_B: "▶ B",
  played: "Played",
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
  isOwnItem,
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
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        marginBottom: "0.25rem",
        background: isDragOver ? "#dbeafe" : isOwnItem ? "#f0fdf4" : "#f9fafb",
        borderRadius: 6,
        border: isDragOver ? "2px dashed #3b82f6" : "1px solid #e5e7eb",
        cursor: "grab",
        transition: "background 0.15s, border 0.15s",
      }}
    >
      {/* Drag handle */}
      <span style={{ color: "#9ca3af", fontSize: "0.875rem", cursor: "grab" }}>
        ⋮⋮
      </span>

      {/* Track info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: "0.875rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          {formatDuration(item.durationSec)} · by {addedByName}
        </div>
      </div>

      {/* Status badge */}
      <span
        style={{
          padding: "0.125rem 0.375rem",
          fontSize: "0.625rem",
          fontWeight: 600,
          borderRadius: 4,
          background: statusColor.bg,
          color: statusColor.text,
          textTransform: "uppercase",
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
              padding: "0.125rem 0.375rem",
              fontSize: "0.625rem",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => onLoadToDeck(item.id, "B")}
            title="Load to Deck B"
            style={{
              padding: "0.125rem 0.375rem",
              fontSize: "0.625rem",
              background: "#8b5cf6",
              color: "white",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
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
            padding: "0.125rem 0.375rem",
            fontSize: "0.75rem",
            background: "#ef4444",
            color: "white",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </li>
  );
}
