"use client";

import { memo, useState, useCallback } from "react";

export type SamplerButtonProps = {
  keybind: string;
  color: string;
  onClick: () => void;
  size?: number;
  /** External pressed state (e.g., from keyboard trigger) */
  externalPressed?: boolean;
  /** Optional SVG icon URL to display in top-right corner */
  icon?: string | null;
};

/**
 * Sampler pad button based on performance-pad-template-char-icon.svg design.
 * Displays keybind character and responds to clicks/touches.
 */
const SamplerButton = memo(function SamplerButton({
  keybind,
  color,
  onClick,
  size = 60,
  externalPressed = false,
  icon = null,
}: SamplerButtonProps) {
  const [internalPressed, setInternalPressed] = useState(false);

  // Combine internal (mouse/touch) and external (keyboard) pressed states
  const isPressed = externalPressed || internalPressed;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setInternalPressed(true);
    onClick();
  }, [onClick]);

  const handlePointerUp = useCallback(() => {
    setInternalPressed(false);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setInternalPressed(false);
  }, []);

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
        aria-label={`Sampler pad ${keybind}`}
        style={{ color, width: "100%", height: "100%" }}
      >
        <defs>
          {/* Body gradients (rubber/plastic) */}
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

          {/* Soft highlight sweep */}
          <linearGradient id={`gSheen-${keybind}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          {/* Rubber micro-texture */}
          <filter id={`fTexture-${keybind}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={8} result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0.10 0"
              result="a"
            />
            <feComposite in="a" in2="SourceGraphic" operator="over" />
          </filter>

          {/* Under-shadow for the whole pad */}
          <filter id={`fDrop-${keybind}`} x="-25%" y="-25%" width="150%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.65" />
          </filter>

          {/* Inner concave shadow */}
          <filter id={`fInner-${keybind}`} x="-30%" y="-30%" width="160%" height="160%">
            <feOffset dx="0" dy="2" in="SourceAlpha" result="off" />
            <feGaussianBlur in="off" stdDeviation="3" result="blur" />
            <feComposite in="blur" in2="SourceAlpha" operator="out" result="innerShadow" />
            <feColorMatrix
              in="innerShadow"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0.55 0"
              result="innerShadowAlpha"
            />
            <feComposite in="innerShadowAlpha" in2="SourceGraphic" operator="over" />
          </filter>

          {/* LED bloom (embedded, not neon) */}
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

        {/* Subtle bevel ring (tactile edge) */}
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

        {/* Etched key character (3-layer effect) */}
        <g transform="translate(40 40)" aria-hidden="true" pointerEvents="none">
          {/* Highlight layer */}
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
          {/* Shadow layer */}
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
          {/* Face layer */}
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#f0f0f0"
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

        {/* LED border (two-layer: bloom + crisp) */}
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

        {/* Tiny top-edge catch light (real hardware feel) */}
        <path
          d="M14 18c2-4 8-7 13-7h26c6 0 12 3 14 7"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.05"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Bottom occlusion shadow to imply thickness */}
        <path
          d="M12 60c10 8 46 8 56 0"
          fill="none"
          stroke="#000000"
          strokeOpacity="0.35"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>

      {/* Optional icon in top-right corner */}
      {icon && (
        <img
          src={icon}
          alt=""
          style={{
            position: "absolute",
            top: "8%",
            right: "8%",
            width: "28%",
            height: "28%",
            opacity: isPressed ? 0.9 : 0.75,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
            pointerEvents: "none",
            transition: "opacity 0.05s",
          }}
        />
      )}
    </div>
  );
});

export default SamplerButton;
