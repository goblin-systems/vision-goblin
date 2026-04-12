import { describe, expect, it } from "vitest";
import {
  blendChannel,
  clamp01,
  interpolateChannel,
  normalizeHexColour,
  parseHexColour,
  rgbaToHex,
} from "./colorUtils";

describe("clamp01", () => {
  it("returns 0 for values below 0", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(-100)).toBe(0);
  });

  it("returns 1 for values above 1", () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(100)).toBe(1);
  });

  it("returns the value unchanged when within 0–1", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });
});

describe("normalizeHexColour", () => {
  it("returns the colour unchanged when it starts with #", () => {
    expect(normalizeHexColour("#FF0000")).toBe("#FF0000");
  });

  it("adds a # prefix when missing", () => {
    expect(normalizeHexColour("FF0000")).toBe("#FF0000");
  });

  it("trims whitespace before normalizing", () => {
    expect(normalizeHexColour("  #AA00BB  ")).toBe("#AA00BB");
    expect(normalizeHexColour("  AA00BB  ")).toBe("#AA00BB");
  });
});

describe("parseHexColour", () => {
  it("parses a 3-char hex colour", () => {
    expect(parseHexColour("#F0A")).toEqual({ r: 255, g: 0, b: 170, a: 255 });
  });

  it("parses a 6-char hex colour", () => {
    expect(parseHexColour("#FF8800")).toEqual({ r: 255, g: 136, b: 0, a: 255 });
  });

  it("parses an 8-char hex colour with alpha", () => {
    expect(parseHexColour("#FF880080")).toEqual({ r: 255, g: 136, b: 0, a: 128 });
  });

  it("returns null for invalid hex", () => {
    expect(parseHexColour("nothex")).toBeNull();
    expect(parseHexColour("#GG0000")).toBeNull();
    expect(parseHexColour("#12")).toBeNull();
    expect(parseHexColour("")).toBeNull();
  });

  it("handles input without # prefix", () => {
    expect(parseHexColour("FF0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColour("ABC")).toEqual({ r: 170, g: 187, b: 204, a: 255 });
  });
});

describe("blendChannel", () => {
  it("returns the source value when fully opaque", () => {
    expect(blendChannel(200, 100, 1, 1, 1)).toBe(200);
  });

  it("leaves the destination unchanged when source is transparent", () => {
    expect(blendChannel(200, 100, 0, 1, 1)).toBe(100);
  });

  it("returns 0 when outAlpha is zero", () => {
    expect(blendChannel(200, 100, 0.5, 0.5, 0)).toBe(0);
  });

  it("blends channels proportionally for partial alpha", () => {
    const result = blendChannel(255, 0, 0.5, 1, 0.5 + 1 * 0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(255);
  });
});

describe("rgbaToHex", () => {
  it("converts an Rgba to a hex string", () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 170, a: 255 })).toBe("#FF00AA");
  });

  it("pads single-digit hex values with a leading zero", () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 255 })).toBe("#000000");
    expect(rgbaToHex({ r: 1, g: 2, b: 3, a: 255 })).toBe("#010203");
  });

  it("returns uppercase hex", () => {
    expect(rgbaToHex({ r: 171, g: 205, b: 239, a: 255 })).toBe("#ABCDEF");
  });
});

describe("interpolateChannel", () => {
  it("returns the start value at t=0", () => {
    expect(interpolateChannel(100, 200, 0)).toBe(100);
  });

  it("returns the end value at t=1", () => {
    expect(interpolateChannel(100, 200, 1)).toBe(200);
  });

  it("returns the midpoint at t=0.5", () => {
    expect(interpolateChannel(100, 200, 0.5)).toBe(150);
  });
});
