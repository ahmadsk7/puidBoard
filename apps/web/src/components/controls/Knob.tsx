"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import type { ClientMutationEvent, ControlOwnership } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";

export type KnobProps = {
  controlId: string;
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
  /** Label text */
  label?: string;
  /** Size in pixels */
  size?: number;
  /** Min value (default 0) */
  min?: number;
  /** Max value (default 1) */
  max?: number;
  /** Whether the knob is bipolar (center = neutral) */
  bipolar?: boolean;
};

/**
 * Rotary knob control with grab/release/set interaction.
 */
export default function Knob({
  controlId,
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
  label,
  size = 48,
  min = 0,
  max = 1,
  bipolar = false,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startValueRef = useRef(0);
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
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  const sendRelease = useCallback(() => {
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

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
        payload: { controlId, value: newValue },
      });
    },
    [controlId, roomId, clientId, sendEvent, nextSeq]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startValueRef.current = localValue;
      sendGrab();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [localValue, sendGrab]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;

      // Vertical drag: up increases, down decreases
      const deltaY = startYRef.current - e.clientY;
      const sensitivity = 200; // pixels for full range
      const deltaValue = (deltaY / sensitivity) * (max - min);
      const newValue = Math.max(min, Math.min(max, startValueRef.current + deltaValue));

      setLocalValue(newValue);
      sendValue(newValue);
    },
    [min, max, sendValue]
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

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    const resetValue = bipolar ? (min + max) / 2 : min;
    setLocalValue(resetValue);
    sendGrab();
    sendValue(resetValue);
    sendRelease();
  }, [bipolar, min, max, sendGrab, sendValue, sendRelease]);

  // Calculate rotation angle (270 degree range: -135 to +135)
  const normalizedValue = (localValue - min) / (max - min);
  const rotation = -135 + normalizedValue * 270;

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
      {label && (
        <span style={{ fontSize: "0.625rem", color: "#6b7280", fontWeight: 500 }}>
          {label}
        </span>
      )}
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          background: "linear-gradient(145deg, #374151, #1f2937)",
          cursor: "pointer",
          touchAction: "none",
          ...glowStyle,
        }}
      >
        {/* Inner circle */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "10%",
            width: "80%",
            height: "80%",
            borderRadius: "50%",
            background: "linear-gradient(145deg, #4b5563, #374151)",
            transform: `rotate(${rotation}deg)`,
            pointerEvents: "none",
          }}
        >
          {/* Indicator line */}
          <div
            style={{
              position: "absolute",
              top: "8%",
              left: "50%",
              width: 3,
              height: "25%",
              background: "#fff",
              borderRadius: 2,
              transform: "translateX(-50%)",
            }}
          />
        </div>
        {/* Bipolar center marker */}
        {bipolar && (
          <div
            style={{
              position: "absolute",
              top: 2,
              left: "50%",
              width: 2,
              height: 6,
              background: "#9ca3af",
              transform: "translateX(-50%)",
              borderRadius: 1,
            }}
          />
        )}
      </div>
    </div>
  );
}
