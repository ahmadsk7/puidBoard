import React from "react";

export type LCDScreenProps = {
  width: number;
  height: number;
  children: React.ReactNode;
  accentColor?: string;
  style?: React.CSSProperties;
};

/**
 * LCD Screen Container - provides realistic LCD screen styling
 * Mimics professional DJ equipment displays (Pioneer CDJ-3000, Denon SC6000)
 */
export function LCDScreen({
  width,
  height,
  children,
  accentColor = "#3b82f6",
  style,
}: LCDScreenProps) {
  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: "#050508",
        border: "2px solid #1a1a1a",
        borderRadius: "8px",
        boxShadow: `
          inset 0 2px 4px rgba(0, 0, 0, 0.6),
          0 4px 12px rgba(0, 0, 0, 0.5),
          inset 0 0 20px ${accentColor}15
        `,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        overflow: "hidden",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
