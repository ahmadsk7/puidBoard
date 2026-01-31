# DJ Mixer UI Assets Guide

## Asset Strategy (Hybrid Approach)

### SVG Background Panels (The "Big Box"):
**Best for visual appeal!** Create realistic, polished panel backgrounds as SVG:
- **Main mixer panel background** - Full board visual with deck sections, labels, textures
- **Individual deck panels** - Optional: separate background per deck
- **Center mixer section** - Optional: separate center console background

**Why SVG backgrounds:**
- ✅ Photorealistic textures (brushed metal, carbon fiber, matte finish)
- ✅ Professional polish - looks like a $500 DJ controller
- ✅ Designer has full control over every detail
- ✅ Scalable vector (crisp at any screen size)
- ✅ Panel details: screws, vents, logos, silk-screen labels, LED indicators
- ✅ File size: ~50-150KB when optimized

**Implementation:** SVG as background layer, HTML interactive controls positioned on top

### Small SVG Control Elements:
- Button icons (play, pause, cue, sync)
- Jog wheel disc graphics (vinyl texture with subtle animation feel)
- Knob position indicators (glowing line/dot)
- Fader/slider handles (metallic caps with depth)
- LED indicators (with glow effect)
- Decorative accents (corner details, brand elements)

### What Gets Built with Code (No Asset Files):
- Waveforms → Canvas rendering (real-time audio visualization)
- VU meters → Canvas animation
- Control interactions → CSS `transform` animations (rotation, sliding)
- Layouts → HTML/CSS flexbox/grid
- Ownership glows → CSS box-shadow with user colors

---

## Required SVG Assets (PR 2.4)

### 🎨 Large Panel Backgrounds (NEW - Hybrid Approach)

#### Main Mixer Panel Background
- [ ] **`mixer-panel-background.svg`**
  - Full DJ board layout (1400-1600px wide)
  - Three sections: Deck A (left) | Mixer (center) | Deck B (right)
  - Brushed aluminum or matte black finish
  - Subtle panel separators and depth
  - Decorative elements: corner screws, vents, brand logo area
  - Labels for sections (silk-screen style text: "DECK A", "MIXER", "DECK B")
  - Optional: subtle grid lines or geometric patterns for visual interest
  - LED indicator spots (circular recesses where LEDs will be placed)
  - **Style:** Modern, sleek, slightly futuristic with a touch of realism

#### Optional Separate Panels (if not using single background)
- [ ] **`deck-panel-bg.svg`** - Individual deck section background (reusable for A/B)
- [ ] **`mixer-center-bg.svg`** - Center mixer console background

### 🎛️ Interactive Control Elements

#### Deck Transport Buttons (per deck × 2)
- [ ] **`play-icon.svg`**
  - Rounded triangle pointing right
  - Slightly glowing neon green accent (`#00ff9f`)
  - Subtle outer glow for "powered on" feel
  - Style: Modern, clean, slightly animated feel

- [ ] **`pause-icon.svg`**
  - Two vertical rounded bars
  - Cool blue/white color (`#60a5fa`)
  - Subtle glow effect

- [ ] **`cue-icon.svg`**
  - Circular marker with crosshair or target icon
  - Orange accent color (`#ff6b35`)
  - Pulsing glow effect (designed to suggest animation)

- [ ] **`sync-icon.svg`** (optional)
  - Circular arrows or waveform sync symbol
  - Purple/magenta accent (`#a855f7`)
  - Modern, tech-inspired design

#### Jog Wheel Graphics
- [ ] **`jog-wheel-disc.svg`**
  - Large circular disc (300-400px diameter)
  - Vinyl record aesthetic with grooves OR segmented modern design
  - Center label area (like a record label)
  - Subtle radial gradient for depth
  - Hash marks or segments around edge for tactile feel
  - Optional: motion blur effect on outer edge for "spinning" suggestion
  - **Style:** Hybrid vinyl/modern tech aesthetic

- [ ] **`jog-wheel-center-cap.svg`** (optional)
  - Metallic center button/cap
  - Subtle 3D depth with highlights and shadows

#### Knobs & Faders
- [ ] **`knob-indicator.svg`**
  - Small glowing line or dot showing rotation position
  - Reusable for all EQ/gain/filter knobs
  - Neon accent color that matches control type
  - Outer glow effect
  - **Style:** Minimal, modern, slightly glowing

- [ ] **`knob-base.svg`** (optional)
  - Circular knob body/bezel
  - Brushed metal or rubberized texture
  - Subtle depth and highlights
  - Could be rendered in CSS instead, but SVG gives more control

- [ ] **`fader-handle.svg`**
  - Vertical fader cap (small rectangular/rounded slider)
  - Metallic finish with highlights
  - Rubberized grip texture on sides
  - Subtle 3D depth
  - **Size:** ~40px wide × 60px tall

- [ ] **`crossfader-handle.svg`**
  - Horizontal crossfader cap (wider than vertical fader)
  - Aggressive styling - this is the main performance control
  - Metallic + rubberized grip
  - Center detent indicator (small notch or line)
  - **Size:** ~80px wide × 40px tall

#### LED Indicators
- [ ] **`led-indicator.svg`**
  - Circular LED with outer glow
  - Multiple color variants: red, green, blue, orange
  - Designed to look "lit up"
  - Subtle radial gradient from bright center to darker edge
  - Outer glow/bloom effect

### 🎨 Decorative & Branding (Optional)
- [ ] **`corner-accent.svg`** - Decorative corner elements with tech aesthetic
- [ ] **`panel-screws.svg`** - Realistic screw heads for panel corners
- [ ] **`vent-grille.svg`** - Side vent details (if realistic design)
- [ ] **`logo.svg`** - App branding/wordmark

---

## 📁 Directory Structure

```
apps/web/
├── public/
│   └── assets/
│       └── dj-controls/                    # Static SVGs served directly
│           ├── backgrounds/                # Large panel backgrounds
│           │   ├── mixer-panel-background.svg
│           │   ├── deck-panel-bg.svg       (optional)
│           │   └── mixer-center-bg.svg     (optional)
│           ├── buttons/                    # Transport button icons
│           │   ├── play-icon.svg
│           │   ├── pause-icon.svg
│           │   ├── cue-icon.svg
│           │   └── sync-icon.svg
│           ├── wheels/                     # Jog wheel graphics
│           │   ├── jog-wheel-disc.svg
│           │   └── jog-wheel-center-cap.svg
│           ├── knobs/                      # Knob elements
│           │   ├── knob-indicator.svg
│           │   └── knob-base.svg           (optional)
│           ├── faders/                     # Fader handles
│           │   ├── fader-handle.svg
│           │   └── crossfader-handle.svg
│           ├── indicators/                 # LED indicators
│           │   └── led-indicator.svg
│           └── decorative/                 # Optional accents
│               ├── corner-accent.svg
│               ├── panel-screws.svg
│               └── logo.svg
└── src/
    ├── components/
    │   ├── DJBoard.tsx                     # Main board with SVG background
    │   └── controls/                       # Interactive HTML controls
    │       ├── Knob.tsx
    │       ├── Fader.tsx
    │       ├── Crossfader.tsx
    │       ├── JogWheel.tsx
    │       └── TransportButtons.tsx
    └── assets/
        └── icons/                          # Small SVGs as React components
            ├── PlayIcon.tsx
            └── PauseIcon.tsx
```

---

## 🎨 Visual Style & Design Guidelines

### Overall Aesthetic
**"Slightly Animated Feel"** - Design elements should suggest motion and energy:
- Subtle glows and bloom effects
- Motion blur hints on circular elements
- Gradients that suggest depth and lighting
- Sharp, clean lines with soft accents
- Modern/futuristic but still familiar (like high-end DJ gear)

**Style Mix:**
- 70% Modern/Futuristic (clean lines, neon accents, tech aesthetic)
- 30% Skeuomorphic (realistic textures, depth, tactile feel)

### Color Palette

#### Base Colors (Panel Backgrounds)
- **Dark Foundation:** `#0a0a0a` to `#1a1a1a` (deep black to charcoal)
- **Panel Sections:** `#1f1f1f` to `#2a2a2a` (subtle gradient)
- **Separators/Borders:** `#404040` to `#4a4a4a` (medium gray)
- **Highlights:** `#606060` (brushed metal highlights)

#### Accent Colors (Controls & Indicators)
- **Play/Active:** `#00ff9f` (neon green/cyan) - energetic, "go"
- **Cue/Warning:** `#ff6b35` (vibrant orange) - attention grabbing
- **Pause/Info:** `#60a5fa` (cool blue) - calm, informational
- **Sync/Special:** `#a855f7` (purple/magenta) - creative, tech
- **Error/Stop:** `#ef4444` (red) - stop, error state

#### Text & Labels
- **Primary Text:** `#f0f0f0` (off-white, high contrast)
- **Secondary Labels:** `#9ca3af` (gray-400, silk-screen style)
- **Inactive/Dim:** `#6b7280` (gray-500)

### Material Textures (for SVG backgrounds)

#### Brushed Aluminum
- Subtle horizontal lines (very fine)
- Linear gradient from `#3a3a3a` to `#2a2a2a`
- Highlights along top edge (`#505050`)
- Shadows along bottom edge (`#1a1a1a`)

#### Matte Black Finish
- Flat black base (`#1a1a1a`)
- Very subtle noise/grain texture
- Minimal highlights (only on edges)
- Soft, diffused shadows

#### Rubberized Grip (for fader handles)
- Darker than main panel (`#0f0f0f`)
- Subtle diagonal cross-hatch pattern
- Slightly textured appearance
- Matte finish (no glossy highlights)

#### Metallic Chrome (for accents)
- High contrast gradient (`#808080` to `#d0d0d0`)
- Sharp highlight streak
- Mirror-like reflections (subtle)

### Glow & Light Effects

#### Neon Glow (for active controls)
```
Outer glow:
- Blur radius: 8-12px
- Color: Match accent color at 60% opacity
- Spread: 2-4px

Inner glow:
- Blur radius: 4-6px
- Color: White (#ffffff) at 30% opacity
- Suggests "powered on" LED look
```

#### Subtle Ambient Glow (for panels)
```
Very soft edge lighting:
- Top edge: White (#ffffff) at 5% opacity
- Bottom edge: Black (#000000) at 20% opacity (shadow)
- Simulates overhead lighting
```

#### LED Indicators
```
Center: Bright color at 100% opacity
Middle: Same color at 70% opacity (radial gradient)
Edge: Same color at 20% opacity
Outer glow: Same color at 40% opacity, 10px blur
```

### Depth & Shadows

#### Panel Depth (3D effect)
```
Recessed panels (deck sections):
- Inner shadow: 0 2px 8px rgba(0,0,0,0.6)
- Top highlight: 1px solid rgba(255,255,255,0.03)

Raised elements (controls):
- Drop shadow: 0 2px 4px rgba(0,0,0,0.5)
- Top highlight: Subtle gradient from light to dark
```

#### Control Shadows (faders, knobs)
```
Fader handle:
- Drop shadow: 0 4px 8px rgba(0,0,0,0.7)
- Bottom edge: 1px darker color for depth

Knob base:
- Inner shadow: 0 2px 4px rgba(0,0,0,0.5) (recessed look)
- Outer highlight ring: 1px rgba(255,255,255,0.1)
```

### Animation Feel (Static SVGs with Motion Suggestion)

#### Spinning Elements (Jog Wheel)
- Radial motion blur on outer edge (3-5% opacity streaks)
- Slight asymmetric gradient suggesting rotation
- Highlight streak suggesting light reflection during spin

#### Glowing Elements (LEDs, Active Buttons)
- Multiple concentric glow rings (3 layers)
- Brightest in center, fading outward
- Slight color shift from white (center) to accent color (outer)

#### Tactile Elements (Buttons, Handles)
- Subtle bevel edges (1-2px highlights/shadows)
- Finger-grip textures (fine cross-hatch or dots)
- Visual "weight" - slightly heavier appearance on bottom

### Typography (for SVG labels)

#### Panel Labels (Silk-screen style)
- **Font:** Sans-serif, bold, uppercase
- **Color:** `#6b7280` (gray, low contrast)
- **Size:** 10-12px
- **Letter spacing:** +0.1em (slightly expanded)
- **Examples:** "DECK A", "MIXER", "HIGH", "MID", "LOW"

#### Control Values (if shown)
- **Font:** Monospace or tech-style sans
- **Color:** `#f0f0f0` (white) or accent color if active
- **Size:** 14-16px
- **Examples:** "120 BPM", "+3 dB", "0:42"

### Performance Requirements
- SVG file size: Keep each asset under 50KB (optimize with SVGOMG)
- Use gradients instead of raster effects when possible
- Limit blur effects (they increase file size)
- All interactions must render at 60fps
- Use CSS `transform` and `opacity` for animations (GPU-accelerated)

---

## 💻 Implementation Patterns

### Main DJ Board (Hybrid Approach)
```tsx
// DJBoard.tsx - SVG background + HTML controls on top
export default function DJBoard() {
  return (
    <div className="dj-board-container">

      {/* SVG Background Panel - The "Big Box" */}
      <img
        src="/assets/dj-controls/backgrounds/mixer-panel-background.svg"
        className="board-background"
        alt=""
      />

      {/* Interactive Controls Layer - Positioned on top */}
      <div className="controls-layer">

        {/* Deck A Section */}
        <section className="deck-a-controls">
          <JogWheel
            deck="A"
            style={{ position: 'absolute', top: '80px', left: '120px' }}
          />
          <TransportButtons
            deck="A"
            style={{ position: 'absolute', top: '340px', left: '100px' }}
          />
        </section>

        {/* Mixer Section */}
        <section className="mixer-controls">
          <Knob
            id="eq-high-a"
            style={{ position: 'absolute', top: '120px', left: '480px' }}
          />
          <Fader
            id="channel-a"
            style={{ position: 'absolute', top: '250px', left: '475px' }}
          />
          <Crossfader
            style={{ position: 'absolute', bottom: '60px', left: '50%' }}
          />
        </section>

        {/* Deck B Section */}
        <section className="deck-b-controls">
          <JogWheel
            deck="B"
            style={{ position: 'absolute', top: '80px', right: '120px' }}
          />
        </section>

      </div>
    </div>
  );
}
```

### CSS for Hybrid Layout
```css
.dj-board-container {
  position: relative;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

.board-background {
  width: 100%;
  height: auto;
  display: block;
  pointer-events: none; /* Clicks pass through to controls */
  user-select: none;
}

.controls-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* Allow children to receive events */
}

.controls-layer > * {
  pointer-events: auto; /* Re-enable events for controls */
}
```

### Knob Component
```tsx
// Uses SVG indicator + CSS rotation
export function Knob({ value, onChange, label, style }) {
  return (
    <div className="knob-container" style={style}>
      <div
        className="knob-body"
        style={{ transform: `rotate(${value * 270 - 135}deg)` }}
      >
        <img
          src="/assets/dj-controls/knobs/knob-indicator.svg"
          className="knob-indicator"
          alt=""
        />
      </div>
      <span className="knob-label">{label}</span>
    </div>
  );
}
```

### Fader Component
```tsx
// HTML range input + SVG handle positioned on top
export function Fader({ value, onChange, style }) {
  return (
    <div className="fader-container" style={style}>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="fader-track"
      />
      <img
        src="/assets/dj-controls/faders/fader-handle.svg"
        className="fader-handle"
        style={{ bottom: `${value * 100}%` }}
        alt=""
      />
    </div>
  );
}
```

### Jog Wheel Component
```tsx
// Rotating SVG disc
export function JogWheel({ deck, rotation = 0, style }) {
  return (
    <div className="jog-wheel-container" style={style}>
      <img
        src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
        className="jog-wheel-disc"
        style={{ transform: `rotate(${rotation}deg)` }}
        alt={`Deck ${deck} jog wheel`}
      />
    </div>
  );
}
```

---

## 🤖 AI Image Generation Prompts (for ChatGPT/DALL-E/Midjourney)

Use these detailed prompts to generate SVG assets. Generate as PNG first, then convert to SVG in Figma/Illustrator.

### Main Mixer Panel Background
```
Create a top-down view of a professional DJ mixer panel, 1400px wide.
Three sections: left deck, center mixer, right deck. Dark brushed aluminum
finish (#2a2a2a) with subtle panel separators. Modern/futuristic aesthetic
with slight skeuomorphic details. Include: corner screws, subtle vent grilles,
silk-screen labels ("DECK A", "MIXER", "DECK B" in gray), recessed circular
spots for LED indicators, subtle geometric patterns. Overhead lighting creating
soft highlights on top edges and shadows on bottom. Clean, professional,
high-end DJ equipment aesthetic. Slightly animated feel with neon accent hints.
```

### Jog Wheel Disc
```
Circular DJ jog wheel disc, 400px diameter, viewed from above. Hybrid of vinyl
record aesthetic and modern tech design. Outer edge with radial hash marks
(like a tachometer). Center label area with subtle geometric pattern. Dark
brushed surface (#1a1a1a) with subtle grooves suggesting vinyl texture.
Slight motion blur effect on outer edge (radial streaks) suggesting rotation.
Metallic highlights catching light. Professional, tactile, slightly futuristic.
Neon green accent hints (#00ff9f) on edge markers.
```

### Play Button Icon
```
Rounded triangle play button icon, 48px, modern minimalist design. Neon green
(#00ff9f) color with outer glow effect. Clean geometric shape with slightly
rounded corners. Subtle inner glow (white at 30% opacity) suggesting LED backlight.
Outer bloom/glow extending 8-10px. Slightly animated feel - energetic and inviting.
Transparent background. Vector-ready design.
```

### Pause Button Icon
```
Two vertical rounded bars (pause symbol), 48px, modern design. Cool blue color
(#60a5fa) with subtle glow. Bars have rounded ends. Slight outer glow (6-8px blur).
Inner highlight suggesting illuminated button. Clean, minimal, tech aesthetic.
Transparent background.
```

### Cue Button Icon
```
Circular target/crosshair icon, 48px. Vibrant orange (#ff6b35) with pulsing
glow effect. Concentric circles with center crosshair. Outer glow (10px blur)
suggesting urgency/attention. Slightly animated feel - like it's calling for
interaction. Modern, clean lines. Transparent background.
```

### Sync Button Icon
```
Circular arrows or waveform sync symbol, 48px. Purple/magenta (#a855f7) with
glow effect. Modern tech-inspired design suggesting synchronization. Outer glow
(8px blur). Clean geometric shapes. Slightly animated feel. Transparent background.
```

### Fader Handle (Vertical)
```
Rectangular DJ fader handle, 40px wide × 60px tall, front view. Metallic chrome
center with rubberized black grip on sides. Subtle cross-hatch texture on grip
areas. Bevel edges with highlights (top edge bright, bottom edge shadowed).
3D appearance with drop shadow. Professional, tactile, weighted appearance.
Brushed metal finish on center stripe. Small horizontal grip lines. Realistic
but clean/modern aesthetic.
```

### Crossfader Handle (Horizontal)
```
Wide horizontal crossfader handle, 80px wide × 40px tall, front view. Aggressive
professional design - this is the performance control. Metallic body with
rubberized sides. Center detent indicator (small notch line). Beveled edges,
drop shadow for depth. Brushed aluminum center with matte black grip zones.
Substantial, weighted appearance. Subtle texture details. High-end DJ equipment
aesthetic.
```

### Knob Indicator
```
Small glowing line indicator for DJ knob rotation, minimal design. Thin line
or dot, 8px × 30px, neon cyan color (#00ff9f) with outer glow (8px blur).
Suggests LED indicator showing knob position. Bright center fading to transparent
edges. Simple, clean, futuristic. Transparent background.
```

### LED Indicator (Multiple Colors)
```
Circular LED indicator, 16px diameter, glowing appearance. Create 4 versions:
green (#00ff9f), orange (#ff6b35), blue (#60a5fa), red (#ef4444). Radial
gradient from bright white center to color edge. Multiple concentric glow rings
(3 layers) creating bloom effect. Outer glow 10px blur. Looks "powered on" and
illuminated. Slight color shift from white core to neon edge. Transparent background.
```

---

## 🛠️ Tools for Creating/Converting SVGs

### Design Tools
1. **Figma** (recommended) - Design in Figma, export as SVG
   - Free tier available
   - Best for web SVG export
   - Easy to optimize for code

2. **Adobe Illustrator** - Professional vector editing
   - Industry standard
   - Excellent SVG export options
   - Advanced gradient controls

3. **Inkscape** (free) - Open-source alternative
   - Completely free
   - Powerful vector tools
   - Good SVG native support

### AI Image to SVG Workflow
1. **Generate in ChatGPT/DALL-E/Midjourney** using prompts above (creates PNG/JPG)
2. **Import to Figma or Illustrator**
3. **Trace/vectorize** the raster image:
   - Illustrator: Use "Image Trace" feature → Expand → Clean up
   - Figma: Use trace plugin or manually recreate with vector shapes
4. **Clean up** paths, simplify anchor points, adjust colors
5. **Export as optimized SVG** with proper viewBox

### SVG Optimization Tools
1. **SVGOMG** (https://jakearchibald.github.io/svgomg/)
   - Web-based SVG optimizer
   - Remove unnecessary data
   - Reduce file size 30-70%
   - Drag and drop interface

2. **SVGO** (command line)
   ```bash
   npm install -g svgo
   svgo input.svg -o output.svg
   ```

---

## ✅ Asset Checklist & Quality Requirements

### Before Committing SVGs:
- [ ] Remove unnecessary metadata (generator info, comments)
- [ ] Simplify paths where possible (fewer anchor points)
- [ ] Use `viewBox` instead of fixed `width`/`height` attributes
- [ ] Ensure transparent backgrounds (no white rectangles)
- [ ] Optimize with SVGOMG
- [ ] Test at different sizes (should look crisp at 0.5× and 2×)
- [ ] Validate colors match the design palette
- [ ] Check file size targets:
  - Small icons (buttons, indicators): < 5KB each
  - Medium graphics (knobs, faders): < 15KB each
  - Large backgrounds: < 150KB each
- [ ] Semantic file naming (lowercase, hyphens, descriptive)
- [ ] Test in browser (import and view actual size)

### SVG Code Requirements:
```xml
<!-- ✅ Good SVG structure -->
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <title>Play Button</title>
  <!-- Paths and shapes here -->
</svg>

<!-- ❌ Bad: Fixed dimensions, no viewBox -->
<svg width="48px" height="48px">
  <!-- ... -->
</svg>
```

---

Use a single unified palette and fixed theme (no theming for v1) so the board feels like one physical device, not a customizable dashboard. The aesthetic should be dark, premium, hardware-like: matte black + brushed aluminum base with neon accents. Base surfaces: #0f0f10, #1a1a1a, #242424; separators: #3a3a3a; highlights: #5a5a5a; text: #f0f0f0 primary, #9ca3af secondary. Accent system is functional and consistent: Play/active = #00ff9f neon cyan, Cue = #ff6b35 orange, Pause/info = #60a5fa blue, Sync/special = #a855f7 purple, Error = #ef4444 red. Yes to subtle animated button states (soft glow intensifies on hover, quick press depression + 120ms brightness pop on active) to add life without looking gamey. Jog wheels should use a hybrid vinyl texture (light grooves + radial hash marks) for tactile realism, not flat minimal, because the wheel is the hero interaction. Use soft drop shadows and inner shadows on all controls (2–8px, low opacity) to create depth and a slightly skeuomorphic “real hardware” feel—flat looks cheap here. Overall vibe: 70% modern tech, 30% physical realism, cohesive, dark, and high-end like a $500 controller.



---

## Reference Examples

Real DJ controllers for inspiration:
- Pioneer DDJ-400 (beginner-friendly, clean layout)
- Traktor Kontrol S2 (colorful, modern)
- Serato DJ Pro software UI (software example)

Web DJ apps:
- Rekordbox Web (Pioneer)
- Virtual DJ Web version

Here’s the **“Artifacts to Generate (Nano Banana)”** section you can paste at the **end of the doc**.

---

## ✅ Artifacts to Generate (Nano Banana) — Final Checklist (1–X)

### 1) Backgrounds (Large Panels)

1. **`mixer-panel-background.svg`**
2. **`deck-panel-bg.svg`** *(optional — if not using single unified background)*
3. **`mixer-center-bg.svg`** *(optional — if not using single unified background)*

### 2) Transport / Deck Buttons (Icons)

4. **`play-icon.svg`**
5. **`pause-icon.svg`**
6. **`cue-icon.svg`**
7. **`sync-icon.svg`** *(optional)*

### 3) Jog Wheel Graphics

8. **`jog-wheel-disc.svg`**
9. **`jog-wheel-center-cap.svg`** *(optional)*

### 4) Knobs & Faders

10. **`knob-indicator.svg`**
11. **`knob-base.svg`** *(optional)*
12. **`fader-handle.svg`**
13. **`crossfader-handle.svg`**

### 5) Indicators

14. **`led-indicator-green.svg`**
15. **`led-indicator-orange.svg`**
16. **`led-indicator-blue.svg`**
17. **`led-indicator-red.svg`**

### 6) Decorative / Branding (Optional)

18. **`corner-accent.svg`** *(optional)*
19. **`panel-screws.svg`** *(optional)*
20. **`vent-grille.svg`** *(optional)*
21. **`logo.svg`** *(optional)*

