export interface WaveformData {
  peaks: Float32Array;
  sampleRate: number;
  duration: number;
  bucketCount: number;
}

/**
 * Generate waveform data from an AudioBuffer
 * @param buffer - The audio buffer to analyze
 * @param bucketCount - Number of waveform buckets to generate (default: 480)
 * @returns WaveformData containing peaks, metadata
 */
export function generateWaveform(
  buffer: AudioBuffer,
  bucketCount: number = 480
): WaveformData {
  const { duration, sampleRate } = buffer;

  // Extract mono channel (mix stereo to mono if needed)
  const channelData = extractMonoChannel(buffer);

  // Calculate samples per bucket
  const samplesPerBucket = Math.floor(channelData.length / bucketCount);

  // Calculate RMS amplitude for each bucket
  const peaks = new Float32Array(bucketCount);

  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, channelData.length);

    // Calculate RMS (Root Mean Square) for this bucket
    let sum = 0;
    for (let j = start; j < end; j++) {
      const val = channelData[j] ?? 0;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / (end - start));
    peaks[i] = rms;
  }

  // Normalize to 0-1 range
  const maxPeak = Math.max(...peaks);
  if (maxPeak > 0) {
    for (let i = 0; i < bucketCount; i++) {
      const currentPeak = peaks[i];
      if (currentPeak !== undefined) {
        peaks[i] = currentPeak / maxPeak;
      }
    }
  }

  return {
    peaks,
    sampleRate,
    duration,
    bucketCount,
  };
}

/**
 * Extract mono channel from audio buffer (mix stereo to mono if needed)
 */
function extractMonoChannel(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }

  // Mix stereo to mono
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let i = 0; i < left.length; i++) {
    mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
  }

  return mono;
}
