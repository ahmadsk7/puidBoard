"use client";

import type { Member, ControlOwnership } from "@puid-board/shared";

export type CursorsLayerProps = {
  /** All members in the room */
  members: Member[];
  /** Current client's ID (to exclude from rendering) */
  currentClientId: string | null;
  /** Width of the container for cursor positioning */
  containerWidth?: number;
  /** Height of the container for cursor positioning */
  containerHeight?: number;
};

/**
 * Render multiplayer cursors for all members except the current user.
 * Cursors show name + color indicator.
 */
export default function CursorsLayer({
  members,
  currentClientId,
  containerWidth = 0,
  containerHeight = 0,
}: CursorsLayerProps) {
  // Filter to other members with active cursors
  const otherCursors = members.filter(
    (m) => m.clientId !== currentClientId && m.cursor !== null
  );

  if (containerWidth === 0 || containerHeight === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {otherCursors.map((member) => {
        if (!member.cursor) return null;
        const x = member.cursor.x * containerWidth;
        const y = member.cursor.y * containerHeight;
        return (
          <div
            key={member.clientId}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            {/* Cursor dot */}
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: member.color,
                border: "2px solid white",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }}
            />
            {/* Name label */}
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                color: "white",
                background: member.color,
                padding: "1px 4px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                maxWidth: 80,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {member.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type GrabGlowProps = {
  /** Control ownership map */
  controlOwners: Record<string, ControlOwnership>;
  /** Map of clientId to color */
  memberColors: Record<string, string>;
  /** Current client's ID (to style differently) */
  currentClientId: string | null;
};

/**
 * Get the glow style for a control based on ownership.
 * Returns CSS box-shadow for the owner's color, or null if not grabbed.
 */
export function getGrabGlowStyle(
  controlId: string,
  controlOwners: Record<string, ControlOwnership>,
  memberColors: Record<string, string>,
  currentClientId: string | null
): React.CSSProperties | null {
  const ownership = controlOwners[controlId];
  if (!ownership) return null;

  const color = memberColors[ownership.clientId];
  if (!color) return null;

  // Different style if it's the current user vs another user
  const isOwnGrab = ownership.clientId === currentClientId;
  const glowColor = isOwnGrab ? color : color;
  const glowSize = isOwnGrab ? "0 0 8px 2px" : "0 0 12px 4px";

  return {
    boxShadow: `${glowSize} ${glowColor}`,
    transition: "box-shadow 0.15s ease",
  };
}

/**
 * Build a map of clientId -> color from members array.
 */
export function buildMemberColorMap(members: Member[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) {
    map[m.clientId] = m.color;
  }
  return map;
}
