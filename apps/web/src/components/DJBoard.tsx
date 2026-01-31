"use client";

import type {
  ClientMutationEvent,
  RoomState,
  DeckState,
  ChannelState,
  ControlOwnership,
  QueueItem,
} from "@puid-board/shared";
import { Fader, Knob, EQControl, Crossfader } from "./controls";
import { buildMemberColorMap } from "./CursorsLayer";
import DeckTransport from "./DeckTransport";
import ClippingIndicator from "./ClippingIndicator";
import FXStrip from "./FXStrip";
import { useMixerSync } from "@/audio/useMixer";

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
  deckId,
  channel,
  channelPrefix,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
  accentColor,
  queue,
}: {
  deck: DeckState;
  deckLabel: string;
  deckId: "A" | "B";
  channel: ChannelState;
  channelPrefix: string;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  controlOwners: Record<string, ControlOwnership>;
  memberColors: Record<string, string>;
  accentColor: string;
  queue: QueueItem[];
}) {
  const hasTrack = deck.loadedTrackId !== null;
  const isPlaying = deck.playState === "playing";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "1rem",
        background: "transparent",
        borderRadius: 8,
        minWidth: 200,
        overflow: "hidden",
      }}
    >
      {/* Deck background */}
      <img
        src="/assets/dj-controls/backgrounds/deck-panel-bg.svg"
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.5,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* Corner screws */}
      <img
        src="/assets/dj-controls/decorative/panel-screws.svg"
        alt=""
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          width: 16,
          height: 16,
          opacity: 0.5,
          zIndex: 1,
        }}
      />
      <img
        src="/assets/dj-controls/decorative/panel-screws.svg"
        alt=""
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 16,
          height: 16,
          opacity: 0.5,
          zIndex: 1,
        }}
      />

      {/* Content */}
      <div style={{ position: "relative", zIndex: 2 }}>
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
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <img
                src={isPlaying
                  ? "/assets/dj-controls/indicators/led-indicator-green.svg"
                  : hasTrack
                    ? "/assets/dj-controls/indicators/led-indicator-orange.svg"
                    : "/assets/dj-controls/indicators/led-indicator-red.svg"}
                alt=""
                style={{ width: 8, height: 8 }}
              />
              {deck.playState}
            </div>
          </div>
        </div>

        {/* Jog wheel with SVG */}
        <div
          style={{
            position: "relative",
            width: 120,
            height: 120,
            marginBottom: 12,
          }}
        >
          <img
            src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
            alt={`Deck ${deckLabel} jog wheel`}
            style={{
              width: "100%",
              height: "100%",
              filter: `drop-shadow(0 0 8px ${accentColor}40)`,
            }}
          />
          <img
            src="/assets/dj-controls/wheels/jog-wheel-center-cap.svg"
            alt=""
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "30%",
              height: "30%",
            }}
          />
        </div>

        {/* Transport controls */}
        <DeckTransport
          deckId={deckId}
          serverState={deck}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          accentColor={accentColor}
          queue={queue}
        />

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

        {/* Vent grille at bottom */}
        <img
          src="/assets/dj-controls/decorative/vent-grille.svg"
          alt=""
          style={{
            width: "100%",
            height: 12,
            marginTop: 12,
            opacity: 0.6,
          }}
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
  // Determine signal level for LED indicators (simplified)
  const masterLevel = mixer.masterVolume;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "1rem",
        background: "transparent",
        borderRadius: 8,
        gap: 16,
        overflow: "hidden",
      }}
    >
      {/* Mixer background */}
      <img
        src="/assets/dj-controls/backgrounds/mixer-center-bg.svg"
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.5,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: 600 }}>
            MIXER
          </span>
          <ClippingIndicator compact />
        </div>

        {/* Signal level indicators */}
        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
          }}
        >
          <img
            src="/assets/dj-controls/indicators/led-indicator-green.svg"
            alt=""
            style={{ width: 10, height: 10, opacity: masterLevel > 0.1 ? 1 : 0.3 }}
          />
          <img
            src="/assets/dj-controls/indicators/led-indicator-green.svg"
            alt=""
            style={{ width: 10, height: 10, opacity: masterLevel > 0.3 ? 1 : 0.3 }}
          />
          <img
            src="/assets/dj-controls/indicators/led-indicator-orange.svg"
            alt=""
            style={{ width: 10, height: 10, opacity: masterLevel > 0.5 ? 1 : 0.3 }}
          />
          <img
            src="/assets/dj-controls/indicators/led-indicator-orange.svg"
            alt=""
            style={{ width: 10, height: 10, opacity: masterLevel > 0.7 ? 1 : 0.3 }}
          />
          <img
            src="/assets/dj-controls/indicators/led-indicator-red.svg"
            alt=""
            style={{ width: 10, height: 10, opacity: masterLevel > 0.9 ? 1 : 0.3 }}
          />
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

        {/* FX Strip */}
        <FXStrip
          fxState={mixer.fx}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={controlOwners}
          memberColors={memberColors}
        />

        {/* Decorative vent */}
        <img
          src="/assets/dj-controls/decorative/vent-grille.svg"
          alt=""
          style={{
            width: "80%",
            height: 12,
            marginTop: 8,
            opacity: 0.6,
          }}
        />
      </div>
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

  // Sync mixer state to audio graph for remote changes
  useMixerSync(state.mixer);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 0,
        borderRadius: 12,
        fontFamily: "system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* SVG Background */}
      <img
        src="/assets/dj-controls/backgrounds/mixer-panel-background.svg"
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* Decorative corners */}
      <img
        src="/assets/dj-controls/decorative/corner-accent.svg"
        alt=""
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          width: 32,
          height: 32,
          opacity: 0.6,
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      <img
        src="/assets/dj-controls/decorative/corner-accent.svg"
        alt=""
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 32,
          height: 32,
          opacity: 0.6,
          zIndex: 1,
          transform: "scaleX(-1)",
          pointerEvents: "none",
        }}
      />

      {/* Content layer */}
      <div style={{ position: "relative", zIndex: 2, padding: "1rem" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 0.5rem",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src="/assets/dj-controls/decorative/logo.svg"
              alt="DJ Board"
              style={{ width: 24, height: 24, opacity: 0.8 }}
            />
            <span style={{ fontSize: "0.875rem", color: "#fff", fontWeight: 600 }}>
              DJ Board
            </span>
          </div>
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
            deckId="A"
            channel={state.mixer.channelA}
            channelPrefix="channelA"
            roomId={state.roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
            controlOwners={state.controlOwners}
            memberColors={memberColors}
            accentColor="#3b82f6"
            queue={state.queue}
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
            deckId="B"
            channel={state.mixer.channelB}
            channelPrefix="channelB"
            roomId={state.roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
            controlOwners={state.controlOwners}
            memberColors={memberColors}
            accentColor="#8b5cf6"
            queue={state.queue}
          />
        </div>
      </div>
    </div>
  );
}
