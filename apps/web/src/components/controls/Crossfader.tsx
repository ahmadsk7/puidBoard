"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import type { ClientMutationEvent, ControlOwnership } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";

export type CrossfaderProps = {
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
};

const CONTROL_ID = "crossfader";

/**
 * Horizontal crossfader control.
 */
export default function Crossfader({
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
}: CrossfaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastSendRef = useRef(0);
  const [localValue, setLocalValue] = useState(value);

  // Sync local value with prop when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const sendGrab = useCallback(() => {
    sendEvent({
      type: "CONTROL_GRAB",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId: CONTROL_ID },
    });
  }, [roomId, clientId, sendEvent, nextSeq]);

  const sendRelease = useCallback(() => {
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId: CONTROL_ID },
    });
  }, [roomId, clientId, sendEvent, nextSeq]);

  const sendValue = useCallback(
    (newValue: number) => {
      const now = Date.now();
      if (now - lastSendRef.current < THROTTLE.CONTROL_MS) {
        return;
      }
      lastSendRef.current = now;

      sendEvent({
        type: "MIXER_SET",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: { controlId: CONTROL_ID, value: newValue },
      });
    },
    [roomId, clientId, sendEvent, nextSeq]
  );

  const calculateValue = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return localValue;

      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, ratio));
    },
    [localValue]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      sendGrab();

      const newValue = calculateValue(e.clientX);
      setLocalValue(newValue);
      sendValue(newValue);

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [sendGrab, calculateValue, sendValue]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;

      const newValue = calculateValue(e.clientX);
      setLocalValue(newValue);
      sendValue(newValue);
    },
    [calculateValue, sendValue]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      sendRelease();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [sendRelease]
  );

  // Ownership glow
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  const glowStyle: React.CSSProperties = ownerColor
    ? {
        boxShadow: isOwnedBySelf
          ? `0 0 8px 2px ${ownerColor}`
          : `0 0 12px 3px ${ownerColor}`,
      }
    : {};

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontSize: "0.625rem", color: "#3b82f6", fontWeight: 600 }}>A</span>
        <span style={{ fontSize: "0.625rem", color: "#8b5cf6", fontWeight: 600 }}>B</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: 200,
          height: 32,
          background: "linear-gradient(to right, #3b82f6, #6b7280, #8b5cf6)",
          borderRadius: 4,
          cursor: "pointer",
          touchAction: "none",
          ...glowStyle,
        }}
      >
        {/* Center marker */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            background: "#fff",
            opacity: 0.5,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            left: `${localValue * 100}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 40,
            background: "#fff",
            borderRadius: 2,
            boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
