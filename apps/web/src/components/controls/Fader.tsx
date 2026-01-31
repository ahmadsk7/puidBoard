"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import type { ClientMutationEvent, ControlOwnership } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";

export type FaderProps = {
  controlId: string;
  value: number;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership info (if someone owns this control) */
  ownership?: ControlOwnership;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
  /** Label text */
  label?: string;
  /** Height in pixels */
  height?: number;
  /** Orientation */
  orientation?: "vertical" | "horizontal";
};

/**
 * Fader control component with grab/release/set interaction.
 */
export default function Fader({
  controlId,
  value,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  ownership,
  memberColors,
  label,
  height = 120,
  orientation = "vertical",
}: FaderProps) {
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

  const calculateValue = useCallback(
    (clientX: number, clientY: number) => {
      const track = trackRef.current;
      if (!track) return localValue;

      const rect = track.getBoundingClientRect();
      let ratio: number;

      if (orientation === "vertical") {
        // Inverted: top = 1, bottom = 0
        ratio = 1 - (clientY - rect.top) / rect.height;
      } else {
        ratio = (clientX - rect.left) / rect.width;
      }

      return Math.max(0, Math.min(1, ratio));
    },
    [localValue, orientation]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      sendGrab();

      const newValue = calculateValue(e.clientX, e.clientY);
      setLocalValue(newValue);
      sendValue(newValue);

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [sendGrab, calculateValue, sendValue]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;

      const newValue = calculateValue(e.clientX, e.clientY);
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
  const isOwnedByOther = ownership && ownership.clientId !== clientId;
  const isOwnedBySelf = ownership && ownership.clientId === clientId;
  const ownerColor = ownership && memberColors?.[ownership.clientId];

  const glowStyle: React.CSSProperties = ownerColor
    ? {
        boxShadow: isOwnedBySelf
          ? `0 0 8px 2px ${ownerColor}`
          : `0 0 12px 3px ${ownerColor}`,
      }
    : {};

  const isVertical = orientation === "vertical";
  const trackSize = isVertical ? height : 120;
  const thumbPosition = isVertical
    ? `${(1 - localValue) * 100}%`
    : `${localValue * 100}%`;

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
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: isVertical ? 24 : trackSize,
          height: isVertical ? trackSize : 24,
          background: "linear-gradient(to bottom, #1a1a1a, #0f0f10)",
          borderRadius: 4,
          border: "1px solid #242424",
          cursor: isOwnedByOther ? "not-allowed" : "pointer",
          touchAction: "none",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
          ...glowStyle,
        }}
      >
        {/* Track fill indicator - thin line showing active range */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: isVertical ? "50%" : 0,
            transform: isVertical ? "translateX(-50%)" : "none",
            width: isVertical ? 4 : `${localValue * 100}%`,
            height: isVertical ? `${localValue * 100}%` : 4,
            background: "#3b82f6",
            borderRadius: 2,
            pointerEvents: "none",
          }}
        />
        {/* Thumb with SVG */}
        <img
          src="/assets/dj-controls/faders/fader-handle.svg"
          alt=""
          style={{
            position: "absolute",
            left: isVertical ? "50%" : thumbPosition,
            top: isVertical ? thumbPosition : "50%",
            transform: isVertical ? "translate(-50%, -50%)" : "translate(-50%, -50%) rotate(90deg)",
            width: isVertical ? 28 : 42,
            height: isVertical ? 42 : 28,
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
          }}
        />
      </div>
      <span style={{ fontSize: "0.625rem", color: "#9ca3af" }}>
        {Math.round(localValue * 100)}
      </span>
    </div>
  );
}
