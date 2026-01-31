"use client";

import type {
  ClientMutationEvent,
  RoomState,
  DeckState,
  ControlOwnership,
  QueueItem,
} from "@puid-board/shared";
import { Fader, Knob, Crossfader, JogWheel } from "./controls";
import { buildMemberColorMap } from "./CursorsLayer";
import DeckTransport from "./DeckTransport";
import ClippingIndicator from "./ClippingIndicator";
import FXStrip from "./FXStrip";
import { useMixerSync } from "@/audio/useMixer";
import { useDeck } from "@/audio/useDeck";

export type DJBoardProps = {
  state: RoomState;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
};

// Board dimensions based on the SVG viewBox
const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 600;

// Deck A positions (from SVG)
const DECK_A = {
  // Waveform display area
  waveform: { x: 110, y: 138, width: 492, height: 92 },
  // Jog wheel center
  jogWheel: { cx: 290, cy: 350, r: 150 },
  // Controls area (right of jog wheel)
  controls: { x: 430, y: 312, width: 160, height: 132 },
};

// Deck B positions (from SVG - mirrored)
const DECK_B = {
  waveform: { x: 998, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 1310, cy: 350, r: 150 },
  controls: { x: 1010, y: 312, width: 160, height: 132 },
};

// Mixer positions (from SVG)
const MIXER = {
  // Display area
  display: { x: 688, y: 170, width: 224, height: 160 },
  // Knob positions
  knobs: {
    topLeft: { cx: 744, cy: 238, r: 26 },
    topRight: { cx: 856, cy: 238, r: 26 },
    bottomLeft: { cx: 744, cy: 302, r: 26 },
    bottomRight: { cx: 856, cy: 302, r: 26 },
  },
  // Fader area
  faders: { x: 688, y: 346, width: 224, height: 132 },
  // Channel fader positions
  channelA: { x: 730, y: 384, width: 18, height: 84 },
  channelB: { x: 852, y: 384, width: 18, height: 84 },
  // Crossfader area
  crossfader: { x: 552, y: 534, width: 496, height: 34 },
};

/** Deck waveform and transport display */
function DeckDisplay({
  deck,
  deckId,
  deckLabel,
  position,
  accentColor,
}: {
  deck: DeckState;
  deckId: "A" | "B";
  deckLabel: string;
  position: { x: number; y: number; width: number; height: number };
  accentColor: string;
}) {
  const hasTrack = deck.loadedTrackId !== null;
  const isPlaying = deck.playState === "playing";

  // Get the progress from local audio state
  const localDeck = useDeck(deckId);
  const progress = localDeck.duration > 0 ? localDeck.playhead / localDeck.duration : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: `${(position.x / BOARD_WIDTH) * 100}%`,
        top: `${(position.y / BOARD_HEIGHT) * 100}%`,
        width: `${(position.width / BOARD_WIDTH) * 100}%`,
        height: `${(position.height / BOARD_HEIGHT) * 100}%`,
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px",
        gap: 4,
      }}
    >
      {/* Track info */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: accentColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              color: "#fff",
              fontSize: "0.75rem",
            }}
          >
            {deckLabel}
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: hasTrack ? "#fff" : "#6b7280",
              fontWeight: 500,
            }}
          >
            {hasTrack ? "Track Loaded" : "Empty"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <img
            src={isPlaying
              ? "/assets/dj-controls/indicators/led-indicator-green.svg"
              : hasTrack
                ? "/assets/dj-controls/indicators/led-indicator-orange.svg"
                : "/assets/dj-controls/indicators/led-indicator-red.svg"}
            alt=""
            style={{ width: 10, height: 10 }}
          />
          <span style={{ fontSize: "0.625rem", color: "#9ca3af", textTransform: "uppercase" }}>
            {deck.playState}
          </span>
        </div>
      </div>

      {/* Waveform visualization placeholder */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(90deg, rgba(59,130,246,0.1) 0%, rgba(139,92,246,0.1) 100%)",
          borderRadius: 4,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Fake waveform bars */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            padding: "0 8px",
            opacity: hasTrack ? 1 : 0.3,
          }}
        >
          {Array.from({ length: 48 }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${20 + Math.sin(i * 0.5) * 40 + Math.random() * 20}%`,
                background: i / 48 < progress
                  ? `linear-gradient(180deg, ${accentColor}, ${accentColor}80)`
                  : "#374151",
                borderRadius: 1,
                transition: "background 0.1s",
              }}
            />
          ))}
        </div>

        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            left: `${progress * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "#fff",
            boxShadow: "0 0 8px rgba(255,255,255,0.5)",
          }}
        />
      </div>

      {/* Time display */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "monospace",
          fontSize: "0.75rem",
        }}
      >
        <span style={{ color: "#fff" }}>
          {formatTime(localDeck.playhead)}
        </span>
        <span style={{ color: "#6b7280" }}>
          -{formatTime(Math.max(0, (localDeck.duration || 0) - localDeck.playhead))}
        </span>
      </div>
    </div>
  );
}

/** Format time as M:SS */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Deck controls (transport buttons, etc.) */
function DeckControls({
  deck,
  deckId,
  position,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  accentColor,
  queue,
}: {
  deck: DeckState;
  deckId: "A" | "B";
  position: { x: number; y: number; width: number; height: number };
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  accentColor: string;
  queue: QueueItem[];
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${(position.x / BOARD_WIDTH) * 100}%`,
        top: `${(position.y / BOARD_HEIGHT) * 100}%`,
        width: `${(position.width / BOARD_WIDTH) * 100}%`,
        height: `${(position.height / BOARD_HEIGHT) * 100}%`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
      }}
    >
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
    </div>
  );
}

/** Positioned jog wheel */
function PositionedJogWheel({
  deckId,
  position,
  accentColor,
}: {
  deckId: "A" | "B";
  position: { cx: number; cy: number; r: number };
  accentColor: string;
}) {
  const localDeck = useDeck(deckId);
  const isPlaying = localDeck.isPlaying;

  // Calculate size based on the SVG radius (accounting for aspect ratio)
  const size = (position.r * 2 / BOARD_WIDTH) * 100;

  return (
    <div
      style={{
        position: "absolute",
        left: `${((position.cx - position.r) / BOARD_WIDTH) * 100}%`,
        top: `${((position.cy - position.r) / BOARD_HEIGHT) * 100}%`,
        width: `${size}%`,
        // Maintain aspect ratio using padding trick
        aspectRatio: "1 / 1",
      }}
    >
      <JogWheel
        deckId={deckId}
        accentColor={accentColor}
        size={position.r * 2}
        isPlaying={isPlaying}
      />
    </div>
  );
}

/** Mixer knobs section */
function MixerKnobs({
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
        position: "absolute",
        left: `${(MIXER.display.x / BOARD_WIDTH) * 100}%`,
        top: `${(MIXER.display.y / BOARD_HEIGHT) * 100}%`,
        width: `${(MIXER.display.width / BOARD_WIDTH) * 100}%`,
        height: `${(MIXER.display.height / BOARD_HEIGHT) * 100}%`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        gap: 8,
      }}
    >
      {/* Header with clipping indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: "0.625rem", color: "#9ca3af", fontWeight: 600 }}>
          MASTER
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
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((threshold, i) => (
          <img
            key={i}
            src={`/assets/dj-controls/indicators/led-indicator-${i < 3 ? "green" : i < 4 ? "orange" : "red"}.svg`}
            alt=""
            style={{
              width: 10,
              height: 10,
              opacity: mixer.masterVolume > threshold ? 1 : 0.3,
              transition: "opacity 0.1s",
            }}
          />
        ))}
      </div>

      {/* Knobs grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 4,
        }}
      >
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
          size={44}
        />

        {/* Channel A EQ High */}
        <Knob
          controlId="channelA.eq.high"
          value={mixer.channelA.eq.high}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelA.eq.high"]}
          memberColors={memberColors}
          label="HI A"
          size={44}
          min={-1}
          max={1}
          bipolar
        />

        {/* Channel B EQ High */}
        <Knob
          controlId="channelB.eq.high"
          value={mixer.channelB.eq.high}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelB.eq.high"]}
          memberColors={memberColors}
          label="HI B"
          size={44}
          min={-1}
          max={1}
          bipolar
        />

        {/* Headphone cue mix (placeholder) */}
        <Knob
          controlId="headphoneMix"
          value={0.5}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["headphoneMix"]}
          memberColors={memberColors}
          label="CUE"
          size={44}
        />
      </div>
    </div>
  );
}

/** Mixer faders section */
function MixerFaders({
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
        position: "absolute",
        left: `${(MIXER.faders.x / BOARD_WIDTH) * 100}%`,
        top: `${(MIXER.faders.y / BOARD_HEIGHT) * 100}%`,
        width: `${(MIXER.faders.width / BOARD_WIDTH) * 100}%`,
        height: `${(MIXER.faders.height / BOARD_HEIGHT) * 100}%`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 24px",
      }}
    >
      {/* Channel A fader */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: "0.5rem", color: "#3b82f6", fontWeight: 600 }}>A</span>
        <Fader
          controlId="channelA.fader"
          value={mixer.channelA.fader}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelA.fader"]}
          memberColors={memberColors}
          height={80}
        />
      </div>

      {/* FX Strip in center */}
      <FXStrip
        fxState={mixer.fx}
        roomId={roomId}
        clientId={clientId}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
        controlOwners={controlOwners}
        memberColors={memberColors}
      />

      {/* Channel B fader */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: "0.5rem", color: "#8b5cf6", fontWeight: 600 }}>B</span>
        <Fader
          controlId="channelB.fader"
          value={mixer.channelB.fader}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelB.fader"]}
          memberColors={memberColors}
          height={80}
        />
      </div>
    </div>
  );
}

/** Crossfader section */
function CrossfaderSection({
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
        position: "absolute",
        left: `${(MIXER.crossfader.x / BOARD_WIDTH) * 100}%`,
        top: `${(MIXER.crossfader.y / BOARD_HEIGHT) * 100}%`,
        width: `${(MIXER.crossfader.width / BOARD_WIDTH) * 100}%`,
        height: `${(MIXER.crossfader.height / BOARD_HEIGHT) * 100}%`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
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
 * Main DJ Board component - professional controller layout.
 * Uses the background SVG as the source of truth with absolute positioning.
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
        width: "100%",
        maxWidth: 1600,
        margin: "0 auto",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Main board container with aspect ratio */}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: `${(BOARD_HEIGHT / BOARD_WIDTH) * 100}%`, // Maintain 1600:600 aspect ratio
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* Background SVG - source of truth for layout */}
        <img
          src="/assets/dj-controls/backgrounds/mixer-panel-background.svg"
          alt="DJ Controller"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />

        {/* === DECK A (Left Side) === */}

        {/* Deck A Waveform Display */}
        <DeckDisplay
          deck={state.deckA}
          deckId="A"
          deckLabel="A"
          position={DECK_A.waveform}
          accentColor="#3b82f6"
        />

        {/* Deck A Jog Wheel */}
        <PositionedJogWheel
          deckId="A"
          position={DECK_A.jogWheel}
          accentColor="#3b82f6"
        />

        {/* Deck A Controls */}
        <DeckControls
          deck={state.deckA}
          deckId="A"
          position={DECK_A.controls}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          accentColor="#3b82f6"
          queue={state.queue}
        />

        {/* === MIXER (Center) === */}

        {/* Mixer Knobs */}
        <MixerKnobs
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* Mixer Faders */}
        <MixerFaders
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* Crossfader */}
        <CrossfaderSection
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* === DECK B (Right Side) === */}

        {/* Deck B Waveform Display */}
        <DeckDisplay
          deck={state.deckB}
          deckId="B"
          deckLabel="B"
          position={DECK_B.waveform}
          accentColor="#8b5cf6"
        />

        {/* Deck B Jog Wheel */}
        <PositionedJogWheel
          deckId="B"
          position={DECK_B.jogWheel}
          accentColor="#8b5cf6"
        />

        {/* Deck B Controls */}
        <DeckControls
          deck={state.deckB}
          deckId="B"
          position={DECK_B.controls}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          accentColor="#8b5cf6"
          queue={state.queue}
        />

        {/* Version badge */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 16,
            fontSize: "0.5rem",
            color: "#4b5563",
            fontFamily: "monospace",
          }}
        >
          v{state.version}
        </div>
      </div>
    </div>
  );
}
