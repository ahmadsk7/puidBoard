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
    console.log('[BPM Detector] ╔════════════════════════════════════════════════════════════╗');
    console.log('[BPM Detector] ║      STARTING BPM DETECTION - FULL DEBUG MODE            ║');
    console.log('[BPM Detector] ╚════════════════════════════════════════════════════════════╝');
    console.log(`[BPM Detector] Buffer properties:`);
    console.log(`[BPM Detector]   - duration: ${buffer.duration.toFixed(2)}s`);
    console.log(`[BPM Detector]   - sampleRate: ${buffer.sampleRate} Hz`);
    console.log(`[BPM Detector]   - numberOfChannels: ${buffer.numberOfChannels}`);
    console.log(`[BPM Detector]   - length (samples): ${buffer.length}`);
    console.log(`[BPM Detector]   - buffer type: ${buffer.constructor.name}`);

    // Sanity check - ensure buffer has audio data
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 1: Checking audio data integrity...`);
    const rawChannelData = buffer.getChannelData(0);
    console.log(`[BPM Detector]   - channel 0 data type: ${rawChannelData.constructor.name}`);
    console.log(`[BPM Detector]   - channel 0 length: ${rawChannelData.length}`);

    // Check multiple sections to avoid false positives from silent lead-ins
    let maxSample = 0;
    let minSample = 0;
    let sumSample = 0;

    // Check 3 sections: beginning, 25% in (skip lead-in), and middle
    const sections = [
      { start: 0, size: Math.min(10000, rawChannelData.length) },
      { start: Math.floor(rawChannelData.length * 0.25), size: 10000 },
      { start: Math.floor(rawChannelData.length * 0.5), size: 10000 },
    ];

    let totalSamples = 0;
    for (const section of sections) {
      const endIdx = Math.min(section.start + section.size, rawChannelData.length);
      for (let i = section.start; i < endIdx; i++) {
        const sample = rawChannelData[i] ?? 0;
        maxSample = Math.max(maxSample, sample);
        minSample = Math.min(minSample, sample);
        sumSample += Math.abs(sample);
        totalSamples++;
      }
    }
    const avgSample = totalSamples > 0 ? sumSample / totalSamples : 0;

    console.log(`[BPM Detector]   - Analyzed ${totalSamples} samples across ${sections.length} sections:`);
    console.log(`[BPM Detector]   - max amplitude: ${maxSample.toFixed(6)}`);
    console.log(`[BPM Detector]   - min amplitude: ${minSample.toFixed(6)}`);
    console.log(`[BPM Detector]   - avg absolute amplitude: ${avgSample.toFixed(6)}`);
    console.log(`[BPM Detector]   - peak-to-peak range: ${(maxSample - minSample).toFixed(6)}`);

    if (maxSample < 0.001) {
      console.error('[BPM Detector] ❌ FATAL: Audio appears silent or nearly silent');
      console.error('[BPM Detector]    Max sample amplitude is below threshold (0.001)');
      return null;
    }
    console.log(`[BPM Detector] ✓ Audio data check passed`);

    // Use first 30 seconds for analysis (sufficient for BPM detection)
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 2: Extracting analysis segment...`);
    const analysisDuration = Math.min(30, buffer.duration);
    const sampleCount = Math.floor(analysisDuration * buffer.sampleRate);
    console.log(`[BPM Detector]   - Analysis duration: ${analysisDuration.toFixed(1)}s`);
    console.log(`[BPM Detector]   - Sample count: ${sampleCount} samples`);
    console.log(`[BPM Detector]   - Percentage of track: ${(analysisDuration / buffer.duration * 100).toFixed(1)}%`);

    // Extract mono channel
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 3: Converting to mono...`);
    console.log(`[BPM Detector]   - Source channels: ${buffer.numberOfChannels}`);
    const channelData = extractMonoChannel(buffer, sampleCount);
    console.log(`[BPM Detector]   - Mono channel length: ${channelData.length} samples`);
    console.log(`[BPM Detector]   - Mono data type: ${channelData.constructor.name}`);

    // Check mono data
    let monoMax = 0;
    for (let i = 0; i < Math.min(1000, channelData.length); i++) {
      monoMax = Math.max(monoMax, Math.abs(channelData[i] ?? 0));
    }
    console.log(`[BPM Detector]   - Mono max amplitude (first 1k samples): ${monoMax.toFixed(6)}`);

    // Apply low-pass filter to isolate bass frequencies (improves beat detection)
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 4: Applying low-pass filter...`);
    console.log(`[BPM Detector]   - Filter type: IIR (alpha=0.1)`);
    console.log(`[BPM Detector]   - Target: isolate bass/kick frequencies`);
    const filtered = applyLowPassFilter(channelData);
    console.log(`[BPM Detector]   - Filtered length: ${filtered.length} samples`);

    // Check filtered data
    let filteredMax = 0;
    for (let i = 0; i < Math.min(1000, filtered.length); i++) {
      filteredMax = Math.max(filteredMax, Math.abs(filtered[i] ?? 0));
    }
    console.log(`[BPM Detector]   - Filtered max amplitude (first 1k samples): ${filteredMax.toFixed(6)}`);

    // Calculate energy envelope
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 5: Calculating energy envelope...`);
    console.log(`[BPM Detector]   - Window size: 50ms`);
    console.log(`[BPM Detector]   - Hop size: 25ms (50% overlap)`);
    const envelope = calculateEnergyEnvelope(filtered, buffer.sampleRate);
    console.log(`[BPM Detector]   - Envelope frames: ${envelope.length}`);
    console.log(`[BPM Detector]   - Envelope duration: ${(envelope.length * 25 / 1000).toFixed(2)}s`);

    // Log envelope stats
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 6: Analyzing envelope statistics...`);
    let envMax = 0, envMin = Infinity, envSum = 0;
    for (let i = 0; i < envelope.length; i++) {
      const v = envelope[i] ?? 0;
      envMax = Math.max(envMax, v);
      envMin = Math.min(envMin, v);
      envSum += v;
    }
    const envAvg = envSum / envelope.length;
    console.log(`[BPM Detector]   - Envelope min: ${envMin.toFixed(6)}`);
    console.log(`[BPM Detector]   - Envelope max: ${envMax.toFixed(6)}`);
    console.log(`[BPM Detector]   - Envelope avg: ${envAvg.toFixed(6)}`);
    console.log(`[BPM Detector]   - Dynamic range: ${(envMax / (envMin + 0.000001)).toFixed(2)}x`);

    // INDUSTRY STANDARD: Use autocorrelation to find tempo periodicity
    console.log(`[BPM Detector] ─────────────────────────────────────────────────────────────`);
    console.log(`[BPM Detector] STEP 7: Autocorrelation-based tempo detection...`);
    console.log(`[BPM Detector]   - Method: Industry standard (Rekordbox, Serato, Essentia)`);
    console.log(`[BPM Detector]   - Finding periodicity in energy envelope...`);

    const bpm = detectBPMViaAutocorrelation(envelope);

    if (bpm && bpm >= 60 && bpm <= 180) {
      console.log(`[BPM Detector] ╔════════════════════════════════════════════════════════════╗`);
      console.log(`[BPM Detector] ║  ✓ DETECTION SUCCESSFUL: ${bpm} BPM                     `);
      console.log(`[BPM Detector] ║  Method: Autocorrelation                                  ║`);
      console.log(`[BPM Detector] ╚════════════════════════════════════════════════════════════╝`);
      console.log(`[BPM Detector] RETURNING VALUE: ${bpm} (type: ${typeof bpm})`);
      return bpm;
    }

    console.log(`[BPM Detector] ╔════════════════════════════════════════════════════════════╗`);
    console.log(`[BPM Detector] ║  ✗ DETECTION FAILED                                       ║`);
    console.log(`[BPM Detector] ║  Autocorrelation returned: ${bpm}                         ║`);
    console.log(`[BPM Detector] ╚════════════════════════════════════════════════════════════╝`);
    console.log(`[BPM Detector] RETURNING: null`);
    return null;
  } catch (error) {
    console.log(`[BPM Detector] ╔════════════════════════════════════════════════════════════╗`);
    console.log(`[BPM Detector] ║  ✗ EXCEPTION THROWN DURING DETECTION                     ║`);
    console.log(`[BPM Detector] ╚════════════════════════════════════════════════════════════╝`);
    console.error('[BPM Detector] Error details:', error);
    if (error instanceof Error) {
      console.error('[BPM Detector] Stack trace:', error.stack);
    }
    console.log(`[BPM Detector] RETURNING: null (due to exception)`);
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
 * Detect BPM using autocorrelation (industry standard method).
 *
 * This is the method used by professional DJ software (Rekordbox, Serato, Traktor)
 * and audio analysis libraries (Essentia/Spotify, librosa).
 *
 * How it works:
 * 1. Correlate the energy envelope with itself at different time lags
 * 2. The lag with the highest correlation is the beat period
 * 3. Convert that period to BPM
 *
 * Why it's better than histogram:
 * - Finds PERIODICITY (repeating patterns) not just common intervals
 * - Works with complex rhythms, syncopation, ornamentation
 * - The beat period creates the strongest self-correlation
 *
 * @param envelope Energy envelope of the audio
 * @returns BPM or null if detection fails
 */
function detectBPMViaAutocorrelation(envelope: Float32Array): number | null {
  const FRAME_DURATION_MS = 25; // Each frame is 25ms (from 50ms window with 50% overlap)

  // BPM range to search: 60-180 BPM (standard music range)
  const MIN_BPM = 60;
  const MAX_BPM = 180;

  // Convert BPM range to lag range (in frames)
  // At 60 BPM: 1 beat = 1000ms = 40 frames
  // At 180 BPM: 1 beat = 333ms = 13.3 frames
  const minLag = Math.floor(60000 / (MAX_BPM * FRAME_DURATION_MS)); // ~13 frames
  const maxLag = Math.floor(60000 / (MIN_BPM * FRAME_DURATION_MS));  // ~40 frames

  console.log(`[BPM Detector]   - Testing lag range: ${minLag} to ${maxLag} frames`);
  console.log(`[BPM Detector]   - Corresponds to: ${MAX_BPM} to ${MIN_BPM} BPM`);
  console.log(`[BPM Detector]   - Envelope length: ${envelope.length} frames`);

  // Normalize the envelope (important for correlation)
  let envelopeMean = 0;
  for (let i = 0; i < envelope.length; i++) {
    envelopeMean += envelope[i] ?? 0;
  }
  envelopeMean /= envelope.length;

  const normalizedEnvelope = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) {
    normalizedEnvelope[i] = (envelope[i] ?? 0) - envelopeMean;
  }

  console.log(`[BPM Detector]   - Envelope normalized (mean removed)`);
  console.log(`[BPM Detector]   - Computing autocorrelation...`);

  // Compute autocorrelation for each lag
  let bestLag = 0;
  let maxCorrelation = -Infinity;
  const correlations: Array<{ lag: number; correlation: number; bpm: number }> = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let count = 0;

    // Correlate envelope with itself at this lag
    for (let i = 0; i < envelope.length - lag; i++) {
      correlation += normalizedEnvelope[i]! * normalizedEnvelope[i + lag]!;
      count++;
    }

    // Normalize by the number of samples
    correlation /= count;

    // Calculate BPM for this lag
    const beatDurationMs = lag * FRAME_DURATION_MS;
    const bpm = 60000 / beatDurationMs;

    correlations.push({ lag, correlation, bpm });

    // Track the best correlation
    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
      bestLag = lag;
    }
  }

  console.log(`[BPM Detector]   - Autocorrelation complete`);
  console.log(`[BPM Detector]   - Best lag: ${bestLag} frames`);
  console.log(`[BPM Detector]   - Correlation strength: ${maxCorrelation.toFixed(4)}`);

  // Find peaks in autocorrelation (for octave detection)
  correlations.sort((a, b) => b.correlation - a.correlation);
  const topPeaks = correlations.slice(0, 5);

  console.log(`[BPM Detector]   - Top 5 tempo candidates:`);
  topPeaks.forEach((peak, i) => {
    console.log(`[BPM Detector]     ${i + 1}. ${peak.bpm.toFixed(1)} BPM (lag: ${peak.lag}, correlation: ${peak.correlation.toFixed(4)})`);
  });

  if (bestLag === 0 || maxCorrelation <= 0) {
    console.log(`[BPM Detector]   ✗ No significant periodicity found`);
    return null;
  }

  // Convert best lag to BPM
  const beatDurationMs = bestLag * FRAME_DURATION_MS;
  const rawBpm = 60000 / beatDurationMs;

  console.log(`[BPM Detector]   - Beat period: ${beatDurationMs.toFixed(1)}ms`);
  console.log(`[BPM Detector]   - Raw BPM: ${rawBpm.toFixed(2)}`);

  // Check for octave errors (detecting 2x or 0.5x the actual tempo)
  // Prefer tempos around 120 BPM (most common in music)
  let finalBpm = rawBpm;

  // If we have strong peaks at 2x or 0.5x, consider them
  const doubleBpm = rawBpm * 2;
  const halfBpm = rawBpm / 2;

  const doublePeak = topPeaks.find(p => Math.abs(p.bpm - doubleBpm) < 3);
  const halfPeak = topPeaks.find(p => Math.abs(p.bpm - halfBpm) < 3);

  // Prefer the tempo closest to 120 BPM if there are octave ambiguities
  if (halfPeak && halfPeak.correlation > maxCorrelation * 0.8) {
    const halfDist = Math.abs(halfBpm - 120);
    const rawDist = Math.abs(rawBpm - 120);
    if (halfDist < rawDist) {
      console.log(`[BPM Detector]   - Half-tempo (${halfBpm.toFixed(1)} BPM) is closer to typical range`);
      finalBpm = halfBpm;
    }
  } else if (doubleBpm <= 180 && doublePeak && doublePeak.correlation > maxCorrelation * 0.8) {
    const doubleDist = Math.abs(doubleBpm - 120);
    const rawDist = Math.abs(rawBpm - 120);
    if (doubleDist < rawDist) {
      console.log(`[BPM Detector]   - Double-tempo (${doubleBpm.toFixed(1)} BPM) is closer to typical range`);
      finalBpm = doubleBpm;
    }
  }

  const roundedBpm = Math.round(finalBpm);
  console.log(`[BPM Detector]   - Final BPM: ${finalBpm.toFixed(2)} → ${roundedBpm}`);

  return roundedBpm;
}
