/**
 * Phase-Locked Loop (PLL) Controller for Audio Sync
 *
 * Provides smooth drift correction using proportional control with median filtering
 * and exponential moving average (EMA) smoothing.
 *
 * Key features:
 * - Median filtering (window=7) for noise rejection
 * - EMA smoothing on top of median to prevent micro-wobbles from jittery beacons
 * - Proportional gain for smooth convergence
 * - Configurable correction limits (±2% max)
 * - Snap threshold for large drift
 */

/**
 * PLL Controller for smooth drift correction.
 */
export class PLLController {
  /** Maximum correction percentage (±2%) */
  private static readonly MAX_CORRECTION_PERCENT = 2;

  /** Proportional gain constant (0.1% correction per 100ms drift) */
  private static readonly PROPORTIONAL_GAIN = 0.001;

  /** Ignore drift below this threshold (ms) */
  private static readonly IGNORE_THRESHOLD_MS = 10;

  /** Snap to position if drift exceeds this threshold (ms) */
  private static readonly SNAP_THRESHOLD_MS = 500;

  /** Median filter window size (7 for 100ms beacons) */
  private static readonly FILTER_WINDOW_SIZE = 7;

  /** EMA smoothing factor (0.3 = moderate smoothing) */
  private static readonly EMA_ALPHA = 0.3;

  /** Recent drift measurements for median filtering */
  private driftHistory: number[] = [];

  /** Current correction factor (1.0 = no correction) */
  private correctionFactor = 1.0;

  /** Previous smoothed drift for EMA */
  private smoothedDrift: number | null = null;

  /**
   * Add a new drift measurement and calculate correction.
   *
   * @param driftMs - Drift in milliseconds (positive = ahead of server, negative = behind)
   * @returns Correction result with factor and snap decision
   */
  addMeasurement(driftMs: number): { correction: number; shouldSnap: boolean } {
    // Add to history for median filtering
    this.driftHistory.push(driftMs);
    if (this.driftHistory.length > PLLController.FILTER_WINDOW_SIZE) {
      this.driftHistory.shift();
    }

    // Calculate median drift (robust to noise/outliers)
    const sorted = [...this.driftHistory].sort((a, b) => a - b);
    const medianDrift = sorted[Math.floor(sorted.length / 2)] ?? driftMs;

    // Apply EMA smoothing on top of median
    const alpha = PLLController.EMA_ALPHA;
    const smoothed = this.smoothedDrift === null
      ? medianDrift
      : alpha * medianDrift + (1 - alpha) * this.smoothedDrift;
    this.smoothedDrift = smoothed;

    const absDrift = Math.abs(smoothed);

    // Check if drift is too large - need to snap
    if (absDrift > PLLController.SNAP_THRESHOLD_MS) {
      this.correctionFactor = 1.0;
      return { correction: 1.0, shouldSnap: true };
    }

    // Check if drift is too small - ignore it
    if (absDrift < PLLController.IGNORE_THRESHOLD_MS) {
      this.correctionFactor = 1.0;
      return { correction: 1.0, shouldSnap: false };
    }

    // Calculate proportional correction
    // Positive drift (ahead) = slow down (factor < 1)
    // Negative drift (behind) = speed up (factor > 1)
    const correction = -smoothed * PLLController.PROPORTIONAL_GAIN;

    // Clamp to max correction
    const maxCorrection = PLLController.MAX_CORRECTION_PERCENT / 100;
    const clampedCorrection = Math.max(
      -maxCorrection,
      Math.min(maxCorrection, correction)
    );

    this.correctionFactor = 1.0 + clampedCorrection;
    return { correction: this.correctionFactor, shouldSnap: false };
  }

  /**
   * Get the current correction factor.
   *
   * @returns Correction factor (1.0 = no correction)
   */
  getCorrectionFactor(): number {
    return this.correctionFactor;
  }

  /**
   * Reset the PLL state.
   * Use when changing epochs or after snap corrections.
   */
  reset(): void {
    this.driftHistory = [];
    this.correctionFactor = 1.0;
    this.smoothedDrift = null;
  }
}
