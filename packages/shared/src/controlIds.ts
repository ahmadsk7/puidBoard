/**
 * Control ID constants for Virtual DJ Rooms.
 *
 * Control IDs are used for:
 * - Ownership tracking (who is grabbing what)
 * - Visual highlights (glow on grabbed controls)
 * - Event routing (which control was modified)
 *
 * Format: "component.property" or just "property" for top-level
 */

// ============================================================================
// Control ID Constants
// ============================================================================

/** Top-level mixer controls */
export const CROSSFADER = "crossfader" as const;
export const MASTER_VOLUME = "masterVolume" as const;

/** Channel A controls */
export const CHANNEL_A_FADER = "channelA.fader" as const;
export const CHANNEL_A_GAIN = "channelA.gain" as const;
export const CHANNEL_A_EQ_LOW = "channelA.eq.low" as const;
export const CHANNEL_A_EQ_MID = "channelA.eq.mid" as const;
export const CHANNEL_A_EQ_HIGH = "channelA.eq.high" as const;
export const CHANNEL_A_FILTER = "channelA.filter" as const;

/** Channel B controls */
export const CHANNEL_B_FADER = "channelB.fader" as const;
export const CHANNEL_B_GAIN = "channelB.gain" as const;
export const CHANNEL_B_EQ_LOW = "channelB.eq.low" as const;
export const CHANNEL_B_EQ_MID = "channelB.eq.mid" as const;
export const CHANNEL_B_EQ_HIGH = "channelB.eq.high" as const;
export const CHANNEL_B_FILTER = "channelB.filter" as const;

/** FX controls */
export const FX_WET_DRY = "fx.wetDry" as const;
export const FX_PARAM = "fx.param" as const;

/** Deck controls */
export const DECK_A_JOG = "deckA.jog" as const;
export const DECK_B_JOG = "deckB.jog" as const;
export const DECK_A_TEMPO = "deckA.tempo" as const;
export const DECK_B_TEMPO = "deckB.tempo" as const;

// ============================================================================
// Grouped Constants
// ============================================================================

/** All control IDs */
export const ALL_CONTROL_IDS = [
  CROSSFADER,
  MASTER_VOLUME,
  CHANNEL_A_FADER,
  CHANNEL_A_GAIN,
  CHANNEL_A_EQ_LOW,
  CHANNEL_A_EQ_MID,
  CHANNEL_A_EQ_HIGH,
  CHANNEL_A_FILTER,
  CHANNEL_B_FADER,
  CHANNEL_B_GAIN,
  CHANNEL_B_EQ_LOW,
  CHANNEL_B_EQ_MID,
  CHANNEL_B_EQ_HIGH,
  CHANNEL_B_FILTER,
  FX_WET_DRY,
  FX_PARAM,
  DECK_A_JOG,
  DECK_B_JOG,
  DECK_A_TEMPO,
  DECK_B_TEMPO,
] as const;

/** Channel A control IDs */
export const CHANNEL_A_CONTROLS = [
  CHANNEL_A_FADER,
  CHANNEL_A_GAIN,
  CHANNEL_A_EQ_LOW,
  CHANNEL_A_EQ_MID,
  CHANNEL_A_EQ_HIGH,
  CHANNEL_A_FILTER,
] as const;

/** Channel B control IDs */
export const CHANNEL_B_CONTROLS = [
  CHANNEL_B_FADER,
  CHANNEL_B_GAIN,
  CHANNEL_B_EQ_LOW,
  CHANNEL_B_EQ_MID,
  CHANNEL_B_EQ_HIGH,
  CHANNEL_B_FILTER,
] as const;

/** EQ control IDs (both channels) */
export const EQ_CONTROLS = [
  CHANNEL_A_EQ_LOW,
  CHANNEL_A_EQ_MID,
  CHANNEL_A_EQ_HIGH,
  CHANNEL_B_EQ_LOW,
  CHANNEL_B_EQ_MID,
  CHANNEL_B_EQ_HIGH,
] as const;

/** Continuous controls (faders, knobs - high update frequency) */
export const CONTINUOUS_CONTROLS = [
  CROSSFADER,
  MASTER_VOLUME,
  CHANNEL_A_FADER,
  CHANNEL_A_GAIN,
  CHANNEL_B_FADER,
  CHANNEL_B_GAIN,
  ...EQ_CONTROLS,
  CHANNEL_A_FILTER,
  CHANNEL_B_FILTER,
  FX_WET_DRY,
  FX_PARAM,
] as const;

// ============================================================================
// Ownership TTL
// ============================================================================

/** How long a control ownership lasts without movement (ms) */
export const CONTROL_OWNERSHIP_TTL_MS = 2000;
