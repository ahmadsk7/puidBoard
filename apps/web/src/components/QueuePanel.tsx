"use client";

import { useState, useCallback } from "react";
import type { QueueItem, Member, ClientMutationEvent } from "@puid-board/shared";
import QueueItemRow from "./QueueItemRow";

export type QueuePanelProps = {
  queue: QueueItem[];
  members: Member[];
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
};

export default function QueuePanel({
  queue,
  members,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
}: QueuePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** Add a new track to the queue */
  const handleAddTrack = useCallback(() => {
    sendEvent({
      type: "QUEUE_ADD",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: {
        trackId: `track-${Date.now()}`,
        title: `Track ${queue.length + 1}`,
        durationSec: Math.floor(120 + Math.random() * 180), // 2-5 min random
      },
    });
  }, [sendEvent, roomId, clientId, nextSeq, queue.length]);

  /** Remove a track from the queue */
  const handleRemove = useCallback(
    (queueItemId: string) => {
      sendEvent({
        type: "QUEUE_REMOVE",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { queueItemId },
      });
    },
    [sendEvent, roomId, clientId, nextSeq]
  );

  /** Load a track to a deck */
  const handleLoadToDeck = useCallback(
    (queueItemId: string, deckId: "A" | "B") => {
      const item = queue.find((q) => q.id === queueItemId);
      if (!item) return;
      sendEvent({
        type: "DECK_LOAD",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: {
          deckId,
          trackId: item.trackId,
          queueItemId,
        },
      });
    },
    [sendEvent, roomId, clientId, nextSeq, queue]
  );

  /** Drag start handler */
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      setDragIndex(index);
    },
    []
  );

  /** Drag over handler */
  const handleDragOver = useCallback(
    (_e: React.DragEvent, index: number) => {
      if (dragIndex !== null && dragIndex !== index) {
        setDropIndex(index);
      }
    },
    [dragIndex]
  );

  /** Drop handler - reorder queue */
  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      
      if (isNaN(fromIndex) || fromIndex === toIndex) {
        setDragIndex(null);
        setDropIndex(null);
        return;
      }

      const item = queue[fromIndex];
      if (!item) {
        setDragIndex(null);
        setDropIndex(null);
        return;
      }

      // Calculate new index after removal
      // If dragging down, the new index is toIndex
      // If dragging up, the new index is toIndex
      const newIndex = fromIndex < toIndex ? toIndex : toIndex;

      sendEvent({
        type: "QUEUE_REORDER",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: {
          queueItemId: item.id,
          newIndex,
        },
      });

      setDragIndex(null);
      setDropIndex(null);
    },
    [queue, sendEvent, roomId, clientId, nextSeq]
  );

  /** Drag end handler */
  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  return (
    <aside
      style={{
        width: 280,
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          Queue ({queue.length})
        </h2>
        <button
          type="button"
          onClick={handleAddTrack}
          style={{
            padding: "0.375rem 0.75rem",
            fontSize: "0.75rem",
            background: "#22c55e",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + Add
        </button>
      </div>

      {/* Queue list */}
      <ul
        style={{
          flex: 1,
          overflow: "auto",
          margin: 0,
          padding: "0.5rem",
          listStyle: "none",
        }}
        onDragEnd={handleDragEnd}
      >
        {queue.length === 0 ? (
          <li
            style={{
              padding: "2rem 1rem",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: "0.875rem",
            }}
          >
            Queue is empty
            <br />
            <span style={{ fontSize: "0.75rem" }}>Click &quot;+ Add&quot; to add tracks</span>
          </li>
        ) : (
          queue.map((item, index) => (
            <QueueItemRow
              key={item.id}
              item={item}
              index={index}
              members={members}
              isOwnItem={item.addedBy === clientId}
              onRemove={handleRemove}
              onLoadToDeck={handleLoadToDeck}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              isDragOver={dropIndex === index}
            />
          ))
        )}
      </ul>

      {/* Footer with hint */}
      <div
        style={{
          padding: "0.5rem 1rem",
          borderTop: "1px solid #e5e7eb",
          fontSize: "0.625rem",
          color: "#9ca3af",
          textAlign: "center",
        }}
      >
        Drag to reorder · Click A/B to load to deck
      </div>
    </aside>
  );
}
