"use client";

import { useCallback } from "react";
import type { ClientMutationEvent, FxType, FxState, ControlOwnership } from "@puid-board/shared";
import { Fader, Knob } from "./controls";

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

/** FX button definitions - no "none" option, order: FILTER, ECHO, REVERB */
const FX_BUTTONS: { value: Exclude<FxType, "none">; label: string }[] = [
  { value: "filter", label: "FILTER" },
  { value: "echo", label: "ECHO" },
  { value: "reverb", label: "REVERB" },
];

/**
 * FX Control Panel - Refactored design with vertical stacked buttons
 *
 * LAYOUT:
 * - Container: 224px wide x 132px tall (positioned at x=688, y=346)
 * - FX buttons + knob: top portion (~50% of height)
 * - Channel A fader: left slider hole (x=51 relative)
 * - Channel B fader: right slider hole (x=173 relative)
 *
 * BEHAVIOR:
 * - Only one FX can be active at a time
 * - Clicking active button deactivates FX (sets type to "none")
 * - Clicking different button switches to that FX and enables it
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
  // Handle FX button click
  // - If clicking the active FX button, turn it off (set type to "none" and disable)
  // - If clicking a different button, switch to that FX and enable it
  const handleFXButtonClick = useCallback(
    (type: Exclude<FxType, "none">) => {
      const isCurrentlyActive = fxState.type === type && fxState.enabled;

      if (isCurrentlyActive) {
        // Turn off the FX
        sendEvent({
          type: "FX_SET",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: { param: "type", value: "none" },
        });
        sendEvent({
          type: "FX_TOGGLE",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: { enabled: false },
        });
      } else {
        // Switch to this FX and enable it
        sendEvent({
          type: "FX_SET",
          roomId,
          clientId,
          clientSeq: nextSeq(),
          payload: { param: "type", value: type },
        });
        if (!fxState.enabled) {
          sendEvent({
            type: "FX_TOGGLE",
            roomId,
            clientId,
            clientSeq: nextSeq(),
            payload: { enabled: true },
          });
        }
      }
    },
    [sendEvent, roomId, clientId, nextSeq, fxState.type, fxState.enabled]
  );

  // SVG-aligned positions (relative to container at x=688, y=346)
  const SLIDER_LEFT_X = 51;   // Center of left slider hole
  const SLIDER_RIGHT_X = 173; // Center of right slider hole
  const SLIDER_Y = 38;        // Top of slider area
  const SLIDER_HEIGHT = 70;   // Slider track height

  // FX control area (buttons + knob) positioned at top center
  const FX_AREA_CENTER_X = 112; // Centered between the two sliders
  const FX_AREA_Y = 10;         // Balanced spacing from top

  return (
    <div
      style={{
        position: "relative",
        width: 224,
        height: 132,
        pointerEvents: "auto",
        zIndex: 10,
      }}
    >
      {/* FX Control Area - Buttons + Knob */}
      <div
        style={{
          position: "absolute",
          left: FX_AREA_CENTER_X,
          top: FX_AREA_Y,
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* Vertical stacked FX buttons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {FX_BUTTONS.map((fx) => {
            const isActive = fxState.type === fx.value && fxState.enabled;
            return (
              <button
                key={fx.value}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFXButtonClick(fx.value);
                }}
                style={{
                  width: 52,
                  padding: "3px 6px",
                  fontSize: "0.5rem",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  background: isActive ? "#3b82f6" : "#374151",
                  color: isActive ? "#fff" : "#9ca3af",
                  border: "1px solid #4b5563",
                  borderRadius: 3,
                  cursor: "pointer",
                  transition: "all 0.1s",
                  pointerEvents: "auto",
                  boxShadow: isActive
                    ? "0 0 8px rgba(59, 130, 246, 0.5)"
                    : "0 1px 2px rgba(0, 0, 0, 0.3)",
                }}
              >
                {fx.label}
              </button>
            );
          })}
        </div>

        {/* Magnitude knob */}
        <Knob
          controlId="fx.param"
          value={fxState.param}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["fx.param"]}
          memberColors={memberColors}
          size={36}
        />
      </div>

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
    </div>
  );
}
