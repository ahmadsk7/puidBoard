"use client";

import type {
  ClientMutationEvent,
  RoomState,
  DeckState,
  ChannelState,
  ControlOwnership,
} from "@puid-board/shared";
import { Fader, Knob, EQControl, Crossfader } from "./controls";
import { buildMemberColorMap } from "./CursorsLayer";

export type DJBoardProps = {
  state: RoomState;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
};

/** Deck display component */
function DeckPanel({
  deck,
  deckLabel,
  channel,
  channelPrefix,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
  accentColor,
}: {
  deck: DeckState;
  deckLabel: string;
  channel: ChannelState;
  channelPrefix: string;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  controlOwners: Record<string, ControlOwnership>;
  memberColors: Record<string, string>;
  accentColor: string;
}) {
  const hasTrack = deck.loadedTrackId !== null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "1rem",
        background: "#1f2937",
        borderRadius: 8,
        minWidth: 200,
      }}
    >
      {/* Deck header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          width: "100%",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: accentColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            color: "#fff",
            fontSize: "0.875rem",
          }}
        >
          {deckLabel}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#9ca3af",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {hasTrack ? "Track loaded" : "No track"}
          </div>
          <div
            style={{
              fontSize: "0.625rem",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            {deck.playState}
          </div>
        </div>
      </div>

      {/* Jog wheel placeholder */}
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: `linear-gradient(145deg, #374151, #1f2937)`,
          border: `3px solid ${accentColor}40`,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b7280",
          fontSize: "0.75rem",
        }}
      >
        JOG
      </div>

      {/* Channel controls */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        {/* Gain knob */}
        <Knob
          controlId={`${channelPrefix}.gain`}
          value={channel.gain}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners[`${channelPrefix}.gain`]}
          memberColors={memberColors}
          label="GAIN"
          size={40}
          min={-1}
          max={1}
          bipolar
        />

        {/* EQ */}
        <EQControl
          controlIdPrefix={`${channelPrefix}.eq`}
          eq={channel.eq}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={controlOwners}
          memberColors={memberColors}
        />

        {/* Channel fader */}
        <Fader
          controlId={`${channelPrefix}.fader`}
          value={channel.fader}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners[`${channelPrefix}.fader`]}
          memberColors={memberColors}
          label="VOL"
          height={140}
        />
      </div>
    </div>
  );
}

/** Mixer section */
function MixerPanel({
  mixer,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
}: {
  mixer: RoomState["mixer"];
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  controlOwners: Record<string, ControlOwnership>;
  memberColors: Record<string, string>;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "1rem",
        background: "#1f2937",
        borderRadius: 8,
        gap: 16,
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: 600 }}>
        MIXER
      </div>

      {/* Master volume */}
      <Knob
        controlId="masterVolume"
        value={mixer.masterVolume}
        roomId={roomId}
        clientId={clientId}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
        ownership={controlOwners["masterVolume"]}
        memberColors={memberColors}
        label="MASTER"
        size={48}
      />

      {/* Crossfader */}
      <Crossfader
        value={mixer.crossfader}
        roomId={roomId}
        clientId={clientId}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
        ownership={controlOwners["crossfader"]}
        memberColors={memberColors}
      />
    </div>
  );
}

/**
 * Main DJ Board component with two decks and mixer.
 */
export default function DJBoard({
  state,
  clientId,
  sendEvent,
  nextSeq,
}: DJBoardProps) {
  const memberColors = buildMemberColorMap(state.members);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "1rem",
        background: "#111827",
        borderRadius: 12,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 0.5rem",
        }}
      >
        <span style={{ fontSize: "0.875rem", color: "#fff", fontWeight: 600 }}>
          DJ Board
        </span>
        <span style={{ fontSize: "0.625rem", color: "#6b7280" }}>
          v{state.version}
        </span>
      </div>

      {/* Main layout: Deck A | Mixer | Deck B */}
      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Deck A */}
        <DeckPanel
          deck={state.deckA}
          deckLabel="A"
          channel={state.mixer.channelA}
          channelPrefix="channelA"
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
          accentColor="#3b82f6"
        />

        {/* Mixer */}
        <MixerPanel
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* Deck B */}
        <DeckPanel
          deck={state.deckB}
          deckLabel="B"
          channel={state.mixer.channelB}
          channelPrefix="channelB"
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
          accentColor="#8b5cf6"
        />
      </div>
    </div>
  );
}
