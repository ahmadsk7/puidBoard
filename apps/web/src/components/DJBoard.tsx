"use client";

import { useRef, useCallback, useEffect, memo, useState } from "react";
import type {
  ClientMutationEvent,
  RoomState,
  DeckState,
  ControlOwnership,
  QueueItem,
} from "@puid-board/shared";
import { THROTTLE } from "@puid-board/shared";
import { Knob, Crossfader, JogWheel } from "./controls";
import { buildMemberColorMap } from "./CursorsLayer";
import DeckTransport from "./DeckTransport";
// import ClippingIndicator from "./ClippingIndicator"; // TODO: add clipping indicator later
import FXControlPanel from "./FXControlPanel";
import SamplerPanel from "./SamplerPanel";
import PerformancePadPanel from "./PerformancePadPanel";
import { useMixerSync } from "@/audio/useMixer";
import { useDeck, getDeck } from "@/audio/useDeck";
import { setUserBaseRate } from "@/audio/sync/drift";
import { useBoardScale } from "@/hooks/useBoardScale";
import { LCDScreen, WaveformDisplay, TrackInfoDisplay, TimeDisplay } from "./displays";
import QueuePanel from "./QueuePanel";
import SamplerSettings from "./SamplerSettings";

export type DJBoardProps = {
  state: RoomState;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
};

// FIXED BOARD DIMENSIONS - Mixer only (queue is separate)
const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 600;
const QUEUE_WIDTH = 340;

// EXACT COORDINATES FROM SVG SOURCE (viewBox units)
// All measurements extracted directly from mixer-panel-background.svg

// Deck A positions (left side)
const DECK_A = {
  waveform: { x: 110, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 290, cy: 350, r: 150 }, // From SVG: <circle cx="290" cy="350" r="150"/>
  controls: { x: 430, y: 240, width: 160, height: 132 }, // From SVG: <rect x="430" y="240" width="160" height="132"/>
  // Performance pads - 2x2 grid, aligned with inner edge of controls (closer to center), shifted up 0.1"
  // 0.1 inch = ~10px, 2x2 grid = 92px wide (46+46, no gap), align right edge with controls right edge (430+160=590)
  performancePads: { x: 498, y: 390 },
};

// Deck B positions (right side)
const DECK_B = {
  waveform: { x: 998, y: 138, width: 492, height: 92 },
  jogWheel: { cx: 1310, cy: 350, r: 150 }, // From SVG: <circle cx="1310" cy="350" r="150"/>
  controls: { x: 1010, y: 240, width: 160, height: 132 }, // From SVG: <rect x="1010" y="240" width="160" height="132"/>
  // Performance pads - 2x2 grid, aligned with inner edge of controls (closer to center), shifted up 0.1"
  // 0.1 inch = ~10px, 2x2 grid = 92px wide (46+46, no gap), align left edge with controls left edge
  performancePads: { x: 1010, y: 390 },
};

// Tempo fader positions (outer edges, aligned with jog wheels)
const DECK_A_TEMPO = {
  x: 91,
  y: 260,
  height: 180,
};

const DECK_B_TEMPO = {
  x: 1509,
  y: 260,
  height: 180,
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
  // Sampler panel - positioned above crossfader (y=534), centered in mixer
  // 4 buttons at 46px each = 184px total width, centered at x=800 means x=708
  sampler: { x: 708, y: 484, width: 184 }, // Border-to-border buttons above crossfader
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
  roomId,
  clientId,
  sendEvent,
  nextSeq,
}: {
  deck: DeckState;
  deckId: "A" | "B";
  position: { x: number; y: number; width: number; height: number };
  accentColor: string;
  queue: QueueItem[];
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
}) {
  const localDeck = useDeck(deckId);
  const loadedItem = queue.find(q => q.id === deck.loadedQueueItemId);
  const progress = localDeck.duration > 0 ? localDeck.playhead / localDeck.duration : 0;

  // Handle click-to-seek on the display panel
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only seek if a track is loaded and has duration
    if (!localDeck.isLoaded || localDeck.duration === 0) {
      return;
    }

    // Get click position relative to the LCD screen
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickProgress = clickX / rect.width;

    // Clamp to 0-1 range and convert to seconds
    const clampedProgress = Math.max(0, Math.min(1, clickProgress));
    const targetPositionSec = clampedProgress * localDeck.duration;

    console.log(`[DeckDisplay-${deckId}] Click-to-seek: ${clampedProgress.toFixed(2)} (${targetPositionSec.toFixed(2)}s)`);

    // Send DECK_SEEK event to server
    sendEvent({
      type: "DECK_SEEK",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId, positionSec: targetPositionSec },
    });

    // Also seek locally for immediate feedback
    localDeck.seek(targetPositionSec);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        cursor: localDeck.isLoaded ? "pointer" : "default",
        position: "absolute",
        left: position.x,
        top: position.y,
        zIndex: 10,
      }}
    >
      <LCDScreen
        width={position.width}
        height={position.height}
        accentColor={accentColor}
      >
        <TrackInfoDisplay
          deckId={deckId}
          title={loadedItem?.title ?? null}
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
    </div>
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
        zIndex: 100,
        pointerEvents: "auto",
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
  roomId,
  clientId,
  sendEvent,
  nextSeq,
}: {
  deckId: "A" | "B";
  position: { cx: number; cy: number; r: number };
  accentColor: string;
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
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
        zIndex: 150,
      }}
    >
      <JogWheel
        deckId={deckId}
        accentColor={accentColor}
        size={size}
        isPlaying={isPlaying}
        roomId={roomId}
        clientId={clientId}
        sendEvent={sendEvent}
        nextSeq={nextSeq}
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
        zIndex: 100,
        pointerEvents: "auto",
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
 * Convert fader value (0-1) to playback rate (0.92-1.08 for ±8% range)
 * Center (0.5) = 1.0x, Bottom (0) = 0.92x, Top (1) = 1.08x
 */
function faderToPlaybackRate(faderValue: number): number {
  return 0.92 + faderValue * 0.16;
}

/**
 * Convert playback rate to fader value (inverse of above)
 */
function playbackRateToFader(rate: number): number {
  return (rate - 0.92) / 0.16;
}

/**
 * Tempo fader component for deck playback rate control.
 * Sends DECK_TEMPO_SET events and controls local audio playback rate.
 *
 * FIXED: Correct thumb positioning using pixel-based top offset instead of
 * percentage-based translateY (which was relative to thumb height, not track).
 */
const TempoFader = memo(function TempoFader({
  deckId,
  serverPlaybackRate,
  position,
  roomId,
  clientId,
  sendEvent,
  nextSeq,
  controlOwners,
  memberColors,
}: {
  deckId: "A" | "B";
  serverPlaybackRate: number;
  position: { x: number; y: number; height: number };
  roomId: string;
  clientId: string;
  sendEvent: (e: ClientMutationEvent) => void;
  nextSeq: () => number;
  controlOwners: Record<string, ControlOwnership>;
  memberColors: Record<string, string>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastSendRef = useRef(0);
  const localValueRef = useRef(playbackRateToFader(serverPlaybackRate));

  const controlId = deckId === "A" ? "deckA.tempo" : "deckB.tempo";
  const ownership = controlOwners[controlId];
  const isOwnedByOther = ownership && ownership.clientId !== clientId;
  const ownerColor = ownership && memberColors[ownership.clientId];

  // Thumb height for offset calculation
  const THUMB_HEIGHT = 16;

  // Update thumb position directly using pixel-based top offset
  // This ensures the thumb follows the mouse exactly
  const updateThumbPosition = useCallback((faderValue: number) => {
    if (thumbRef.current) {
      const clampedValue = Math.max(0, Math.min(1, faderValue));
      // Vertical fader: top = 1 (faster, +8%), bottom = 0 (slower, -8%)
      // Calculate pixel offset from top: 0% at top (value=1), 100% at bottom (value=0)
      const trackHeight = position.height;
      const availableTravel = trackHeight - THUMB_HEIGHT;
      const topOffset = (1 - clampedValue) * availableTravel;
      thumbRef.current.style.top = `${topOffset}px`;
    }
  }, [position.height]);

  // Sync with server state when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      const faderValue = playbackRateToFader(serverPlaybackRate);
      localValueRef.current = faderValue;
      updateThumbPosition(faderValue);

      // Update drift correction's user base rate when receiving server updates
      // This ensures drift correction knows about tempo changes from other clients
      setUserBaseRate(deckId, serverPlaybackRate);

      // Also sync local audio playback rate
      const deck = getDeck(deckId);
      if (deck) {
        deck.setPlaybackRate(serverPlaybackRate);
      }
    }
  }, [serverPlaybackRate, deckId, updateThumbPosition]);

  // Send DECK_TEMPO_SET event with throttling
  const sendTempoEvent = useCallback((playbackRate: number) => {
    const now = performance.now();
    if (now - lastSendRef.current < THROTTLE.CONTROL_MS) {
      return;
    }
    lastSendRef.current = now;

    sendEvent({
      type: "DECK_TEMPO_SET",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { deckId, playbackRate },
    });
  }, [deckId, roomId, clientId, sendEvent, nextSeq]);

  // Send control grab event
  const sendGrab = useCallback(() => {
    sendEvent({
      type: "CONTROL_GRAB",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  // Send control release event
  const sendRelease = useCallback(() => {
    sendEvent({
      type: "CONTROL_RELEASE",
      roomId,
      clientId,
      clientSeq: nextSeq(),
      payload: { controlId },
    });
  }, [controlId, roomId, clientId, sendEvent, nextSeq]);

  // Calculate fader value from pointer position
  // Uses the track's bounding rect to map clientY to 0-1 range
  const calculateValue = useCallback((clientY: number): number => {
    const track = trackRef.current;
    if (!track) return localValueRef.current;

    const rect = track.getBoundingClientRect();
    // Account for thumb height to allow full travel
    const availableTravel = rect.height - THUMB_HEIGHT;
    const thumbCenter = THUMB_HEIGHT / 2;

    // Calculate position relative to available travel zone
    const relativeY = clientY - rect.top - thumbCenter;
    // Vertical: top = 1 (faster), bottom = 0 (slower)
    const ratio = 1 - (relativeY / availableTravel);
    return Math.max(0, Math.min(1, ratio));
  }, []);

  // Handle pointer down - start drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isOwnedByOther) return;

    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;

    // Calculate value and update immediately
    const faderValue = calculateValue(e.clientY);
    localValueRef.current = faderValue;
    updateThumbPosition(faderValue);

    const playbackRate = faderToPlaybackRate(faderValue);

    // CRITICAL: Update drift correction's user base rate
    // This prevents drift correction from fighting against user tempo changes
    setUserBaseRate(deckId, playbackRate);

    // Apply locally immediately for zero-latency response
    const deck = getDeck(deckId);
    if (deck) {
      deck.setPlaybackRate(playbackRate);
    }

    sendGrab();
    sendTempoEvent(playbackRate);

    // Capture pointer for drag tracking even outside element
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isOwnedByOther, calculateValue, updateThumbPosition, deckId, sendGrab, sendTempoEvent]);

  // Handle pointer move - continue drag
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Only move if we're dragging (pointer is held down)
    if (!isDraggingRef.current) return;

    const faderValue = calculateValue(e.clientY);
    localValueRef.current = faderValue;
    updateThumbPosition(faderValue);

    const playbackRate = faderToPlaybackRate(faderValue);

    // CRITICAL: Update drift correction's user base rate
    // This prevents drift correction from fighting against user tempo changes
    setUserBaseRate(deckId, playbackRate);

    // Apply locally immediately
    const deck = getDeck(deckId);
    if (deck) {
      deck.setPlaybackRate(playbackRate);
    }

    sendTempoEvent(playbackRate);
  }, [calculateValue, updateThumbPosition, deckId, sendTempoEvent]);

  // Handle pointer up - end drag
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    isDraggingRef.current = false;
    sendRelease();

    // Send final value
    const playbackRate = faderToPlaybackRate(localValueRef.current);
    sendTempoEvent(playbackRate);

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, [sendRelease, sendTempoEvent]);

  // Calculate display percentage for tempo change
  const currentRate = faderToPlaybackRate(localValueRef.current);
  const tempoPercent = ((currentRate - 1.0) * 100).toFixed(1);
  const tempoDisplay = currentRate >= 1.0 ? `+${tempoPercent}%` : `${tempoPercent}%`;

  // Calculate initial thumb position in pixels
  const initialFaderValue = playbackRateToFader(serverPlaybackRate);
  const availableTravel = position.height - THUMB_HEIGHT;
  const initialTopOffset = (1 - initialFaderValue) * availableTravel;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        zIndex: 50,
      }}
    >
      {/* TEMPO label */}
      <div
        style={{
          fontSize: "8px",
          color: "#6b7280",
          fontWeight: 600,
          letterSpacing: "0.05em",
          marginBottom: 2,
        }}
      >
        TEMPO
      </div>

      {/* +8% label */}
      <div
        style={{
          fontSize: "8px",
          color: "#6b7280",
          fontWeight: 500,
        }}
      >
        +8%
      </div>

      {/* Fader track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: 24,
          height: position.height,
          background: "linear-gradient(to bottom, #1a1a1a, #0f0f10)",
          borderRadius: 4,
          border: "1px solid #242424",
          cursor: isOwnedByOther ? "not-allowed" : "pointer",
          touchAction: "none",
          boxShadow: ownerColor
            ? `inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03), 0 0 8px 2px ${ownerColor}`
            : "inset 0 2px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
        }}
      >
        {/* Center line indicator (0% position) */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 2,
            right: 2,
            height: 2,
            background: "#3b82f6",
            borderRadius: 1,
            opacity: 0.5,
            transform: "translateY(-50%)",
          }}
        />

        {/* Thumb - positioned using top offset in pixels */}
        <div
          ref={thumbRef}
          style={{
            position: "absolute",
            left: "50%",
            top: initialTopOffset,
            transform: "translateX(-50%)",
            width: 28,
            height: THUMB_HEIGHT,
            background: "linear-gradient(180deg, #4a4a4a 0%, #2a2a2a 50%, #1a1a1a 100%)",
            borderRadius: 3,
            border: "1px solid #3a3a3a",
            boxShadow: "0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
            pointerEvents: "none",
          }}
        >
          {/* Grip lines */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              gap: 2,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 1,
                  height: 8,
                  background: "#555",
                  borderRadius: 0.5,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 0% label (center) */}
      <div
        style={{
          position: "absolute",
          top: position.height / 2 + 24,
          right: deckId === "A" ? -18 : "auto",
          left: deckId === "B" ? -18 : "auto",
          fontSize: "8px",
          color: "#6b7280",
          fontWeight: 500,
        }}
      >
        0%
      </div>

      {/* -8% label */}
      <div
        style={{
          fontSize: "8px",
          color: "#6b7280",
          fontWeight: 500,
        }}
      >
        -8%
      </div>

      {/* Current tempo display */}
      <div
        style={{
          marginTop: 4,
          padding: "2px 6px",
          background: "linear-gradient(135deg, #050508 0%, #0a0a0c 100%)",
          border: "1px solid #1a1a1a",
          borderRadius: 3,
          fontSize: "9px",
          fontWeight: 700,
          fontFamily: "monospace",
          color: Math.abs(currentRate - 1.0) < 0.001 ? "#6b7280" : "#60a5fa",
          textShadow: Math.abs(currentRate - 1.0) < 0.001 ? "none" : "0 0 4px rgba(96, 165, 250, 0.3)",
        }}
      >
        {tempoDisplay}
      </div>
    </div>
  );
});

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

  // Sampler settings modal state
  const [isSamplerSettingsOpen, setIsSamplerSettingsOpen] = useState(false);

  // Calculate responsive scale - board + queue together fill viewport
  const scale = useBoardScale(BOARD_WIDTH + QUEUE_WIDTH, BOARD_HEIGHT, 0.90);

  // Sync mixer state to audio graph
  useMixerSync(state.mixer);

  // Debug: log FX state when it changes
  useEffect(() => {
    console.log("[DJBoard] FX state received:", state.mixer.fx);
  }, [state.mixer.fx]);

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
        gap: 0,
      }}
    >
      {/* Container for both board and queue - scales together */}
      <div
        style={{
          display: "flex",
          gap: 0,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* DJ Board (mixer) */}
        <div
          style={{
            position: "relative",
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            overflow: "visible",
          }}
        >
          {/* SVG Background - The Source of Truth */}
          <img
            src="/assets/dj-controls/backgrounds/mixer-panel-background.svg"
            alt="DJ Controller"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: BOARD_WIDTH,
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
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
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
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
        />

        {/* Deck A Tempo Fader */}
        <TempoFader
          deckId="A"
          serverPlaybackRate={state.deckA.playbackRate}
          position={DECK_A_TEMPO}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* Deck A Performance Pads */}
        <div
          style={{
            position: "absolute",
            left: DECK_A.performancePads.x,
            top: DECK_A.performancePads.y,
            zIndex: 100,
            pointerEvents: "auto",
          }}
        >
          <PerformancePadPanel
            deckId="A"
            keybinds={["1", "2", "3", "4"]}
          />
        </div>

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

        {/* Sampler Panel - positioned between faders and crossfader, centered between screws */}
        <div
          style={{
            position: "absolute",
            left: MIXER.sampler.x,
            top: MIXER.sampler.y,
            width: MIXER.sampler.width,
            zIndex: 100,
            pointerEvents: "auto",
          }}
        >
          <SamplerPanel width={MIXER.sampler.width} />
        </div>

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
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
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
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
        />

        {/* Deck B Tempo Fader */}
        <TempoFader
          deckId="B"
          serverPlaybackRate={state.deckB.playbackRate}
          position={DECK_B_TEMPO}
          roomId={state.roomId}
          clientId={clientId}
          sendEvent={sendEvent}
          nextSeq={nextSeq}
          controlOwners={state.controlOwners}
          memberColors={memberColors}
        />

        {/* Deck B Performance Pads */}
        <div
          style={{
            position: "absolute",
            left: DECK_B.performancePads.x,
            top: DECK_B.performancePads.y,
            zIndex: 100,
            pointerEvents: "auto",
          }}
        >
          <PerformancePadPanel
            deckId="B"
            keybinds={["7", "8", "9", "0"]}
          />
        </div>

          {/* NOTE: Decorative screws are rendered in the SVG background */}

          {/* Version badge */}
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 16,
              fontSize: "0.5rem",
              color: "#4b5563",
              fontFamily: "monospace",
              zIndex: 1000,
            }}
          >
            v{state.version}
          </div>
        </div>

        {/* Queue Panel - Separate lane */}
        <div
          style={{
            width: QUEUE_WIDTH,
            height: BOARD_HEIGHT,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Sampler Settings Button */}
          <div
            style={{
              padding: "8px 16px",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => setIsSamplerSettingsOpen(true)}
              style={{
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: 500,
                background: "rgba(255, 140, 59, 0.15)",
                color: "#FF8C3B",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 140, 59, 0.25)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 140, 59, 0.15)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Sampler
            </button>
          </div>

          <QueuePanel
            queue={state.queue}
            members={state.members}
            roomId={state.roomId}
            clientId={clientId}
            sendEvent={sendEvent}
            nextSeq={nextSeq}
          />
        </div>
      </div>

      {/* Sampler Settings Modal */}
      <SamplerSettings
        isOpen={isSamplerSettingsOpen}
        onClose={() => setIsSamplerSettingsOpen(false)}
        clientId={clientId}
        roomId={state.roomId}
      />
    </div>
  );
}
