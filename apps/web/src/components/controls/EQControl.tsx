"use client";

import type { ClientMutationEvent, ControlOwnership, EqState } from "@puid-board/shared";
import Knob from "./Knob";

export type EQControlProps = {
  /** Base control ID prefix (e.g., "channelA.eq") */
  controlIdPrefix: string;
  eq: EqState;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  /** Control ownership map */
  controlOwners?: Record<string, ControlOwnership>;
  /** Member color map for glow */
  memberColors?: Record<string, string>;
};

/**
 * 3-band EQ control (High, Mid, Low knobs).
 */
export default function EQControl({
  controlIdPrefix,
  eq,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
}: EQControlProps) {
  const bands: Array<{ key: keyof EqState; label: string }> = [
    { key: "high", label: "HI" },
    { key: "mid", label: "MID" },
    { key: "low", label: "LO" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {bands.map(({ key, label }) => {
        const controlId = `${controlIdPrefix}.${key}`;
        return (
          <Knob
            key={key}
            controlId={controlId}
            value={eq[key]}
            roomId={roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
            ownership={controlOwners?.[controlId]}
            memberColors={memberColors}
            label={label}
            size={36}
            min={-1}
            max={1}
            bipolar
          />
        );
      })}
    </div>
  );
}
