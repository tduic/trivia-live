import { describe, it, expect } from "vitest";
import { clamp, randomCode, randomSecret, safeTrim } from "@/lib/util";

describe("randomCode", () => {
  it("uses only unambiguous room-code characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
    expect(randomCode(10)).toHaveLength(10);
  });
});

describe("randomSecret", () => {
  it("is URL-safe and the requested length", () => {
    const s = randomSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomSecret(8)).toHaveLength(8);
    expect(randomSecret()).not.toBe(randomSecret());
  });
});

describe("clamp", () => {
  it("bounds values on both sides", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("safeTrim", () => {
  it("trims whitespace and caps the length", () => {
    expect(safeTrim("  hi  ")).toBe("hi");
    expect(safeTrim("abcdef", 3)).toBe("abc");
    expect(safeTrim(undefined as unknown as string)).toBe("");
  });
});
