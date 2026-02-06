# DJ Board Assets Guide

This document explains how to manage audio samples, icons, and other assets for the DJ board.

## Directory Structure

```
apps/web/public/assets/
├── audio/
│   └── samples/           # Default sampler sounds
│       ├── kick.wav       # Slot 0 (R key)
│       ├── snare.wav      # Slot 1 (T key)
│       ├── hihat.wav      # Slot 2 (Y key)
│       └── clap.wav       # Slot 3 (U key)
├── dj-controls/           # DJ control SVG graphics
│   ├── backgrounds/
│   ├── buttons/
│   ├── indicators/
│   └── sampler/
└── performance-pads/      # Performance pad icon templates
    ├── performance-pad-template-char-icon.svg
    ├── performance-pad-red-char-icon.svg
    └── performance-pad-orange-char-icon.svg
```

## Audio Samples

### Current Default Samples

Located in `public/assets/audio/samples/`:
- **kick.wav** - Bass drum/kick sound (Slot 0, R key)
- **snare.wav** - Snare drum sound (Slot 1, T key)
- **hihat.wav** - Hi-hat cymbal sound (Slot 2, Y key)
- **clap.wav** - Hand clap sound (Slot 3, U key)

### Sample Specifications

For best results, default samples should be:
- **Format**: WAV (16-bit PCM recommended)
- **Sample Rate**: 44100 Hz (standard CD quality)
- **Channels**: Mono preferred (smaller file size)
- **Length**: Keep under 2 seconds for responsive playback
- **File Size**: Keep under 100 KB each

### Replacing Default Samples

To replace a default sample:

1. **Prepare your audio file**:
   ```bash
   # Convert to proper format using ffmpeg (if needed)
   ffmpeg -i your-sound.mp3 -ar 44100 -ac 1 -sample_fmt s16 kick.wav
   ```

2. **Replace the file**:
   ```bash
   cp your-new-kick.wav apps/web/public/assets/audio/samples/kick.wav
   ```

3. **Restart the dev server** to clear cache:
   ```bash
   npm run dev
   ```

### Finding Free Drum Samples

**Recommended sources** (royalty-free):
- [Freesound.org](https://freesound.org) - Search for "kick", "snare", "hihat", "clap"
- [99Sounds](https://99sounds.org/drum-samples/) - Free drum sample packs
- [BPB Free Samples](https://bedroomproducersblog.com/free-samples/) - Curated free samples
- [NASA Audio](https://www.nasa.gov/audio-and-ringtones/) - Unique space sounds!

**Sample search tips**:
- Look for "one-shot" samples (single hits)
- Prefer "dry" samples (no reverb/effects)
- 808 and 909 drum machines are classic choices
- Search for "punchy kick" or "tight snare" for DJ-style sounds

## Performance Pad Icons

### Current Icon Templates

Located in `public/assets/performance-pads/`:
- **performance-pad-template-char-icon.svg** - Base template (current color: #FF3B3B red)
- **performance-pad-orange-char-icon.svg** - Orange variant (#FF9F1C)
- **performance-pad-red-char-icon.svg** - Red variant (#FF3B3B)

### Icon Specifications

- **Format**: SVG (vector graphics)
- **ViewBox**: `0 0 80 80`
- **Size**: ~6-7 KB optimized
- **Color**: Uses CSS `currentColor` for the LED border
- **Features**:
  - 3D rubber/plastic button appearance
  - Inner concave shadow
  - LED border with bloom effect
  - Centered keybind character
  - Small icon slot (top-right)

### Customizing Icons

To create new pad icons:

1. **Start with the template**:
   ```bash
   cp public/assets/performance-pads/performance-pad-template-char-icon.svg my-new-pad.svg
   ```

2. **Edit the keybind character** (appears in 3 places for 3-layer etched effect):
   ```svg
   <!-- Find lines 95-100 in the SVG -->
   <text ...>G</text>  <!-- Change "G" to your key -->
   <text ...>G</text>  <!-- Change all 3 instances -->
   <text ...>G</text>
   ```

3. **Replace the icon** (lines 108-128, the `#pad-icon` group):
   - Keep the 3-layer structure (highlight/shadow/face)
   - Icon area: ~12x12px at scale 0.75
   - Use stroke, not fill for line icons

4. **Change the LED color** (line 4):
   ```svg
   <svg ... style="color: #FF3B3B">  <!-- Your color here -->
   ```

## Adding New Assets

### To add a new sampler slot:

1. **Add the sample file**:
   ```bash
   cp your-sound.wav apps/web/public/assets/audio/samples/crash.wav
   ```

2. **Update the sampler config** in `apps/web/src/audio/sampler.ts`:
   ```typescript
   const DEFAULT_SAMPLE_CONFIGS: Record<SampleSlot, SampleConfig> = {
     // ... existing slots ...
     4: { name: "Crash", defaultUrl: "/assets/audio/samples/crash.wav" },
   };
   ```

3. **Add keybind mapping**:
   ```typescript
   export const SAMPLER_KEYBINDS: Record<string, SampleSlot> = {
     // ... existing keys ...
     i: 4,  // New key
   };
   ```

## Asset Optimization Tips

### For Audio Files

```bash
# Optimize WAV file (reduce to mono, 44.1kHz, 16-bit)
ffmpeg -i input.wav -ar 44100 -ac 1 -sample_fmt s16 output.wav

# Convert from MP3 to optimized WAV
ffmpeg -i input.mp3 -ar 44100 -ac 1 -sample_fmt s16 output.wav

# Trim silence from beginning and end
ffmpeg -i input.wav -af silenceremove=1:0:-50dB output.wav
```

### For SVG Files

```bash
# Optimize SVG files (requires svgo)
npm install -g svgo
svgo input.svg -o output.svg

# Or use online tool: https://jakearchibald.github.io/svgomg/
```

## Asset File Sizes

**Current totals**:
- Audio samples: ~88 KB total (4 files)
- Performance pad SVGs: ~20 KB total (3 files)
- DJ controls: Varies (backgrounds, buttons, indicators)

**Recommended limits**:
- Individual audio sample: < 100 KB
- Individual SVG icon: < 10 KB
- Total assets loaded on page load: < 500 KB

## License & Attribution

**Default Samples**:
- Check `apps/web/public/assets/audio/samples/LICENSE.txt` for attribution
- If using samples from Freesound, add attribution to LICENSE.txt

**Icons**:
- Original designs created for puidBoard
- MIT License (same as project)

## Troubleshooting

### "Failed to load sample" errors

1. Check file path in browser DevTools Network tab
2. Verify file exists: `ls -la apps/web/public/assets/audio/samples/`
3. Check file format: `file apps/web/public/assets/audio/samples/kick.wav`
4. Clear browser cache and restart dev server

### Samples sound distorted

- Check sample rate (should be 44100 Hz)
- Reduce volume in audio editor if clipping
- Convert to 16-bit PCM if using 24-bit

### SVG icons not displaying

- Validate SVG syntax: https://validator.w3.org/
- Check viewBox attribute is `0 0 80 80`
- Ensure no external dependencies (embedded fonts/images)
- Test in browser: Open SVG directly in Chrome/Firefox

## Quick Commands

```bash
# Check all audio samples
ls -lh public/assets/audio/samples/

# Get audio file info
file public/assets/audio/samples/*.wav

# Check SVG file sizes
ls -lh public/assets/performance-pads/*.svg

# Convert MP3 to optimized WAV
ffmpeg -i sound.mp3 -ar 44100 -ac 1 -sample_fmt s16 public/assets/audio/samples/sound.wav

# Optimize SVG
svgo public/assets/performance-pads/icon.svg
```
