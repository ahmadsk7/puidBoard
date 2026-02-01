"use client";

import { useState, useCallback } from "react";
import type { QueueItem, Member, ClientMutationEvent } from "@puid-board/shared";
import QueueItemRow from "./QueueItemRow";
import TrackUploader, { UploadResult } from "./TrackUploader";

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

  /** Add a track to the queue after upload completes */
  const handleUploadComplete = useCallback(
    (result: UploadResult) => {
      console.log("[QueuePanel] Upload complete, adding to queue:", result);
      const seq = nextSeq();
      const event = {
        type: "QUEUE_ADD" as const,
        roomId,
        clientId,
        clientSeq: seq,
        payload: {
          trackId: result.trackId,
          title: result.title,
          durationSec: result.durationSec,
        },
      };
      console.log("[QueuePanel] Sending QUEUE_ADD event:", event);
      sendEvent(event);
    },
    [sendEvent, roomId, clientId, nextSeq]
  );

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
        width: 300,
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem 1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <h2
            style={{
              margin: 0,
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#e5e5e5",
              letterSpacing: "0.025em",
              textTransform: "uppercase",
            }}
          >
            Queue
          </h2>
          <span
            style={{
              fontSize: "0.75rem",
              color: "#525252",
              fontWeight: 500,
            }}
          >
            {queue.length}
          </span>
        </div>
        <TrackUploader onUploadComplete={handleUploadComplete} />
      </div>

      {/* Queue list */}
      <ul
        style={{
          flex: 1,
          overflow: "auto",
          margin: 0,
          padding: "0 0.75rem 0.75rem",
          listStyle: "none",
        }}
        onDragEnd={handleDragEnd}
      >
        {queue.length === 0 ? (
          <li
            style={{
              padding: "3rem 1rem",
              textAlign: "center",
            }}
          >
            <div
              style={{
                color: "#404040",
                fontSize: "0.8125rem",
                fontWeight: 500,
                marginBottom: "0.5rem",
              }}
            >
              No tracks in queue
            </div>
            <div
              style={{
                color: "#333333",
                fontSize: "0.6875rem",
              }}
            >
              Add tracks to get started
            </div>
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

      {/* Footer hint - only show when there are tracks */}
      {queue.length > 0 && (
        <div
          style={{
            padding: "0.75rem 1.25rem",
            fontSize: "0.625rem",
            color: "#404040",
            textAlign: "center",
            letterSpacing: "0.02em",
          }}
        >
          Drag to reorder
        </div>
      )}
    </aside>
  );
}
