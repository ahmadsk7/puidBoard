import { describe, it, expect } from "vitest";
import { VERSION } from "@puid-board/shared";

describe("web app", () => {
  it("imports shared package", () => {
    expect(VERSION).toBe("0.0.1");
  });
});
