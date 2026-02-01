/**
 * BPM Detection with Improved Accuracy
 *
 * Features:
 * - Expanded range: 40-200 BPM (covers most music genres)
 * - Confidence scoring to indicate reliability
 * - Smarter octave correction with genre-aware heuristics
 * - Multiple analysis windows for stability
 * - Better filtering and onset detection
 */

/** BPM detection result with confidence score */
export interface BpmResult {
  bpm: number;
  confidence: number; // 0-1, where 1 = high confidence
}

/** BPM range constants */
const MIN_BPM = 40;
const MAX_BPM = 200;
const PREFERRED_MIN_BPM = 80; // Most electronic/pop music is 80-160
const PREFERRED_MAX_BPM = 160;

/**
 * Detect BPM from an audio buffer with confidence scoring.
 *
 * @param buffer - The audio buffer to analyze
 * @returns BpmResult with detected BPM and confidence, or null if detection fails
 */
export async function detectBPMWithConfidence(buffer: AudioBuffer): Promise<BpmResult | null> {
  try {
    console.log('[BPM Detector] ========== STARTING BPM DETECTION ==========');
    console.log(`[BPM Detector] Buffer: duration=${buffer.duration.toFixed(2)}s, sampleRate=${buffer.sampleRate}`);

    // Need at least 10 seconds for reliable detection
    if (buffer.duration < 10) {
      console.warn('[BPM Detector] Track too short for reliable BPM detection');
      return null;
    }

    // Use multiple segments of the track for stability
    const results: BpmResult[] = [];

    // Analyze segments at 0-30s, 15-45s, 30-60s (if available)
    const segmentStarts = [0, 15, 30].filter(start => start + 15 <= buffer.duration);

    for (const startSec of segmentStarts) {
      const segmentResult = await analyzeSegment(buffer, startSec, Math.min(30, buffer.duration - startSec));
      if (segmentResult) {
        results.push(segmentResult);
      }
    }

    if (results.length === 0) {
      console.warn('[BPM Detector] All segment analyses failed');
      return null;
    }

    // Find consensus BPM across segments
    const finalResult = findConsensusBpm(results);

    console.log(`[BPM Detector] ========== BPM DETECTION COMPLETE ==========`);
    console.log(`[BPM Detector] Final BPM: ${finalResult.bpm} (confidence: ${(finalResult.confidence * 100).toFixed(0)}%)`);

    return finalResult;
  } catch (error) {
    console.error('[BPM Detector] Detection failed with error:', error);
    return null;
  }
}

/**
 * Legacy function for backwards compatibility.
 * Returns just the BPM number or null.
 */
export async function detectBPM(buffer: AudioBuffer): Promise<number | null> {
  const result = await detectBPMWithConfidence(buffer);
  return result?.bpm ?? null;
}

/**
 * Analyze a segment of the audio buffer for BPM.
 */
async function analyzeSegment(
  buffer: AudioBuffer,
  startSec: number,
  durationSec: number
): Promise<BpmResult | null> {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const sampleCount = Math.floor(durationSec * sampleRate);

  // Extract mono channel for this segment
  const channelData = extractMonoChannel(buffer, startSample, sampleCount);

  // Apply band-pass filter to isolate rhythmic content (bass + kick drum frequencies)
  const filtered = applyBandPassFilter(channelData, sampleRate);

  // Calculate energy envelope with adaptive window
  const envelope = calculateEnergyEnvelope(filtered, sampleRate);

  // Compute autocorrelation to find dominant period
  const result = detectBpmFromAutocorrelation(envelope, sampleRate);

  return result;
}

/**
 * Extract mono channel from audio buffer.
 */
function extractMonoChannel(
  buffer: AudioBuffer,
  startSample: number,
  sampleCount: number
): Float32Array {
  const mono = new Float32Array(sampleCount);
  const left = buffer.getChannelData(0);

  if (buffer.numberOfChannels === 1) {
    for (let i = 0; i < sampleCount; i++) {
      mono[i] = left[startSample + i] ?? 0;
    }
  } else {
    // Mix stereo to mono
    const right = buffer.getChannelData(1);
    for (let i = 0; i < sampleCount; i++) {
      mono[i] = ((left[startSample + i] ?? 0) + (right[startSample + i] ?? 0)) / 2;
    }
  }

  return mono;
}

/**
 * Apply band-pass filter to isolate rhythmic content.
 * Focuses on 60-200Hz range where kick drums and bass live.
 */
function applyBandPassFilter(data: Float32Array, sampleRate: number): Float32Array {
  // Use a simple IIR filter implementation
  // Low-pass at 200Hz, high-pass at 60Hz
  const lowCutoff = 60 / (sampleRate / 2);
  const highCutoff = 200 / (sampleRate / 2);

  // First, apply low-pass
  const lowPassed = applyLowPass(data, highCutoff);

  // Then apply high-pass (by subtracting low frequencies)
  const highPassed = applyHighPass(lowPassed, lowCutoff);

  return highPassed;
}

/**
 * Simple low-pass filter.
 */
function applyLowPass(data: Float32Array, cutoff: number): Float32Array {
  const filtered = new Float32Array(data.length);
  const alpha = Math.min(1, cutoff * 2); // Simplified coefficient

  filtered[0] = data[0] ?? 0;
  for (let i = 1; i < data.length; i++) {
    filtered[i] = alpha * (data[i] ?? 0) + (1 - alpha) * (filtered[i - 1] ?? 0);
  }

  return filtered;
}

/**
 * Simple high-pass filter (subtractive method).
 */
function applyHighPass(data: Float32Array, cutoff: number): Float32Array {
  const filtered = new Float32Array(data.length);
  const alpha = Math.max(0.01, 1 - cutoff * 2);

  let prev = data[0] ?? 0;
  let prevFiltered = 0;

  for (let i = 0; i < data.length; i++) {
    const current = data[i] ?? 0;
    const newValue = alpha * (prevFiltered + current - prev);
    filtered[i] = newValue;
    prev = current;
    prevFiltered = newValue;
  }

  return filtered;
}

/**
 * Calculate energy envelope with overlapping windows.
 */
function calculateEnergyEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  // Use 50ms windows with 10ms hop for better time resolution
  const windowSizeMs = 50;
  const hopSizeMs = 10;

  const windowSize = Math.floor(sampleRate * windowSizeMs / 1000);
  const hopSize = Math.floor(sampleRate * hopSizeMs / 1000);
  const numFrames = Math.floor((data.length - windowSize) / hopSize);

  const envelope = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    const end = start + windowSize;

    // Calculate RMS energy
    let sum = 0;
    for (let j = start; j < end; j++) {
      const val = data[j] ?? 0;
      sum += val * val;
    }
    envelope[i] = Math.sqrt(sum / windowSize);
  }

  // Normalize envelope
  let max = 0;
  for (let i = 0; i < envelope.length; i++) {
    const val = envelope[i] ?? 0;
    if (val > max) max = val;
  }
  if (max > 0) {
    for (let i = 0; i < envelope.length; i++) {
      const val = envelope[i] ?? 0;
      envelope[i] = val / max;
    }
  }

  // Apply onset detection (difference envelope)
  const onset = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) {
    // Only keep positive changes (onsets, not offsets)
    const curr = envelope[i] ?? 0;
    const prev = envelope[i - 1] ?? 0;
    onset[i] = Math.max(0, curr - prev);
  }

  return onset;
}

/**
 * Detect BPM from envelope using autocorrelation.
 * This is more robust than peak-interval analysis.
 */
function detectBpmFromAutocorrelation(
  envelope: Float32Array,
  _sampleRate: number
): BpmResult | null {
  // Frame rate based on hop size (10ms)
  const frameRate = 1000 / 10; // 100 frames per second

  // Convert BPM range to lag range (in frames)
  // BPM = 60 / (lag / frameRate) = 60 * frameRate / lag
  // lag = 60 * frameRate / BPM
  const minLag = Math.floor(60 * frameRate / MAX_BPM); // 200 BPM -> 30 frames
  const maxLag = Math.floor(60 * frameRate / MIN_BPM);  // 40 BPM -> 150 frames

  // Calculate autocorrelation for each lag
  const correlations: number[] = [];
  const maxOffset = Math.min(maxLag, envelope.length / 2);

  for (let lag = minLag; lag <= maxOffset; lag++) {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < envelope.length - lag; i++) {
      sum += (envelope[i] ?? 0) * (envelope[i + lag] ?? 0);
      count++;
    }

    correlations[lag] = count > 0 ? sum / count : 0;
  }

  // Find peaks in correlation
  const peaks: Array<{ lag: number; correlation: number }> = [];

  for (let lag = minLag + 1; lag < maxOffset - 1; lag++) {
    const prev = correlations[lag - 1] ?? 0;
    const curr = correlations[lag] ?? 0;
    const next = correlations[lag + 1] ?? 0;

    if (curr > prev && curr > next && curr > 0.1) {
      peaks.push({ lag, correlation: curr });
    }
  }

  if (peaks.length === 0) {
    console.log('[BPM Detector] No correlation peaks found');
    return null;
  }

  // Sort peaks by correlation strength
  peaks.sort((a, b) => b.correlation - a.correlation);

  // Get the strongest peak
  const bestPeak = peaks[0];
  if (!bestPeak) return null;

  // Convert lag to BPM
  let bpm = 60 * frameRate / bestPeak.lag;

  // Apply smart octave correction
  bpm = applyOctaveCorrection(bpm, peaks, frameRate);

  // Round to nearest integer
  bpm = Math.round(bpm);

  // Calculate confidence based on peak strength and consistency
  const confidence = calculateConfidence(bestPeak.correlation, peaks);

  console.log(`[BPM Detector] Segment result: ${bpm} BPM (confidence: ${(confidence * 100).toFixed(0)}%)`);

  return { bpm, confidence };
}

/**
 * Apply smart octave correction.
 * Uses heuristics to determine if we've detected a half or double time.
 */
function applyOctaveCorrection(
  rawBpm: number,
  peaks: Array<{ lag: number; correlation: number }>,
  frameRate: number
): number {
  let bpm = rawBpm;

  // First, get BPM into the valid range
  while (bpm > MAX_BPM) {
    bpm /= 2;
  }
  while (bpm < MIN_BPM) {
    bpm *= 2;
  }

  // If we're in the preferred range, we're probably good
  if (bpm >= PREFERRED_MIN_BPM && bpm <= PREFERRED_MAX_BPM) {
    return bpm;
  }

  // Look for harmonically related peaks in the top 5 candidates
  for (const peak of peaks.slice(0, 5)) {
    const peakBpm = 60 * frameRate / peak.lag;

    // Check if this peak suggests a different but valid BPM
    if (peakBpm >= PREFERRED_MIN_BPM && peakBpm <= PREFERRED_MAX_BPM) {
      // Check if it's harmonically related to our current BPM
      const ratio = peakBpm / bpm;
      if (Math.abs(ratio - 2) < 0.1 || Math.abs(ratio - 0.5) < 0.1) {
        console.log(`[BPM Detector] Octave correction: ${bpm.toFixed(1)} -> ${peakBpm.toFixed(1)} (harmonic)`);
        return peakBpm;
      }
    }
  }

  // If BPM is low (40-80), check if doubling puts it in a better range
  if (bpm < PREFERRED_MIN_BPM && bpm * 2 <= PREFERRED_MAX_BPM) {
    console.log(`[BPM Detector] Octave correction: ${bpm.toFixed(1)} -> ${(bpm * 2).toFixed(1)} (double)`);
    return bpm * 2;
  }

  // If BPM is high (160-200), check if halving puts it in a better range
  if (bpm > PREFERRED_MAX_BPM && bpm / 2 >= PREFERRED_MIN_BPM) {
    console.log(`[BPM Detector] Octave correction: ${bpm.toFixed(1)} -> ${(bpm / 2).toFixed(1)} (half)`);
    return bpm / 2;
  }

  return bpm;
}

/**
 * Calculate confidence score based on correlation strength and peak consistency.
 */
function calculateConfidence(
  peakCorrelation: number,
  peaks: Array<{ lag: number; correlation: number }>
): number {
  // Base confidence from correlation strength
  let confidence = Math.min(1, peakCorrelation * 2);

  // Boost confidence if we have clear harmonic peaks
  if (peaks.length >= 2) {
    const firstPeak = peaks[0];
    const secondPeak = peaks[1];

    if (firstPeak && secondPeak) {
      // Check if second peak is at double/half the lag (harmonic)
      const ratio = secondPeak.lag / firstPeak.lag;
      if (Math.abs(ratio - 2) < 0.15 || Math.abs(ratio - 0.5) < 0.15) {
        confidence = Math.min(1, confidence * 1.2);
      }
    }
  }

  // Reduce confidence if peak is weak
  if (peakCorrelation < 0.3) {
    confidence *= 0.7;
  }

  return confidence;
}

/**
 * Find consensus BPM across multiple segment results.
 */
function findConsensusBpm(results: BpmResult[]): BpmResult {
  if (results.length === 1) {
    return results[0]!;
  }

  // Weight results by their confidence
  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of results) {
    weightedSum += result.bpm * result.confidence;
    totalWeight += result.confidence;
  }

  const consensusBpm = Math.round(weightedSum / totalWeight);

  // Calculate final confidence based on agreement between segments
  const bpms = results.map(r => r.bpm);
  const maxDiff = Math.max(...bpms) - Math.min(...bpms);

  // If all segments agree within 2 BPM, high confidence
  // If they differ by more, reduce confidence
  const agreementFactor = maxDiff <= 2 ? 1 : maxDiff <= 5 ? 0.8 : maxDiff <= 10 ? 0.6 : 0.4;

  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const finalConfidence = avgConfidence * agreementFactor;

  console.log(`[BPM Detector] Consensus: ${consensusBpm} BPM from ${results.length} segments (max diff: ${maxDiff})`);

  return {
    bpm: consensusBpm,
    confidence: finalConfidence,
  };
}
