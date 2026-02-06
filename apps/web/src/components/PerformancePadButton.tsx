"use client";

import { memo, useState, useCallback, useRef } from "react";

export type PadFunction = "hotcue" | "loop" | "roll" | "jump";

export type PerformancePadButtonProps = {
  keybind: string;
  padFunction: PadFunction;
  color: string;
  onClick: () => void;
  onHold: () => void;
  onRelease: () => void;
  size?: number;
  /** External pressed state (e.g., from keyboard trigger) */
  externalPressed?: boolean;
};

const HOLD_THRESHOLD_MS = 300;

// Icon paths for each pad function (3-layer highlight/shadow/face structure)
const FUNCTION_ICONS: Record<PadFunction, JSX.Element> = {
  hotcue: (
    <>
      {/* Hot Cue icon - crosshair/target */}
      <g transform="translate(-0.5,-0.5)" opacity="0.06" stroke="#ffffff" fill="none" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2 L8 5" />
        <path d="M8 11 L8 14" />
        <path d="M2 8 L5 8" />
        <path d="M11 8 L14 8" />
      </g>
      <g transform="translate(0.6,0.6)" opacity="0.42" stroke="#000000" fill="none" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2 L8 5" />
        <path d="M8 11 L8 14" />
        <path d="M2 8 L5 8" />
        <path d="M11 8 L14 8" />
      </g>
      <g opacity="0.20" stroke="#9ca3af" fill="none" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2 L8 5" />
        <path d="M8 11 L8 14" />
        <path d="M2 8 L5 8" />
        <path d="M11 8 L14 8" />
      </g>
    </>
  ),
  loop: (
    <>
      {/* Loop icon - circular arrows */}
      <g transform="translate(-0.5,-0.5)" opacity="0.06" stroke="#ffffff" fill="none" strokeWidth="1.6">
        <path d="M12 4 A5 5 0 1 1 4 12" />
        <path d="M11 2 L12 4 L10 5" />
        <path d="M5 14 L4 12 L6 11" />
      </g>
      <g transform="translate(0.6,0.6)" opacity="0.42" stroke="#000000" fill="none" strokeWidth="1.6">
        <path d="M12 4 A5 5 0 1 1 4 12" />
        <path d="M11 2 L12 4 L10 5" />
        <path d="M5 14 L4 12 L6 11" />
      </g>
      <g opacity="0.20" stroke="#9ca3af" fill="none" strokeWidth="1.6">
        <path d="M12 4 A5 5 0 1 1 4 12" />
        <path d="M11 2 L12 4 L10 5" />
        <path d="M5 14 L4 12 L6 11" />
      </g>
    </>
  ),
  roll: (
    <>
      {/* Roll icon - waveform in loop */}
      <g transform="translate(-0.5,-0.5)" opacity="0.06" stroke="#ffffff" fill="none" strokeWidth="1.6">
        <rect x="3" y="5" width="10" height="6" rx="1" />
        <path d="M5 8 L6 6 L7 10 L8 8 L9 8 L10 6 L11 10" />
      </g>
      <g transform="translate(0.6,0.6)" opacity="0.42" stroke="#000000" fill="none" strokeWidth="1.6">
        <rect x="3" y="5" width="10" height="6" rx="1" />
        <path d="M5 8 L6 6 L7 10 L8 8 L9 8 L10 6 L11 10" />
      </g>
      <g opacity="0.20" stroke="#9ca3af" fill="none" strokeWidth="1.6">
        <rect x="3" y="5" width="10" height="6" rx="1" />
        <path d="M5 8 L6 6 L7 10 L8 8 L9 8 L10 6 L11 10" />
      </g>
    </>
  ),
  jump: (
    <>
      {/* Jump icon - bidirectional arrows (left + right) */}
      <g transform="translate(-0.5,-0.5)" opacity="0.06" stroke="#ffffff" fill="none" strokeWidth="1.6">
        <path d="M6 5 L2 8 L6 11 Z" fill="#ffffff" />
        <path d="M10 5 L14 8 L10 11 Z" fill="#ffffff" />
      </g>
      <g transform="translate(0.6,0.6)" opacity="0.42" stroke="#000000" fill="none" strokeWidth="1.6">
        <path d="M6 5 L2 8 L6 11 Z" fill="#000000" />
        <path d="M10 5 L14 8 L10 11 Z" fill="#000000" />
      </g>
      <g opacity="0.20" stroke="#9ca3af" fill="none" strokeWidth="1.6">
        <path d="M6 5 L2 8 L6 11 Z" fill="#9ca3af" />
        <path d="M10 5 L14 8 L10 11 Z" fill="#9ca3af" />
      </g>
    </>
  ),
};

/**
 * Performance pad button for DJ deck control.
 * Based on performance-pad SVG design with mode-specific icons.
 */
const PerformancePadButton = memo(function PerformancePadButton({
  keybind,
  padFunction,
  color,
  onClick,
  onHold,
  onRelease,
  size = 60,
  externalPressed = false,
}: PerformancePadButtonProps) {
  const [internalPressed, setInternalPressed] = useState(false);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoldTriggeredRef = useRef<boolean>(false);

  // Combine internal (mouse/touch) and external (keyboard) pressed states
  const isPressed = externalPressed || internalPressed;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setInternalPressed(true);
    isHoldTriggeredRef.current = false;

    // Set up hold detection
    // Hold will fire after threshold, tap will fire on release if hold didn't trigger
    holdTimerRef.current = setTimeout(() => {
      isHoldTriggeredRef.current = true;
      onHold();
    }, HOLD_THRESHOLD_MS);
  }, [onHold]);

  const handlePointerUp = useCallback(() => {
    setInternalPressed(false);

    // If hold timer is still running, this was a quick tap
    const wasQuickTap = holdTimerRef.current !== null && !isHoldTriggeredRef.current;

    // Clear hold timer
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // Fire onClick only if it was a quick tap (hold didn't trigger)
    if (wasQuickTap) {
      onClick();
    }

    // Call release handler
    onRelease();
  }, [onClick, onRelease]);

  const handlePointerLeave = useCallback(() => {
    if (internalPressed) {
      handlePointerUp();
    }
  }, [internalPressed, handlePointerUp]);

  // LED always visible (like sampler buttons), just brighter when pressed

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerUp}
      style={{
        width: size,
        height: size,
        cursor: "pointer",
        touchAction: "none",
        userSelect: "none",
        transform: isPressed ? "scale(0.95)" : "scale(1)",
        transition: "transform 0.05s",
      }}
    >
      <svg
        viewBox="0 0 80 80"
        xmlns="http://www.w3.org/2000/svg"
        role="button"
        aria-label={`${padFunction} pad ${keybind}`}
        style={{ color, width: "100%", height: "100%" }}
      >
        <defs>
          {/* Body gradients */}
          <linearGradient id={`gBody-${keybind}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#262628" />
            <stop offset="55%" stopColor="#121214" />
            <stop offset="100%" stopColor="#0a0a0b" />
          </linearGradient>

          <radialGradient id={`gTop-${keybind}`} cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#1f1f22" />
            <stop offset="50%" stopColor="#111114" />
            <stop offset="100%" stopColor="#070708" />
          </radialGradient>

          <linearGradient id={`gSheen-${keybind}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <filter id={`fTexture-${keybind}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={8} result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.10 0"
              result="a"
            />
            <feComposite in="a" in2="SourceGraphic" operator="over" />
          </filter>

          <filter id={`fDrop-${keybind}`} x="-25%" y="-25%" width="150%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.65" />
          </filter>

          <filter id={`fInner-${keybind}`} x="-30%" y="-30%" width="160%" height="160%">
            <feOffset dx="0" dy="2" in="SourceAlpha" result="off" />
            <feGaussianBlur in="off" stdDeviation="3" result="blur" />
            <feComposite in="blur" in2="SourceAlpha" operator="out" result="innerShadow" />
            <feColorMatrix
              in="innerShadow"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0"
              result="innerShadowAlpha"
            />
            <feComposite in="innerShadowAlpha" in2="SourceGraphic" operator="over" />
          </filter>

          <filter id={`fLED-${keybind}`} x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="currentColor" floodOpacity={isPressed ? "0.8" : "0.55"} />
            <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="currentColor" floodOpacity={isPressed ? "0.4" : "0.22"} />
          </filter>
        </defs>

        {/* Outer pad body */}
        <g filter={`url(#fDrop-${keybind})`}>
          <rect
            x="6"
            y="6"
            width="68"
            height="68"
            rx="16"
            fill={`url(#gBody-${keybind})`}
            stroke="#2f2f33"
            strokeWidth="1"
          />
        </g>

        {/* Top concave surface */}
        <g filter={`url(#fTexture-${keybind})`}>
          <rect
            x="11"
            y="11"
            width="58"
            height="58"
            rx="14"
            fill={`url(#gTop-${keybind})`}
            filter={`url(#fInner-${keybind})`}
          />
        </g>

        {/* Bevel ring */}
        <rect
          x="9"
          y="9"
          width="62"
          height="62"
          rx="15"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.05"
          strokeWidth="2"
        />

        {/* Highlight sheen */}
        <path
          d="M18 18C32 12 50 12 62 22C68 27 70 34 68 40C54 26 34 24 18 28Z"
          fill={`url(#gSheen-${keybind})`}
          opacity="0.9"
        />

        {/* Keybind character (3-layer etched effect) */}
        <g transform="translate(40 40)" aria-hidden="true" pointerEvents="none">
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            opacity="0.07"
            transform="translate(-0.7,-0.7)"
            style={{
              fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
              fontWeight: 800,
              fontSize: "26px",
              letterSpacing: "0.02em",
            }}
          >
            {keybind}
          </text>
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#000000"
            opacity="0.55"
            transform="translate(0.9,0.9)"
            style={{
              fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
              fontWeight: 800,
              fontSize: "26px",
              letterSpacing: "0.02em",
            }}
          >
            {keybind}
          </text>
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#4b5563"
            opacity="0.22"
            style={{
              fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
              fontWeight: 800,
              fontSize: "26px",
              letterSpacing: "0.02em",
            }}
          >
            {keybind}
          </text>
        </g>

        {/* Function icon */}
        <g
          transform="translate(54 22) scale(0.75) translate(-8 -8)"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          pointerEvents="none"
        >
          {FUNCTION_ICONS[padFunction]}
        </g>

        {/* LED border (always visible) */}
        <g filter={`url(#fLED-${keybind})`}>
          <rect
            x="14.5"
            y="14.5"
            width="51"
            height="51"
            rx="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeOpacity={isPressed ? "0.35" : "0.18"}
          />
          <rect
            x="14.5"
            y="14.5"
            width="51"
            height="51"
            rx="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeOpacity={isPressed ? "1" : "0.85"}
          />
        </g>

        {/* Edge highlight */}
        <path
          d="M14 18c2-4 8-7 13-7h26c6 0 12 3 14 7"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.05"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Bottom shadow */}
        <path
          d="M12 60c10 8 46 8 56 0"
          fill="none"
          stroke="#000000"
          strokeOpacity="0.35"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
});

export default PerformancePadButton;
