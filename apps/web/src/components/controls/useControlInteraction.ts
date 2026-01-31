"use client";

import { useRef, useCallback, useEffect } from "react";
import type { ClientMutationEvent } from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";

export type ControlInteractionProps = {
  controlId: string;
  roomId: string;
  clientId: string;
  value: number;
  min?: number;
  max?: number;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Called when local value changes (for optimistic update) */
  onLocalChange?: (value: number) => void;
};

export type ControlInteractionResult = {
  /** Call on mouse/touch down */
  onGrab: () => void;
  /** Call on mouse/touch up */
  onRelease: () => void;
  /** Call on value change (throttled) */
  onChange: (newValue: number) => void;
  /** Whether the control is currently grabbed by this client */
  isGrabbed: boolean;
};

/**
 * Hook for managing control grab/release/set interactions.
 * Handles CONTROL_GRAB on mousedown, MIXER_SET on move (throttled), CONTROL_RELEASE on mouseup.
 */
export function useControlInteraction({
  controlId,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  onLocalChange,
}: ControlInteractionProps): ControlInteractionResult {
  const isGrabbedRef = useRef(false);
  const lastSendRef = useRef(0);

  const onGrab = useCallback(() => {
    if (isGrabbedRef.current) return;
    isGrabbedRef.current = true;
    
    sendEvent({
      type: "CONTROL_GRAB",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  const onRelease = useCallback(() => {
    if (!isGrabbedRef.current) return;
    isGrabbedRef.current = false;
    
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  const onChange = useCallback(
    (newValue: number) => {
      // Always update local state immediately for responsiveness
      onLocalChange?.(newValue);

      // Throttle network sends
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
    [controlId, roomId, clientId, sendEvent, nextSeq, onLocalChange]
  );

  // Release on unmount or window blur
  useEffect(() => {
    const handleBlur = () => {
      if (isGrabbedRef.current) {
        onRelease();
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      if (isGrabbedRef.current) {
        onRelease();
      }
    };
  }, [onRelease]);

  return {
    onGrab,
    onRelease,
    onChange,
    isGrabbed: isGrabbedRef.current,
  };
}
