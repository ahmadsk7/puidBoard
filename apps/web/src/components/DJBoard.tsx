"use client";

import type {
  ClientMutationEvent,
  RoomState,
  DeckState,
  ControlOwnership,
  QueueItem,
} from "@puid-board/shared";
import { Knob, Crossfader, JogWheel } from "./controls";
import { buildMemberColorMap } from "./CursorsLayer";
import DeckTransport from "./DeckTransport";
// import ClippingIndicator from "./ClippingIndicator"; // TODO: add clipping indicator later
import FXControlPanel from "./FXControlPanel";
import { useMixerSync } from "@/audio/useMixer";
import { useDeck } from "@/audio/useDeck";
import { useBoardScale } from "@/hooks/useBoardScale";
import { LCDScreen, WaveformDisplay, TrackInfoDisplay, TimeDisplay } from "./displays";
import QueuePanel from "./QueuePanel";

export type DJBoardProps = {
  state: RoomState;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
};

// FIXED BOARD DIMENSIONS - Extended to include queue panel
const BOARD_WIDTH = 1920;
const BOARD_HEIGHT = 600;

// EXACT COORDINATES FROM SVG SOURCE (viewBox units)
// All measurements extracted directly from mixer-panel-background.svg

// Deck A positions (left side)
const DECK_A = {
  waveform: { x: 110, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 290, cy: 350, r: 150 }, // From SVG: <circle cx="290" cy="350" r="150"/>
  controls: { x: 430, y: 312, width: 160, height: 132 }, // From SVG: <rect x="430" y="312" width="160" height="132"/>
};

// Deck B positions (right side)
const DECK_B = {
  waveform: { x: 998, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 1310, cy: 350, r: 150 }, // From SVG: <circle cx="1310" cy="350" r="150"/>
  controls: { x: 1010, y: 312, width: 160, height: 132 }, // From SVG: <rect x="1010" y="312" width="160" height="132"/>
};

// Mixer positions (center)
const MIXER = {
  display: { x: 688, y: 170, width: 224, height: 160 }, // From SVG: <rect x="688" y="170" width="224" height="160"/>
  // Knob positions - EXACT centers from SVG circles
  knobs: {
    masterVolume: { cx: 744, cy: 238 },   // <circle cx="744" cy="238" r="26"/>
    channelAHigh: { cx: 856, cy: 238 },   // <circle cx="856" cy="238" r="26"/>
    channelBHigh: { cx: 744, cy: 302 },   // <circle cx="744" cy="302" r="26"/>
    headphoneMix: { cx: 856, cy: 302 },   // <circle cx="856" cy="302" r="26"/>
  },
  knobRadius: 26, // From SVG: r="26"
  // Fader track positions
  faders: { x: 688, y: 346, width: 224, height: 132 },
  channelA: { x: 730, y: 384, width: 18, height: 84 }, // From SVG: <rect x="730" y="384" width="18" height="84"/>
  channelB: { x: 852, y: 384, width: 18, height: 84 }, // From SVG: <rect x="852" y="384" width="18" height="84"/>
  // Crossfader
  crossfader: { x: 552, y: 534, width: 496, height: 34 }, // From SVG: <rect x="552" y="534" width="496" height="34"/>
};

// NOTE: Decorative screws are already rendered in the SVG background
// (mixer-panel-background.svg lines 215-229), so no CSS duplicates needed.

/** Deck waveform and transport display */
function DeckDisplay({
  deck,
  deckId,
  position,
  accentColor,
  queue,
}: {
  deck: DeckState;
  deckId: "A" | "B";
  position: { x: number; y: number; width: number; height: number };
  accentColor: string;
  queue: QueueItem[];
}) {
  const localDeck = useDeck(deckId);
  const loadedItem = queue.find(q => q.id === deck.loadedQueueItemId);
  const progress = localDeck.duration > 0 ? localDeck.playhead / localDeck.duration : 0;

  return (
    <LCDScreen
      width={position.width}
      height={position.height}
      accentColor={accentColor}
      style={{ position: "absolute", left: position.x, top: position.y }}
    >
      <TrackInfoDisplay
        deckId={deckId}
        title={loadedItem?.title ?? null}
        bpm={localDeck.bpm}
        playState={deck.playState}
        accentColor={accentColor}
      />
      <WaveformDisplay
        waveform={localDeck.waveform}
        progress={progress}
        accentColor={accentColor}
        isPlaying={localDeck.isPlaying}
        isLoading={localDeck.isAnalyzing}
      />
      <TimeDisplay
        currentTime={localDeck.playhead}
        duration={localDeck.duration}
      />
    </LCDScreen>
  );
}

/** Deck controls (transport buttons) */
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
        left: position.x,
        top: position.y,
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

  const size = position.r * 2; // Diameter from SVG radius

  return (
    <div
      style={{
        position: "absolute",
        left: position.cx,
        top: position.cy,
        transform: "translate(-50%, -50%)",
        width: size,
        height: size,
      }}
    >
      <JogWheel
        deckId={deckId}
        accentColor={accentColor}
        size={size}
        isPlaying={isPlaying}
      />
    </div>
  );
}

/** Mixer knobs section - centered at exact SVG coordinates */
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
  const knobSize = MIXER.knobRadius * 2; // 52px diameter

  return (
    <>
      {/* Signal level indicators - positioned above knobs */}
      <div
        style={{
          position: "absolute",
          left: MIXER.display.x + MIXER.display.width / 2,
          top: MIXER.display.y + 20,
          transform: "translateX(-50%)",
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((threshold, i) => (
          <img
            key={i}
            src={`/assets/dj-controls/indicators/led-indicator-${
              i < 3 ? "green" : i < 4 ? "orange" : "red"
            }.svg`}
            alt=""
            style={{
              width: 10,
              height: 10,
              filter:
                mixer.masterVolume > threshold
                  ? "brightness(1)"
                  : "brightness(0.3)",
              transition: "filter 0.1s",
            }}
          />
        ))}
      </div>

      {/* Master volume label */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.masterVolume.cx,
          top: MIXER.knobs.masterVolume.cy - 36,
          transform: "translateX(-50%)",
          fontSize: "0.625rem",
          color: "#9ca3af",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        MASTER
      </div>

      {/* Master volume knob - centered at (744, 238) */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.masterVolume.cx,
          top: MIXER.knobs.masterVolume.cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <Knob
          controlId="masterVolume"
          value={mixer.masterVolume}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["masterVolume"]}
          memberColors={memberColors}
          size={knobSize}
        />
      </div>

      {/* HI A label */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.channelAHigh.cx,
          top: MIXER.knobs.channelAHigh.cy - 36,
          transform: "translateX(-50%)",
          fontSize: "0.625rem",
          color: "#9ca3af",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        HI A
      </div>

      {/* Channel A EQ High - centered at (856, 238) */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.channelAHigh.cx,
          top: MIXER.knobs.channelAHigh.cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <Knob
          controlId="channelA.eq.high"
          value={mixer.channelA.eq.high}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelA.eq.high"]}
          memberColors={memberColors}
          size={knobSize}
          min={-1}
          max={1}
          bipolar
        />
      </div>

      {/* HI B label */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.channelBHigh.cx,
          top: MIXER.knobs.channelBHigh.cy - 36,
          transform: "translateX(-50%)",
          fontSize: "0.625rem",
          color: "#9ca3af",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        HI B
      </div>

      {/* Channel B EQ High - centered at (744, 302) */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.channelBHigh.cx,
          top: MIXER.knobs.channelBHigh.cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <Knob
          controlId="channelB.eq.high"
          value={mixer.channelB.eq.high}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["channelB.eq.high"]}
          memberColors={memberColors}
          size={knobSize}
          min={-1}
          max={1}
          bipolar
        />
      </div>

      {/* CUE label */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.headphoneMix.cx,
          top: MIXER.knobs.headphoneMix.cy - 36,
          transform: "translateX(-50%)",
          fontSize: "0.625rem",
          color: "#9ca3af",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        CUE
      </div>

      {/* Headphone cue mix - centered at (856, 302) */}
      <div
        style={{
          position: "absolute",
          left: MIXER.knobs.headphoneMix.cx,
          top: MIXER.knobs.headphoneMix.cy,
          transform: "translate(-50%, -50%)",
        }}
      >
        <Knob
          controlId="headphoneMix"
          value={0.5}
          roomId={roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          ownership={controlOwners["headphoneMix"]}
          memberColors={memberColors}
          size={knobSize}
        />
      </div>
    </>
  );
}

/** Mixer faders and FX section - Aligned to SVG background */
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
        left: MIXER.faders.x,
        top: MIXER.faders.y,
        width: MIXER.faders.width,
        height: MIXER.faders.height,
      }}
    >
      <FXControlPanel
        fxState={mixer.fx}
        channelAFader={mixer.channelA.fader}
        channelBFader={mixer.channelB.fader}
        roomId={roomId}
        clientId={clientId}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
        controlOwners={controlOwners}
        memberColors={memberColors}
      />
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
        left: MIXER.crossfader.x,
        top: MIXER.crossfader.y,
        width: MIXER.crossfader.width,
        height: MIXER.crossfader.height,
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
 * FIXED SIZE with CSS scale transform for perfect pixel alignment.
 */
export default function DJBoard({
  state,
  clientId,
  sendEvent,
  nextSeq,
}: DJBoardProps) {
  const memberColors = buildMemberColorMap(state.members);

  // Calculate responsive scale - board fills viewport responsively
  const scale = useBoardScale(BOARD_WIDTH, BOARD_HEIGHT, 0.95);

  // Sync mixer state to audio graph
  useMixerSync(state.mixer);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        boxSizing: "border-box",
      }}
    >
      {/* Fixed-size board container - scales to fit viewport */}
      <div
        style={{
          position: "relative",
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          overflow: "visible",
        }}
      >
        {/* SVG Background - The Source of Truth (mixer only) */}
        <img
          src="/assets/dj-controls/backgrounds/mixer-panel-background.svg"
          alt="DJ Controller"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1600,
            height: BOARD_HEIGHT,
            pointerEvents: "none",
            userSelect: "none",
            zIndex: 0,
          }}
        />

        {/* === DECK A (Left Side) === */}
        <DeckDisplay
          deck={state.deckA}
          deckId="A"
          position={DECK_A.waveform}
          accentColor="#3b82f6"
          queue={state.queue}
        />

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

        <PositionedJogWheel
          deckId="A"
          position={DECK_A.jogWheel}
          accentColor="#3b82f6"
        />

        {/* === MIXER (Center) === */}
        <MixerKnobs
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        <MixerFaders
          mixer={state.mixer}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

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
        <DeckDisplay
          deck={state.deckB}
          deckId="B"
          position={DECK_B.waveform}
          accentColor="#8b5cf6"
          queue={state.queue}
        />

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

        <PositionedJogWheel
          deckId="B"
          position={DECK_B.jogWheel}
          accentColor="#8b5cf6"
        />

        {/* NOTE: Decorative screws are rendered in the SVG background */}

        {/* Queue Panel - Integrated into board */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 320,
            height: "100%",
            zIndex: 100,
          }}
        >
          <QueuePanel
            queue={state.queue}
            members={state.members}
            roomId={state.roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
          />
        </div>

        {/* Version badge */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 336,
            fontSize: "0.5rem",
            color: "#4b5563",
            fontFamily: "monospace",
            zIndex: 1000,
          }}
        >
          v{state.version}
        </div>
      </div>
    </div>
  );
}
