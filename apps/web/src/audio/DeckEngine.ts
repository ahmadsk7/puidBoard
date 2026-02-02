/**
 * DeckEngine - Single Source of Truth for Deck Transport
 *
 * Replaces the fragmented sync system with a unified state manager.
 * Implements epoch-based sync with PLL drift correction.
 *
 * Key responsibilities:
 * - Own all transport state (playhead, rate, playState)
 * - Apply server beacons with epoch tracking
 * - PLL-based smooth drift correction
 * - Delegate audio playback to Deck
 *
 * Single Writer Rule: ONLY DeckEngine modifies transport state.
 * All other code (UI, handlers) must go through DeckEngine.
 */

import { PLLController } from "./sync/pll";
import { getServerTime, getAverageRtt } from "./sync/clock";
import { Deck } from "./deck";
import type { DeckBeaconPayload } from "@puid-board/shared";

/** Transport state managed by DeckEngine */
interface TransportState {
  playState: "stopped" | "playing" | "paused" | "cued";
  playheadSec: number;
  playbackRate: number;
  epochId: string;
  epochSeq: number;
}

/**
 * DeckEngine - Single writer for deck transport state.
 */
export class DeckEngine {
  private state: TransportState;
  private pllController: PLLController;
  private lastBeaconEpochSeq = -1;
  private deck: Deck;

  constructor(deck: Deck) {
    this.deck = deck;

    // Initialize with stopped state
    this.state = {
      playState: "stopped",
      playheadSec: 0,
      playbackRate: 1.0,
      epochId: "",
      epochSeq: 0,
    };

    this.pllController = new PLLController();
  }

  /**
   * Get current transport state.
   */
  getState(): Readonly<TransportState> {
    return { ...this.state };
  }

  /**
   * Apply a server beacon.
   * This is the primary sync mechanism - called on every BEACON_TICK.
   *
   * @param beacon - Beacon payload from server
   */
  applyServerBeacon(beacon: DeckBeaconPayload): void {
    // Stale check - ignore old beacons from same epoch
    if (
      beacon.epochId === this.state.epochId &&
      beacon.epochSeq <= this.lastBeaconEpochSeq
    ) {
      return;
    }

    // Epoch change = hard reset
    if (beacon.epochId !== this.state.epochId) {
      this.handleEpochChange(beacon);
      return;
    }

    // Same epoch = PLL correction
    this.lastBeaconEpochSeq = beacon.epochSeq;
    this.applyPLLCorrection(beacon);
  }

  /**
   * Handle epoch change - full state reset.
   */
  private handleEpochChange(beacon: DeckBeaconPayload): void {
    console.log(
      `[DeckEngine-${this.deck.getState().deckId}] Epoch change: ${this.state.epochId} -> ${beacon.epochId}`
    );

    // Full state reset
    this.state = {
      playState: beacon.playState,
      playheadSec: beacon.playheadSec,
      playbackRate: beacon.playbackRate,
      epochId: beacon.epochId,
      epochSeq: beacon.epochSeq,
    };

    this.lastBeaconEpochSeq = beacon.epochSeq;

    // Reset PLL
    this.pllController.reset();

    // Sync to Deck
    this.syncToDeck(beacon.playheadSec, beacon.playbackRate, beacon.playState);
  }

  /**
   * Apply PLL-based drift correction.
   */
  private applyPLLCorrection(beacon: DeckBeaconPayload): void {
    if (beacon.playState !== "playing") {
      // Not playing - just update state
      this.state.playState = beacon.playState;
      this.state.playheadSec = beacon.playheadSec;
      this.state.playbackRate = beacon.playbackRate;
      return;
    }

    // Calculate expected playhead with latency compensation
    const oneWayLatencyMs = getAverageRtt() / 2;
    const serverNow = getServerTime();
    const elapsedSinceBeacon = (serverNow - beacon.serverTs) / 1000;

    // Account for one-way latency in playhead calculation
    const latencyCompensatedElapsed = elapsedSinceBeacon + oneWayLatencyMs / 1000;
    const expectedPlayhead =
      beacon.playheadSec + latencyCompensatedElapsed * beacon.playbackRate;

    // Get local playhead from Deck
    const localPlayhead = this.deck.getCurrentPlayhead();

    // Calculate drift (ms)
    const driftMs = (localPlayhead - expectedPlayhead) * 1000;

    // Feed to PLL
    const { correction, shouldSnap } = this.pllController.addMeasurement(driftMs);

    if (shouldSnap) {
      // Drift too large - snap to position
      console.log(
        `[DeckEngine-${this.deck.getState().deckId}] Snap correction: drift=${driftMs.toFixed(1)}ms -> ${expectedPlayhead.toFixed(2)}s`
      );
      this.deck.seekSmooth(expectedPlayhead, 50);
      this.pllController.reset();
    } else if (Math.abs(correction - 1.0) > 0.0001) {
      // Apply smooth correction
      const effectiveRate = beacon.playbackRate * correction;
      this.applyEffectiveRate(effectiveRate);

      console.log(
        `[DeckEngine-${this.deck.getState().deckId}] PLL correction: drift=${driftMs.toFixed(1)}ms, factor=${correction.toFixed(4)}, effectiveRate=${effectiveRate.toFixed(4)}`
      );
    }

    // Update state
    this.state.playState = beacon.playState;
    this.state.playbackRate = beacon.playbackRate;
  }

  /**
   * Apply effective playback rate (base rate * PLL correction).
   */
  private applyEffectiveRate(effectiveRate: number): void {
    const deckState = this.deck.getState();
    if (deckState.playState === "playing" && deckState.source) {
      // Directly modify the audio source's playbackRate
      // This is the ONLY place where we modify playback rate for sync
      deckState.source.playbackRate.value = effectiveRate;
    }
  }

  /**
   * Sync transport state to Deck.
   * Used after epoch changes.
   */
  private syncToDeck(
    playheadSec: number,
    playbackRate: number,
    playState: "stopped" | "playing" | "paused" | "cued"
  ): void {
    const currentDeckState = this.deck.getState();

    // Update playback rate if different
    if (Math.abs(currentDeckState.playbackRate - playbackRate) > 0.001) {
      this.deck.setPlaybackRate(playbackRate);
    }

    // Update playState
    if (currentDeckState.playState !== playState) {
      if (playState === "playing" && currentDeckState.playState !== "playing") {
        // Need to start playing
        if (Math.abs(currentDeckState.playheadSec - playheadSec) > 0.1) {
          this.deck.seek(playheadSec);
        }
        this.deck.play();
      } else if (playState === "paused") {
        this.deck.pause();
      } else if (playState === "stopped") {
        this.deck.stop();
      } else if (playState === "cued") {
        this.deck.cue(playheadSec);
      }
    } else if (playState === "playing") {
      // Already playing - check if we need to seek
      if (Math.abs(currentDeckState.playheadSec - playheadSec) > 0.5) {
        this.deck.seekSmooth(playheadSec, 50);
      }
    }
  }

  /**
   * Apply a local action (user-initiated).
   * This is how the UI/controls modify transport state.
   */
  applyLocalAction(action: {
    type: "PLAY" | "PAUSE" | "STOP" | "CUE" | "SEEK" | "TEMPO_CHANGE";
    playheadSec?: number;
    playbackRate?: number;
  }): void {
    // Optimistic local update
    switch (action.type) {
      case "PLAY":
        this.deck.play();
        break;
      case "PAUSE":
        this.deck.pause();
        break;
      case "STOP":
        this.deck.stop();
        break;
      case "CUE":
        this.deck.cue(action.playheadSec);
        break;
      case "SEEK":
        if (action.playheadSec !== undefined) {
          this.deck.seek(action.playheadSec);
        }
        break;
      case "TEMPO_CHANGE":
        if (action.playbackRate !== undefined) {
          this.deck.setPlaybackRate(action.playbackRate);
        }
        break;
    }

    // Server beacon will confirm and sync
  }

  /**
   * Get current playhead from Deck.
   */
  getCurrentPlayhead(): number {
    return this.deck.getCurrentPlayhead();
  }
}
