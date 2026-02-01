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
  // When selecting a type (ECHO/REVERB/FILTER), automatically enable the FX
  // When selecting OFF, disable the FX as well
  const handleTypeChange = useCallback(
    (type: FxType) => {
      console.log("[FXControlPanel] Type change clicked:", type, "current type:", fxState.type);

      // Send FX_SET to change the type
      console.log("[FXControlPanel] Sending FX_SET event with type:", type);
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

      // Auto-enable when selecting an effect, auto-disable when selecting "none"
      const shouldEnable = type !== "none";
      if (shouldEnable !== fxState.enabled) {
        console.log("[FXControlPanel] Auto-toggling enabled:", shouldEnable);
        sendEvent({
          type: "FX_TOGGLE",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: {
            enabled: shouldEnable,
          },
        });
      }
    },
    [sendEvent, roomId, clientId, nextSeq, fxState.type, fxState.enabled]
  );

  // Handle toggle
  const handleToggle = useCallback(() => {
    console.log("[FXControlPanel] Toggle clicked, current state:", fxState.enabled, "new state:", !fxState.enabled);
    console.log("[FXControlPanel] Sending FX_TOGGLE event");
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

  // Debug: log current fxState on every render
  console.log("[FXControlPanel] Render - fxState:", fxState);

  // SVG-aligned positions (relative to container at x=688, y=346)
  // Slider holes: left at x=730 w=18, right at x=852 w=18, both at y=384 h=84
  // Centers: left=730+9=739, right=852+9=861
  // Fader handle is 60px tall, so reduce track height to fit within bounds
  const SLIDER_LEFT_X = 51;   // 739 - 688 (center of left hole)
  const SLIDER_RIGHT_X = 173; // 861 - 688 (center of right hole)
  const SLIDER_Y = 38;        // 384 - 346
  const SLIDER_HEIGHT = 70;   // Reduced from 84 to account for fader handle size

  const LCD_CENTER_X = 112;   // (739 + 861) / 2 - 688 = 800 - 688
  const LCD_Y = 8;
  const LCD_WIDTH = 70;       // Narrower to avoid overlapping sliders

  return (
    <div
      style={{
        position: "relative",
        width: 224,
        height: 132,
        pointerEvents: "auto",
        zIndex: 10,
      }}
      onClick={(e) => {
        console.log("[FXControlPanel] Container clicked at:", e.clientX, e.clientY);
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
          padding: "4px 6px",
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          width: `${LCD_WIDTH}px`,
        }}
      >
        {/* Header with FX label and LED */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1px",
          }}
        >
          <span
            style={{
              fontSize: "6px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#6b7280",
            }}
          >
            FX
          </span>
          {/* Status LED */}
          <div
            style={{
              width: "3px",
              height: "3px",
              borderRadius: "50%",
              background: isActive ? "#22c55e" : "#ef4444",
              boxShadow: `0 0 3px ${isActive ? "#22c55e" : "#ef4444"}`,
              opacity: fxState.type === "none" ? 0.3 : 1,
            }}
          />
        </div>

        {/* FX Type Display */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            borderRadius: "3px",
            padding: "2px 4px",
            textAlign: "center",
            border: isActive ? "1px solid #3b82f6" : fxState.type !== "none" && !fxState.enabled ? "1px solid #ef4444" : "1px solid #1a1a1a",
            marginBottom: "1px",
          }}
        >
          <div
            style={{
              fontSize: "9px",
              fontWeight: 700,
              fontFamily: "monospace",
              color: isActive ? "#60a5fa" : fxState.type !== "none" && !fxState.enabled ? "#ef4444" : "#6b7280",
              letterSpacing: "0.02em",
            }}
          >
            {fxState.type === "none" ? "OFF" : fxState.enabled ? fxLabel : `${fxLabel} [BYP]`}
          </div>
        </div>

        {/* FX Type Selector Buttons - Compact 2×2 grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1px",
            marginBottom: "1px",
          }}
        >
          {FX_TYPES.map((fx) => (
            <button
              key={fx.value}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[FXControlPanel] FX type button clicked:", fx.value);
                handleTypeChange(fx.value);
              }}
              style={{
                padding: "1px 2px",
                fontSize: "0.4rem",
                fontWeight: 700,
                background: fxState.type === fx.value ? "#3b82f6" : "#1a1a1a",
                color: fxState.type === fx.value ? "#fff" : "#6b7280",
                border: "1px solid #2a2a2a",
                borderRadius: "2px",
                cursor: "pointer",
                transition: "all 0.1s",
                letterSpacing: "0.01em",
                pointerEvents: "auto",
              }}
            >
              {fx.label}
            </button>
          ))}
        </div>

        {/* BYPASS Toggle - Only show when an effect is selected */}
        {fxState.type !== "none" && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log("[FXControlPanel] BYPASS toggle clicked - fxType=", fxState.type, "enabled=", fxState.enabled);
              console.log("[FXControlPanel] Executing toggle action");
              handleToggle();
            }}
            style={{
              padding: "2px 4px",
              fontSize: "0.45rem",
              fontWeight: 700,
              background: fxState.enabled ? "#22c55e" : "#ef4444",
              color: "#fff",
              border: "1px solid #2a2a2a",
              borderRadius: "2px",
              cursor: "pointer",
              letterSpacing: "0.03em",
              transition: "all 0.1s",
              pointerEvents: "auto",
            }}
            title={fxState.enabled ? "Click to BYPASS effect" : "Click to ENABLE effect"}
          >
            {fxState.enabled ? "ACTIVE" : "BYPASS"}
          </button>
        )}

        {/* Parameter Info - Only show when active */}
        {fxState.type !== "none" && paramInfo && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: "1px",
              borderTop: "1px solid #1a1a1a",
            }}
          >
            <span
              style={{
                fontSize: "5px",
                fontWeight: 600,
                color: "#6b7280",
                letterSpacing: "0.03em",
              }}
            >
              {paramInfo.label}
            </span>
            <span
              style={{
                fontSize: "6px",
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
