/**
 * Generate default drum sample WAV files
 * Run with: node scripts/generate-samples.js
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '../public/assets/audio/samples');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Create a WAV file buffer from audio samples
 */
function createWavBuffer(samples, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = Math.round(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

/**
 * Generate a kick drum sample
 */
function generateKick() {
  const duration = 0.3;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Frequency sweep from 150Hz down to 40Hz
    const freqStart = 150;
    const freqEnd = 40;
    const freqDecay = 15;
    const freq = freqEnd + (freqStart - freqEnd) * Math.exp(-freqDecay * t);

    // Sine wave with frequency sweep
    const phase = 2 * Math.PI * freq * t;
    const sine = Math.sin(phase);

    // Amplitude envelope (exponential decay)
    const envelope = Math.exp(-8 * t);

    // Add some click at the start
    const click = i < SAMPLE_RATE * 0.003 ? Math.sin(2 * Math.PI * 1000 * t) * 0.3 : 0;

    samples[i] = (sine * envelope + click) * 0.9;
  }

  return samples;
}

/**
 * Generate a snare drum sample
 */
function generateSnare() {
  const duration = 0.25;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Body: low frequency component
    const bodyFreq = 180;
    const body = Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-20 * t);

    // Noise: white noise for snare rattle
    const noise = (Math.random() * 2 - 1) * Math.exp(-15 * t);

    // Mix body and noise
    samples[i] = (body * 0.5 + noise * 0.5) * 0.9;
  }

  return samples;
}

/**
 * Generate a hi-hat sample
 */
function generateHiHat() {
  const duration = 0.15;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // High-frequency noise
    const noise = Math.random() * 2 - 1;

    // Fast exponential decay
    const envelope = Math.exp(-30 * t);

    // High-pass filter effect (simple approximation)
    const highFreq = Math.sin(2 * Math.PI * 8000 * t) + Math.sin(2 * Math.PI * 10000 * t);

    samples[i] = (noise * 0.6 + highFreq * 0.2) * envelope * 0.7;
  }

  return samples;
}

/**
 * Generate a clap sample
 */
function generateClap() {
  const duration = 0.3;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Multiple layered claps with slight offsets
    let clap = 0;
    const offsets = [0, 0.008, 0.015, 0.022];

    for (const offset of offsets) {
      const localT = t - offset;
      if (localT >= 0) {
        // Filtered noise burst
        const noise = Math.random() * 2 - 1;
        const envelope = Math.exp(-25 * localT);
        clap += noise * envelope * 0.3;
      }
    }

    // Main body decay
    const bodyEnvelope = Math.exp(-12 * t);
    clap *= bodyEnvelope;

    samples[i] = clap * 0.9;
  }

  return samples;
}

// Generate all samples
console.log('Generating drum samples...');

const sampleGenerators = {
  'kick.wav': generateKick,
  'snare.wav': generateSnare,
  'hihat.wav': generateHiHat,
  'clap.wav': generateClap,
};

for (const [filename, generator] of Object.entries(sampleGenerators)) {
  const samples = generator();
  const wavBuffer = createWavBuffer(samples);
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, wavBuffer);
  console.log(`Created: ${filepath} (${wavBuffer.length} bytes)`);
}

console.log('Done!');
