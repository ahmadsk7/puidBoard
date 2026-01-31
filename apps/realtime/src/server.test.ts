import { describe, it, expect } from "vitest";
import { VERSION } from "@puid-board/shared";

describe("realtime server", () => {
  it("imports shared package", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
