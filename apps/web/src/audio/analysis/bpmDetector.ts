/**
 * Detect BPM (Beats Per Minute) from an audio buffer
 * Uses onset detection and autocorrelation on bass frequencies
 * @param buffer - The audio buffer to analyze
 * @returns Detected BPM (60-180 range) or null if detection fails
 */
export async function detectBPM(buffer: AudioBuffer): Promise<number | null> {
  try {
    // Use first 30 seconds for analysis (sufficient for BPM detection)
    const analysisDuration = Math.min(30, buffer.duration);
    const sampleCount = Math.floor(analysisDuration * buffer.sampleRate);

    // Extract mono channel
    const channelData = extractMonoChannel(buffer, sampleCount);

    // Apply low-pass filter to isolate bass frequencies (improves beat detection)
    const filtered = applyLowPassFilter(channelData);

    // Calculate energy envelope
    const envelope = calculateEnergyEnvelope(filtered, buffer.sampleRate);

    // Find peaks in envelope (onsets)
    const peaks = findPeaks(envelope);

    if (peaks.length < 2) {
      return null; // Not enough peaks to detect tempo
    }

    // Use autocorrelation to find dominant period
    const bpm = detectBPMFromPeaks(peaks);

    // Constrain to reasonable BPM range
    if (bpm && bpm >= 60 && bpm <= 180) {
      return Math.round(bpm);
    }

    return null;
  } catch (error) {
    console.warn('BPM detection failed:', error);
    return null;
  }
}

/**
 * Extract mono channel from audio buffer
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
 * Apply simple low-pass filter to isolate bass frequencies
 */
function applyLowPassFilter(data: Float32Array): Float32Array {
  const filtered = new Float32Array(data.length);
  const alpha = 0.1; // Smoothing factor

  filtered[0] = data[0] ?? 0;
  for (let i = 1; i < data.length; i++) {
    filtered[i] = alpha * (data[i] ?? 0) + (1 - alpha) * (filtered[i - 1] ?? 0);
  }

  return filtered;
}

/**
 * Calculate energy envelope with overlapping windows
 */
function calculateEnergyEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const hopSize = Math.floor(windowSize / 2); // 50% overlap
  const numFrames = Math.floor((data.length - windowSize) / hopSize);
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
 * Find peaks in the energy envelope (onset detection)
 */
function findPeaks(envelope: Float32Array): number[] {
  const peaks: number[] = [];
  const threshold = calculateDynamicThreshold(envelope);
  const minPeakDistance = 5; // Minimum frames between peaks

  for (let i = 1; i < envelope.length - 1; i++) {
    const current = envelope[i] ?? 0;
    const prev = envelope[i - 1] ?? 0;
    const next = envelope[i + 1] ?? 0;

    // Check if this is a local maximum above threshold
    if (
      current > threshold &&
      current > prev &&
      current > next
    ) {
      // Ensure minimum distance from last peak
      if (peaks.length === 0 || i - (peaks[peaks.length - 1] ?? 0) >= minPeakDistance) {
        peaks.push(i);
      }
    }
  }

  return peaks;
}

/**
 * Calculate dynamic threshold as percentage of max energy
 */
function calculateDynamicThreshold(envelope: Float32Array): number {
  const max = Math.max(...envelope);
  return max * 0.3; // 30% of max energy
}

/**
 * Detect BPM from peak intervals using autocorrelation
 */
function detectBPMFromPeaks(peaks: number[]): number | null {
  if (peaks.length < 2) return null;

  // Calculate intervals between consecutive peaks
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] ?? 0) - (peaks[i - 1] ?? 0));
  }

  // Find most common interval using autocorrelation
  const dominantInterval = findDominantInterval(intervals);

  if (!dominantInterval) return null;

  // Convert interval (in frames) to BPM
  // Each frame is 50ms window with 50% overlap = 25ms per frame
  const msPerFrame = 25;
  const msPerBeat = dominantInterval * msPerFrame;
  const bpm = 60000 / msPerBeat;

  return bpm;
}

/**
 * Find dominant interval using histogram approach
 */
function findDominantInterval(intervals: number[]): number | null {
  if (intervals.length === 0) return null;

  // Create histogram of intervals (rounded to nearest integer)
  const histogram = new Map<number, number>();

  for (const interval of intervals) {
    const rounded = Math.round(interval);
    histogram.set(rounded, (histogram.get(rounded) || 0) + 1);
  }

  // Find interval with highest count
  let maxCount = 0;
  let dominantInterval = 0;

  for (const [interval, count] of histogram) {
    if (count > maxCount) {
      maxCount = count;
      dominantInterval = interval;
    }
  }

  return dominantInterval > 0 ? dominantInterval : null;
}
