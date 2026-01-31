"use client";

import { useCallback, useState, useEffect } from "react";
import type { ClientMutationEvent, FxType, FxState, ControlOwnership } from "@puid-board/shared";
import { Fader } from "./controls";
import { subscribeToFXManager } from "@/audio/fx/manager";

export type FXControlPanelProps = {
  fxState: FxState;
  channelAFader: number;
  channelBFader: number;
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
  { value: "filter", label: "FLTR" },
];

/**
 * FX Control Panel - Aligned to SVG background with sliders at exact positions
 *
 * POSITIONING (relative to mixer faders container at x=688, y=346):
 * - Container: 224px wide × 132px tall
 * - Left slider hole: x=42 (730-688), y=38 (384-346), w=18, h=84
 * - Right slider hole: x=164 (852-688), y=38, w=18, h=84
 * - LCD screen: centered between sliders at x=103 (relative), y=48
 */
export default function FXControlPanel({
  fxState,
  channelAFader,
  channelBFader,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
}: FXControlPanelProps) {
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

  const isActive = fxState.type !== "none" && fxState.enabled;
  const fxLabel = fxState.type === "none" ? "OFF" : fxState.type.toUpperCase();

  // SVG-aligned positions (relative to container at x=688, y=346)
  // Slider holes: left at x=730 w=18, right at x=852 w=18, both at y=384 h=84
  // Centers: left=730+9=739, right=852+9=861
  const SLIDER_LEFT_X = 51;   // 739 - 688 (center of left hole)
  const SLIDER_RIGHT_X = 173; // 861 - 688 (center of right hole)
  const SLIDER_Y = 38;        // 384 - 346
  const SLIDER_HEIGHT = 84;

  const LCD_CENTER_X = 112;   // (739 + 861) / 2 - 688 = 800 - 688
  const LCD_Y = 8;

  return (
    <div
      style={{
        position: "relative",
        width: 224,
        height: 132,
      }}
    >
      {/* Channel A Fader - Aligned to left slider hole */}
      <div
        style={{
          position: "absolute",
          left: SLIDER_LEFT_X,
          top: SLIDER_Y,
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontSize: "0.5rem", color: "#3b82f6", fontWeight: 600 }}>A</span>
        <Fader
          controlId="channelA.fader"
          value={channelAFader}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelA.fader"]}
          memberColors={memberColors}
          height={SLIDER_HEIGHT}
        />
      </div>

      {/* Channel B Fader - Aligned to right slider hole */}
      <div
        style={{
          position: "absolute",
          left: SLIDER_RIGHT_X,
          top: SLIDER_Y,
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontSize: "0.5rem", color: "#8b5cf6", fontWeight: 600 }}>B</span>
        <Fader
          controlId="channelB.fader"
          value={channelBFader}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelB.fader"]}
          memberColors={memberColors}
          height={SLIDER_HEIGHT}
        />
      </div>

      {/* Compact LCD Display - Centered between sliders */}
      <div
        style={{
          position: "absolute",
          left: LCD_CENTER_X,
          top: LCD_Y,
          transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #050508 0%, #0a0a0c 100%)",
          border: "1px solid #1a1a1a",
          borderRadius: "6px",
          boxShadow: `
            inset 0 2px 4px rgba(0, 0, 0, 0.7),
            0 2px 8px rgba(0, 0, 0, 0.5),
            inset 0 0 12px ${isActive ? "rgba(59, 130, 246, 0.15)" : "rgba(0, 0, 0, 0.3)"}
          `,
          padding: "6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          width: "90px",
        }}
      >
        {/* Header with FX label and LED */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2px",
          }}
        >
          <span
            style={{
              fontSize: "7px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#6b7280",
            }}
          >
            FX
          </span>
          {/* Status LED */}
          <div
            style={{
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              background: isActive ? "#22c55e" : "#ef4444",
              boxShadow: `0 0 4px ${isActive ? "#22c55e" : "#ef4444"}`,
              opacity: fxState.type === "none" ? 0.3 : 1,
            }}
          />
        </div>

        {/* FX Type Display */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            borderRadius: "3px",
            padding: "3px 6px",
            textAlign: "center",
            border: isActive ? "1px solid #3b82f6" : "1px solid #1a1a1a",
            marginBottom: "2px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              fontFamily: "monospace",
              color: isActive ? "#60a5fa" : "#6b7280",
              letterSpacing: "0.03em",
            }}
          >
            {fxState.enabled ? fxLabel : "BYPASS"}
          </div>
        </div>

        {/* FX Type Selector Buttons - Compact 2×2 grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "2px",
            marginBottom: "2px",
          }}
        >
          {FX_TYPES.map((fx) => (
            <button
              key={fx.value}
              type="button"
              onClick={() => handleTypeChange(fx.value)}
              style={{
                padding: "2px 4px",
                fontSize: "0.45rem",
                fontWeight: 700,
                background: fxState.type === fx.value ? "#3b82f6" : "#1a1a1a",
                color: fxState.type === fx.value ? "#fff" : "#6b7280",
                border: "1px solid #2a2a2a",
                borderRadius: "2px",
                cursor: "pointer",
                transition: "all 0.1s",
                letterSpacing: "0.02em",
              }}
            >
              {fx.label}
            </button>
          ))}
        </div>

        {/* ON/OFF Toggle - Full width */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={fxState.type === "none"}
          style={{
            padding: "3px 6px",
            fontSize: "0.5rem",
            fontWeight: 700,
            background: fxState.enabled ? "#22c55e" : "#1a1a1a",
            color: fxState.enabled ? "#fff" : "#6b7280",
            border: "1px solid #2a2a2a",
            borderRadius: "3px",
            cursor: fxState.type === "none" ? "not-allowed" : "pointer",
            opacity: fxState.type === "none" ? 0.4 : 1,
            letterSpacing: "0.05em",
            transition: "all 0.1s",
          }}
        >
          {fxState.enabled ? "ON" : "OFF"}
        </button>

        {/* Parameter Info - Only show when active */}
        {fxState.type !== "none" && paramInfo && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: "2px",
              borderTop: "1px solid #1a1a1a",
            }}
          >
            <span
              style={{
                fontSize: "6px",
                fontWeight: 600,
                color: "#6b7280",
                letterSpacing: "0.05em",
              }}
            >
              {paramInfo.label}
            </span>
            <span
              style={{
                fontSize: "7px",
                fontWeight: 700,
                fontFamily: "monospace",
                color: isActive ? "#60a5fa" : "#6b7280",
              }}
            >
              {paramInfo.displayValue}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
