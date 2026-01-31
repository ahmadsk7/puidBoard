import React from "react";
import type { FxType } from "@puid-board/shared";

export type FXDisplayProps = {
  fxType: FxType;
  enabled: boolean;
  wetDry: number;
  paramInfo: { label: string; displayValue: string; unit: string } | null;
};

/**
 * FX LCD Display - shows FX status and parameters in modern LCD style
 */
export function FXDisplay({
  fxType,
  enabled,
  wetDry,
  paramInfo,
}: FXDisplayProps) {
  const isActive = fxType !== "none" && enabled;

  // Format FX type label
  const fxLabel = fxType === "none" ? "OFF" : fxType.toUpperCase();

  // LED color based on state
  const ledColor = isActive ? "#22c55e" : "#ef4444";

  return (
    <div
      style={{
        background: "#050508",
        border: "2px solid #1a1a1a",
        borderRadius: "8px",
        boxShadow: `
          inset 0 2px 4px rgba(0, 0, 0, 0.6),
          0 4px 12px rgba(0, 0, 0, 0.5),
          inset 0 0 20px ${isActive ? "#3b82f6" : "#000000"}15
        `,
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: "140px",
      }}
    >
      {/* Header row with FX label and status LED */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "#9ca3af",
          }}
        >
          FX
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              fontFamily: "monospace",
              color: isActive ? "#60a5fa" : "#6b7280",
            }}
          >
            {fxLabel}
          </div>
          {/* Status LED */}
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: ledColor,
              boxShadow: `0 0 6px ${ledColor}`,
            }}
          />
        </div>
      </div>

      {/* FX Type Display */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: "4px",
          padding: "4px 8px",
          textAlign: "center",
          border: isActive ? `1px solid #3b82f6` : "1px solid #242424",
        }}
      >
        <div
          style={{
            fontSize: "14px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: isActive ? "#3b82f6" : "#6b7280",
            letterSpacing: "0.05em",
          }}
        >
          {enabled ? fxLabel : "BYPASS"}
        </div>
      </div>

      {/* Parameters - only show when FX is not "none" */}
      {fxType !== "none" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {/* Wet/Dry parameter */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: "9px",
                fontWeight: 600,
                color: "#9ca3af",
                letterSpacing: "0.05em",
              }}
            >
              WET
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                fontFamily: "monospace",
                color: isActive ? "#60a5fa" : "#6b7280",
              }}
            >
              {Math.round(wetDry * 100)}%
            </div>
          </div>

          {/* Custom parameter */}
          {paramInfo && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  color: "#9ca3af",
                  letterSpacing: "0.05em",
                }}
              >
                {paramInfo.label}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: isActive ? "#60a5fa" : "#6b7280",
                }}
              >
                {paramInfo.displayValue}{paramInfo.unit}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
