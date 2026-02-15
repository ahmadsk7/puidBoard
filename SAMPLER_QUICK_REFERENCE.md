# Sampler Quick Reference Card

## Current Hotkey Layout

```
┌─────────────────────────────────────────┐
│  DJ BOARD SAMPLER - Hotkeys & Sounds   │
├─────────┬─────────┬─────────┬───────────┤
│  R Key  │  T Key  │  Y Key  │  U Key    │
│  🎺     │         │         │  🔫       │
│ AIRHORN │  SNARE  │  HIHAT  │  GUNSHOT  │
│  1.8s   │  0.5s   │  0.3s   │   6.4s    │
└─────────┴─────────┴─────────┴───────────┘
```

## File Locations

### Audio Files
```
apps/web/public/assets/audio/samples/
├── kick.wav    → Airhorn (R key)
├── snare.wav   → Snare drum (T key)
├── hihat.wav   → Hi-hat (Y key)
└── clap.wav    → Gunshot (U key)
```

### SVG Icons
```
apps/web/public/assets/performance-pads/
├── DJ Mixer Airhorn.svg   → R key icon
└── DJ Mixer Gunshot.svg   → U key icon
```

## Code Configuration

### Sampler Config (`src/audio/sampler.ts`)
```typescript
// Sample names
DEFAULT_SAMPLE_NAMES = {
  0: "Airhorn",   // R key
  1: "Snare",     // T key
  2: "Hi-Hat",    // Y key
  3: "Gunshot",   // U key
}

// Icons (optional)
SLOT_ICONS = {
  0: "/assets/performance-pads/DJ Mixer Airhorn.svg",
  1: null,
  2: null,
  3: "/assets/performance-pads/DJ Mixer Gunshot.svg",
}
```

## How to Replace a Sample

### Method 1: Replace Default File
```bash
# 1. Convert your audio to WAV
ffmpeg -i your-sound.mp3 -ar 44100 -ac 1 -sample_fmt s16 output.wav

# 2. Copy to samples folder (choose the slot)
cp output.wav apps/web/public/assets/audio/samples/kick.wav   # R key
cp output.wav apps/web/public/assets/audio/samples/snare.wav  # T key
cp output.wav apps/web/public/assets/audio/samples/hihat.wav  # Y key
cp output.wav apps/web/public/assets/audio/samples/clap.wav   # U key

# 3. Update the name in sampler.ts
# Edit DEFAULT_SAMPLE_NAMES to match your new sound

# 4. Restart dev server
npm run dev
```

### Method 2: Add Icon (Optional)
```bash
# 1. Create or find SVG icon (recommended: 80x80 viewBox)
# 2. Save to: apps/web/public/assets/performance-pads/YourIcon.svg
# 3. Update SLOT_ICONS in sampler.ts:

SLOT_ICONS = {
  1: "/assets/performance-pads/YourIcon.svg",  // Add icon for T key
}
```

## Keyboard Layout in UI

The sampler buttons are located in the center of the DJ board, below the FX controls and above the crossfader:

```
╔═══════════════════════════════════╗
║         FX CONTROLS               ║
╠═══════════════════════════════════╣
║   [R]   [T]   [Y]   [U]          ║  ← Sampler Panel
║   🎺          🔫                  ║
╠═══════════════════════════════════╣
║      ━━━━━━━━━━━━━━━━━           ║  ← Crossfader
╚═══════════════════════════════════╝
```

## Testing Checklist

- [ ] Press R key → Plays airhorn
- [ ] Press T key → Plays snare
- [ ] Press Y key → Plays hi-hat
- [ ] Press U key → Plays gunshot
- [ ] Airhorn button shows icon
- [ ] Gunshot button shows icon
- [ ] Click buttons work
- [ ] Visual press feedback works
- [ ] Sounds play over music

## Slot Mapping Reference

| Slot | Key | Default Name | File         | Icon? |
|------|-----|-------------|--------------|-------|
| 0    | R   | Airhorn     | kick.wav     | ✅    |
| 1    | T   | Snare       | snare.wav    | ❌    |
| 2    | Y   | Hi-Hat      | hihat.wav    | ❌    |
| 3    | U   | Gunshot     | clap.wav     | ✅    |

## Common Tasks

### Change R key to different sound
```bash
ffmpeg -i newsound.mp3 -ar 44100 -ac 1 -sample_fmt s16 kick.wav
mv kick.wav apps/web/public/assets/audio/samples/
# Edit sampler.ts DEFAULT_SAMPLE_NAMES[0]
```

### Add icon for T key (slot 1)
```bash
# 1. Add SVG: apps/web/public/assets/performance-pads/MyIcon.svg
# 2. Edit sampler.ts:
SLOT_ICONS = {
  0: "/assets/performance-pads/DJ Mixer Airhorn.svg",
  1: "/assets/performance-pads/MyIcon.svg",  // ← Add this
  2: null,
  3: "/assets/performance-pads/DJ Mixer Gunshot.svg",
}
```

### Remove icon from U key
```typescript
SLOT_ICONS = {
  0: "/assets/performance-pads/DJ Mixer Airhorn.svg",
  1: null,
  2: null,
  3: null,  // ← Change to null
}
```

## Audio Specs

**Required format**:
- Format: WAV (RIFF)
- Sample Rate: 44100 Hz
- Bit Depth: 16-bit PCM
- Channels: Mono (recommended)
- Max Duration: ~10 seconds
- Max File Size: ~1 MB per sample

**Tips**:
- Keep samples under 2 seconds for responsive playback
- Normalize volume to -3dB peak
- Remove silence from start/end
- Use mono to save space
- Avoid heavy compression artifacts

## Icon Specs

**Recommended**:
- Format: SVG
- ViewBox: Any (will be scaled to fit)
- Size: Keep under 10 KB
- Style: Simple, high contrast
- Colors: Any (will blend with button)

**Placement**:
- Position: Top-right corner of button
- Size: 28% of button size
- Opacity: 75% (90% when pressed)
- Drop shadow: Automatic

## File Size Guidelines

| Component      | Current | Recommended Max |
|---------------|---------|-----------------|
| Airhorn WAV   | 158 KB  | < 200 KB        |
| Gunshot WAV   | 550 KB  | < 1 MB          |
| Airhorn SVG   | 2.1 KB  | < 10 KB         |
| Gunshot SVG   | 2.1 KB  | < 10 KB         |

**Total**: ~712 KB for all custom samples (acceptable)

## Troubleshooting

### Sound doesn't play
1. Check browser console for errors
2. Verify file exists: `ls apps/web/public/assets/audio/samples/`
3. Check file format: `file sample.wav`
4. Ensure dev server restarted

### Icon doesn't show
1. Check SVG file exists
2. Verify path in SLOT_ICONS
3. Check browser Network tab
4. Clear browser cache

### Wrong key plays
1. Verify SLOT_KEYBINDS mapping
2. Check keyboard event in console
3. Ensure not typing in input field

## Support

- Main docs: `SAMPLER_CUSTOM_AUDIO_IMPLEMENTATION.md`
- Asset guide: `apps/web/ASSETS.md`
- Code: `apps/web/src/audio/sampler.ts`
