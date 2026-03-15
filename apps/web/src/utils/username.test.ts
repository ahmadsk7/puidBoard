// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getUsername, setUsername } from "./username";

describe("username persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("generates and stores a name on first call", () => {
    const name = getUsername();
    expect(name.length).toBeGreaterThan(0);
    expect(localStorage.getItem("puid-username")).toBe(name);
  });

  it("returns the same name on subsequent calls", () => {
    const first = getUsername();
    const second = getUsername();
    expect(second).toBe(first);
  });

  it("setUsername updates localStorage", () => {
    setUsername("CoolDJ42");
    expect(getUsername()).toBe("CoolDJ42");
    expect(localStorage.getItem("puid-username")).toBe("CoolDJ42");
  });

  it("setUsername with empty string regenerates a name", () => {
    setUsername("");
    const name = getUsername();
    expect(name.length).toBeGreaterThan(0);
  });
});
