"use client";

import { useCallback, useState, useEffect } from "react";
import type { ClientMutationEvent, FxType, FxState, ControlOwnership } from "@puid-board/shared";
import { Knob } from "./controls";
import { subscribeToFXManager } from "@/audio/fx/manager";
import { FXDisplay } from "./displays";

export type FXStripProps = {
  fxState: FxState;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  controlOwners: Record<string, ControlOwnership>;
  memberColors: Record<string, string>;
};

/** FX type options */
const FX_TYPES: { value: FxType; label: string }[] = [
  { value: "none", label: "OFF" },
  { value: "echo", label: "ECHO" },
  { value: "reverb", label: "REVERB" },
  { value: "filter", label: "FILTER" },
];

/**
 * FX Strip - UI for the FX slot.
 */
export default function FXStrip({
  fxState,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
}: FXStripProps) {
  const [paramInfo, setParamInfo] = useState<{ label: string; displayValue: string; unit: string } | null>(null);

  // Subscribe to FX manager for param info updates
  useEffect(() => {
    const unsubscribe = subscribeToFXManager((state) => {
      setParamInfo(state.paramInfo);
    });
    return unsubscribe;
  }, []);

  // Handle FX type change
  const handleTypeChange = useCallback(
    (type: FxType) => {
      sendEvent({
        type: "FX_SET",
        roomId,
        clientId,
        clientSeq: nextSeq(),
        payload: {
          param: "type",
          value: type,
        },
      });
    },
    [sendEvent, roomId, clientId, nextSeq]
  );

  // Handle toggle
  const handleToggle = useCallback(() => {
    sendEvent({
      type: "FX_TOGGLE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: {
        enabled: !fxState.enabled,
      },
    });
  }, [sendEvent, roomId, clientId, nextSeq, fxState.enabled]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* LCD Display */}
      <FXDisplay
        fxType={fxState.type}
        enabled={fxState.enabled}
        wetDry={fxState.wetDry}
        paramInfo={paramInfo}
      />

      {/* FX Type Selector Buttons */}
      <div
        style={{
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {FX_TYPES.map((fx) => (
          <button
            key={fx.value}
            type="button"
            onClick={() => handleTypeChange(fx.value)}
            style={{
              padding: "4px 8px",
              fontSize: "0.5rem",
              fontWeight: 600,
              background: fxState.type === fx.value ? "#3b82f6" : "#374151",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "background 0.1s",
            }}
          >
            {fx.label}
          </button>
        ))}
      </div>

      {/* Enable/Bypass toggle */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={fxState.type === "none"}
        style={{
          padding: "4px 12px",
          fontSize: "0.6rem",
          fontWeight: 600,
          background: fxState.enabled ? "#22c55e" : "#374151",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: fxState.type === "none" ? "not-allowed" : "pointer",
          opacity: fxState.type === "none" ? 0.5 : 1,
        }}
      >
        {fxState.enabled ? "ON" : "OFF"}
      </button>

      {/* Control Knobs - only show when FX is not "none" */}
      {fxState.type !== "none" && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          {/* Wet/Dry knob */}
          <Knob
            controlId="fx.wetDry"
            value={fxState.wetDry}
            roomId={roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
            ownership={controlOwners["fx.wetDry"]}
            memberColors={memberColors}
            label="WET"
            size={36}
          />

          {/* Parameter knob */}
          <Knob
            controlId="fx.param"
            value={fxState.param}
            roomId={roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
            ownership={controlOwners["fx.param"]}
            memberColors={memberColors}
            label={paramInfo?.label ?? "PARAM"}
            size={36}
          />
        </div>
      )}
    </div>
  );
}
