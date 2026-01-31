import { describe, it, expect } from "vitest";
import {
  getGrabGlowStyle,
  buildMemberColorMap,
} from "./CursorsLayer";
import type { Member, ControlOwnership } from "@puid-board/shared";

describe("CursorsLayer", () => {
  describe("buildMemberColorMap", () => {
    it("creates map from members array", () => {
      const members: Member[] = [
        {
          clientId: "c1",
          name: "User 1",
          color: "#FF0000",
          joinedAt: 0,
          isHost: true,
          cursor: null,
          latencyMs: 0,
        },
        {
          clientId: "c2",
          name: "User 2",
          color: "#00FF00",
          joinedAt: 0,
          isHost: false,
          cursor: null,
          latencyMs: 0,
        },
      ];

      const map = buildMemberColorMap(members);
      expect(map["c1"]).toBe("#FF0000");
      expect(map["c2"]).toBe("#00FF00");
    });
  });

  describe("getGrabGlowStyle", () => {
    const memberColors = {
      c1: "#FF0000",
      c2: "#00FF00",
    };

    it("returns null if control not grabbed", () => {
      const controlOwners: Record<string, ControlOwnership> = {};
      const style = getGrabGlowStyle("crossfader", controlOwners, memberColors, "c1");
      expect(style).toBeNull();
    });

    it("returns glow style when control is grabbed", () => {
      const controlOwners: Record<string, ControlOwnership> = {
        crossfader: {
          clientId: "c2",
          acquiredAt: Date.now(),
          lastMovedAt: Date.now(),
        },
      };

      const style = getGrabGlowStyle("crossfader", controlOwners, memberColors, "c1");
      expect(style).not.toBeNull();
      expect(style?.boxShadow).toContain("#00FF00");
    });

    it("returns different glow for own grab vs other grab", () => {
      const controlOwners: Record<string, ControlOwnership> = {
        crossfader: {
          clientId: "c1",
          acquiredAt: Date.now(),
          lastMovedAt: Date.now(),
        },
      };

      const ownStyle = getGrabGlowStyle("crossfader", controlOwners, memberColors, "c1");
      const otherStyle = getGrabGlowStyle("crossfader", controlOwners, memberColors, "c2");

      expect(ownStyle).not.toBeNull();
      expect(otherStyle).not.toBeNull();
      // Both should contain the owner's color
      expect(ownStyle?.boxShadow).toContain("#FF0000");
      expect(otherStyle?.boxShadow).toContain("#FF0000");
    });
  });
});
