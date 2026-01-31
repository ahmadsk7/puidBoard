import { describe, it, expect } from "vitest";
import { VERSION, THROTTLE } from "./index";

describe("shared package", () => {
  it("exports VERSION", () => {
    expect(VERSION).toBe("0.0.1");
  });

  it("exports THROTTLE constants", () => {
    expect(THROTTLE.CURSOR_MS).toBe(33);
    expect(THROTTLE.CONTROL_MS).toBe(16);
    expect(THROTTLE.SYNC_TICK_MS).toBe(2000);
  });
});
