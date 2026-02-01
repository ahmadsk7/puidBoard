/**
 * BPM Detection - Reliable beat detection for DJ software
 *
 * Uses a proven approach:
 * 1. Extract mono audio
 * 2. Low-pass filter to isolate bass/kick drum frequencies
 * 3. Calculate energy envelope
 * 4. Find peaks (onsets)
 * 5. Use histogram to find dominant interval between beats
 *
 * This is the ORIGINAL WORKING ALGORITHM - simpler and more reliable
 * than the complex autocorrelation approach.
 */

/** BPM detection result with confidence score */
export interface BpmResult {
  bpm: number;
  confidence: number; // 0-1, where 1 = high confidence
}

/**
 * Detect BPM from an audio buffer.
 *
 * @param buffer - The audio buffer to analyze
 * @returns Detected BPM (60-180 range) or null if detection fails
 */
export async function detectBPM(buffer: AudioBuffer): Promise<number | null> {
  try {
    console.log('[BPM Detector] ========== STARTING BPM DETECTION ==========');
    console.log(`[BPM Detector] Buffer: duration=${buffer.duration.toFixed(2)}s, sampleRate=${buffer.sampleRate}, channels=${buffer.numberOfChannels}`);
    console.log(`[BPM Detector] Total samples: ${buffer.length}`);

    // Sanity check - ensure buffer has audio data
    const rawChannelData = buffer.getChannelData(0);
    let maxSample = 0;
    for (let i = 0; i < Math.min(rawChannelData.length, 10000); i++) {
      maxSample = Math.max(maxSample, Math.abs(rawChannelData[i] ?? 0));
    }
    console.log(`[BPM Detector] Sample check - max amplitude in first 10k samples: ${maxSample.toFixed(4)}`);

    if (maxSample < 0.001) {
      console.warn('[BPM Detector] Audio appears silent or nearly silent');
      return null;
    }

    // Use first 30 seconds for analysis (sufficient for BPM detection)
    const analysisDuration = Math.min(30, buffer.duration);
    const sampleCount = Math.floor(analysisDuration * buffer.sampleRate);
    console.log(`[BPM Detector] Analyzing first ${analysisDuration.toFixed(1)}s (${sampleCount} samples)`);

    // Extract mono channel
    const channelData = extractMonoChannel(buffer, sampleCount);
    console.log(`[BPM Detector] Extracted mono channel: ${channelData.length} samples`);

    // Apply low-pass filter to isolate bass frequencies (improves beat detection)
    const filtered = applyLowPassFilter(channelData);
    console.log(`[BPM Detector] Applied low-pass filter`);

    // Calculate energy envelope
    const envelope = calculateEnergyEnvelope(filtered, buffer.sampleRate);
    console.log(`[BPM Detector] Calculated energy envelope: ${envelope.length} frames`);

    // Log envelope stats
    let envMax = 0, envMin = Infinity, envSum = 0;
    for (let i = 0; i < envelope.length; i++) {
      const v = envelope[i] ?? 0;
      envMax = Math.max(envMax, v);
      envMin = Math.min(envMin, v);
      envSum += v;
    }
    console.log(`[BPM Detector] Envelope stats: min=${envMin.toFixed(4)}, max=${envMax.toFixed(4)}, avg=${(envSum / envelope.length).toFixed(4)}`);

    // Try multiple thresholds (from strictest to most lenient)
    const thresholds = [0.3, 0.2, 0.15, 0.1, 0.05];

    for (const thresholdPercent of thresholds) {
      console.log(`[BPM Detector] Attempting detection with ${(thresholdPercent * 100).toFixed(0)}% threshold...`);

      // Find peaks in envelope (onsets)
      const peaks = findPeaksWithThreshold(envelope, thresholdPercent);
      console.log(`[BPM Detector] Found ${peaks.length} peaks with ${(thresholdPercent * 100).toFixed(0)}% threshold`);

      if (peaks.length < 4) {
        console.log(`[BPM Detector] Not enough peaks (need at least 4), trying lower threshold...`);
        continue;
      }

      // Use histogram to find dominant period
      let bpm = detectBPMFromPeaks(peaks, envelope.length, buffer.sampleRate);
      console.log(`[BPM Detector] Calculated raw BPM: ${bpm}`);

      if (bpm) {
        // Correct BPM octave - divide if too fast, multiply if too slow
        let correctedBpm = bpm;

        // If detecting sub-beats (too fast), halve until in range
        while (correctedBpm > 180) {
          correctedBpm = correctedBpm / 2;
        }

        // If detecting super-beats (too slow), double until in range
        while (correctedBpm < 60 && correctedBpm * 2 <= 180) {
          correctedBpm = correctedBpm * 2;
        }

        // Check if correction brought it into valid range
        if (correctedBpm >= 60 && correctedBpm <= 180) {
          const rounded = Math.round(correctedBpm);
          if (correctedBpm !== bpm) {
            console.log(`[BPM Detector] Corrected ${bpm.toFixed(1)} → ${rounded} BPM (octave correction)`);
          }
          console.log(`[BPM Detector] ✓ Detection successful: ${rounded} BPM (threshold: ${(thresholdPercent * 100).toFixed(0)}%)`);
          console.log('[BPM Detector] ========== BPM DETECTION COMPLETE (SUCCESS) ==========');
          return rounded;
        }

        console.log(`[BPM Detector] BPM ${bpm.toFixed(1)} outside valid range after correction, trying next threshold...`);
      }
    }

    console.warn('[BPM Detector] ✗ All detection attempts failed - returning null');
    console.log('[BPM Detector] ========== BPM DETECTION COMPLETE (FAILED) ==========');
    return null;
  } catch (error) {
    console.error('[BPM Detector] Detection failed with error:', error);
    console.log('[BPM Detector] ========== BPM DETECTION COMPLETE (ERROR) ==========');
    return null;
  }
}

/**
 * Detect BPM with confidence scoring.
 * Wrapper around detectBPM for API compatibility.
 */
export async function detectBPMWithConfidence(buffer: AudioBuffer): Promise<BpmResult | null> {
  const bpm = await detectBPM(buffer);
  if (bpm === null) {
    return null;
  }
  // Return high confidence since we only return results we're confident about
  return { bpm, confidence: 0.8 };
}

/**
 * Extract mono channel from audio buffer.
 */
function extractMonoChannel(buffer: AudioBuffer, sampleCount: number): Float32Array {
  const channelData = buffer.getChannelData(0);
  const mono = new Float32Array(sampleCount);

  if (buffer.numberOfChannels === 1) {
    mono.set(channelData.slice(0, sampleCount));
  } else {
    // Mix stereo to mono
    const right = buffer.getChannelData(1);
    for (let i = 0; i < sampleCount; i++) {
      mono[i] = ((channelData[i] ?? 0) + (right[i] ?? 0)) / 2;
    }
  }

  return mono;
}

/**
 * Apply simple low-pass filter to isolate bass frequencies.
 * Uses a first-order IIR filter with alpha=0.1 (cutoff ~350Hz at 44.1kHz).
 */
function applyLowPassFilter(data: Float32Array): Float32Array {
  const filtered = new Float32Array(data.length);
  const alpha = 0.1; // Smoothing factor - higher = more high frequencies pass

  filtered[0] = data[0] ?? 0;
  for (let i = 1; i < data.length; i++) {
    filtered[i] = alpha * (data[i] ?? 0) + (1 - alpha) * (filtered[i - 1] ?? 0);
  }

  return filtered;
}

/**
 * Calculate energy envelope with overlapping windows.
 * Uses 50ms windows with 50% overlap for good time resolution.
 */
function calculateEnergyEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const hopSize = Math.floor(windowSize / 2); // 50% overlap (25ms hop)
  const numFrames = Math.floor((data.length - windowSize) / hopSize);

  console.log(`[BPM Detector] Energy envelope: windowSize=${windowSize}, hopSize=${hopSize}, numFrames=${numFrames}`);

  if (numFrames < 10) {
    console.warn(`[BPM Detector] Not enough frames for analysis (${numFrames})`);
    return new Float32Array(0);
  }

  const envelope = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    const end = start + windowSize;

    // Calculate RMS energy for this window
    let sum = 0;
    for (let j = start; j < end; j++) {
      const val = data[j] ?? 0;
      sum += val * val;
    }
    envelope[i] = Math.sqrt(sum / windowSize);
  }

  return envelope;
}

/**
 * Find peaks in the energy envelope (onset detection).
 * A peak must be above threshold and be a local maximum.
 */
function findPeaksWithThreshold(envelope: Float32Array, thresholdPercent: number): number[] {
  const peaks: number[] = [];

  // Calculate dynamic threshold as percentage of max energy
  let max = 0;
  for (let i = 0; i < envelope.length; i++) {
    const v = envelope[i] ?? 0;
    if (v > max) max = v;
  }
  const threshold = max * thresholdPercent;
  console.log(`[BPM Detector] Peak threshold: ${threshold.toFixed(4)} (${(thresholdPercent * 100).toFixed(0)}% of max ${max.toFixed(4)})`);

  const minPeakDistance = 5; // Minimum frames between peaks (~125ms)

  for (let i = 1; i < envelope.length - 1; i++) {
    const current = envelope[i] ?? 0;
    const prev = envelope[i - 1] ?? 0;
    const next = envelope[i + 1] ?? 0;

    // Check if this is a local maximum above threshold
    if (current > threshold && current > prev && current > next) {
      // Ensure minimum distance from last peak
      if (peaks.length === 0 || i - (peaks[peaks.length - 1] ?? 0) >= minPeakDistance) {
        peaks.push(i);
      }
    }
  }

  return peaks;
}

/**
 * Detect BPM from peak intervals using histogram approach.
 * This is more robust than autocorrelation for beat detection.
 */
function detectBPMFromPeaks(peaks: number[], _envelopeLength: number, _sampleRate: number): number | null {
  if (peaks.length < 2) {
    console.log('[BPM Detector] Not enough peaks for BPM calculation');
    return null;
  }

  // Calculate intervals between consecutive peaks (in frames)
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] ?? 0) - (peaks[i - 1] ?? 0));
  }

  console.log(`[BPM Detector] Calculated ${intervals.length} intervals between peaks`);

  if (intervals.length < 3) {
    console.log('[BPM Detector] Not enough intervals for reliable detection');
    return null;
  }

  // Log interval statistics
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] ?? 0;
  console.log(`[BPM Detector] Interval stats: min=${sortedIntervals[0]}, median=${medianInterval}, max=${sortedIntervals[sortedIntervals.length - 1]}`);

  // Find dominant interval using histogram approach
  const dominantInterval = findDominantInterval(intervals);
  console.log(`[BPM Detector] Dominant interval: ${dominantInterval} frames`);

  if (!dominantInterval || dominantInterval <= 0) {
    console.log('[BPM Detector] Could not find dominant interval');
    return null;
  }

  // Convert interval (in frames) to BPM
  // Each frame is 25ms (50ms window with 50% overlap = 25ms per frame)
  const msPerFrame = 25;
  const msPerBeat = dominantInterval * msPerFrame;
  const bpm = 60000 / msPerBeat;

  console.log(`[BPM Detector] Calculation: ${dominantInterval} frames × ${msPerFrame}ms/frame = ${msPerBeat}ms/beat → ${bpm.toFixed(1)} BPM`);

  return bpm;
}

/**
 * Find dominant interval using histogram approach.
 * Groups similar intervals together and finds the most common one.
 */
function findDominantInterval(intervals: number[]): number | null {
  if (intervals.length === 0) return null;

  // Create histogram of intervals (rounded to nearest integer)
  const histogram = new Map<number, number>();

  for (const interval of intervals) {
    const rounded = Math.round(interval);
    histogram.set(rounded, (histogram.get(rounded) || 0) + 1);
  }

  console.log(`[BPM Detector] Histogram size: ${histogram.size} unique intervals`);

  // Also check neighbors (to handle small timing variations)
  const histogramWithNeighbors = new Map<number, number>();
  histogram.forEach((count, interval) => {
    const totalCount = count +
      (histogram.get(interval - 1) || 0) +
      (histogram.get(interval + 1) || 0);
    histogramWithNeighbors.set(interval, totalCount);
  });

  // Find interval with highest count
  let maxCount = 0;
  let dominantInterval = 0;

  histogramWithNeighbors.forEach((count, interval) => {
    if (count > maxCount) {
      maxCount = count;
      dominantInterval = interval;
    }
  });

  console.log(`[BPM Detector] Dominant interval ${dominantInterval} appears ${maxCount} times (with neighbors)`);

  return dominantInterval > 0 ? dominantInterval : null;
}
