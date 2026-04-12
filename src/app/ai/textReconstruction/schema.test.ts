import { describe, expect, it } from "vitest";
import { parseStructuredTextReconstructionJson } from "./schema";

describe("structured text reconstruction schema", () => {
  it("parses valid multi-block structured JSON", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [
        {
          id: "one",
          text: "Title",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: {
            alignment: "left",
            fill: { type: "solid", color: "#111111" },
            stroke: { color: "#ffffff", width: 2 },
            effects: [{ type: "outline", color: "#ff0000", width: 3, opacity: 1, enabled: true }],
          },
          transform: { rotationDeg: 10, scaleX: 1.1, scaleY: 0.9, skewXDeg: 5, skewYDeg: 0 },
        },
        {
          id: "two",
          text: "Subtitle",
          bounds: { x: 14, y: 50, width: 100, height: 20 },
          style: {
            fill: {
              type: "linear-gradient",
              angle: 90,
              stops: [
                { offset: 0, color: "#ff0000" },
                { offset: 1, color: "#0000ff" },
              ],
            },
            effects: [{ type: "drop-shadow", color: "#000000", offsetX: 2, offsetY: 3, blur: 4, opacity: 0.4, enabled: true }],
          },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].stroke).toEqual({ color: "#ffffff", width: 2 });
    expect(result.blocks[1].fill?.type).toBe("linear-gradient");
    expect(result.blocks[0].skewXDeg).toBe(5);
  });

  it("fails on malformed JSON", () => {
    const result = parseStructuredTextReconstructionJson("{ not json }");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid JSON");
  });

  it("returns warnings for unsupported or downgraded fields", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [{
        id: "one",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        style: {
          fill: { type: "mesh-gradient", color: "#fff" },
          effects: [{ type: "bevel", size: 4 }],
        },
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blocks[0].fill).toBeUndefined();
    expect(result.blocks[0].effects).toEqual([]);
  });

  it("parses optional confidence and notes fields", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [{
        id: "one",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 30 },
        confidence: 0.92,
        notes: "slightly obscured",
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks[0].confidence).toBe(0.92);
    expect(result.blocks[0].notes).toBe("slightly obscured");
  });

  it("clamps confidence to 0-1 range", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [{
        id: "one",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 30 },
        confidence: 1.5,
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks[0].confidence).toBe(1);
  });

  it("omits confidence and notes when absent", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [{
        id: "one",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 30 },
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks[0].confidence).toBeUndefined();
    expect(result.blocks[0].notes).toBeUndefined();
  });

  it("accepts schema version f4.2/v2", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v2",
      blocks: [{
        id: "one",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 30 },
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe("Hello");
  });

  it("accepts position as alias for offset in linear-gradient stops", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v1",
      blocks: [{
        id: "one",
        text: "Gradient text",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        style: {
          fill: {
            type: "linear-gradient",
            angle: 45,
            stops: [
              { position: 0, color: "#ff0000" },
              { position: 1, color: "#00ff00" },
            ],
          },
        },
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks[0].fill).toEqual({
      type: "linear-gradient",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#00ff00" },
      ],
    });
  });

  it("accepts position as alias for offset in radial-gradient stops", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v2",
      blocks: [{
        id: "one",
        text: "Radial text",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        style: {
          fill: {
            type: "radial-gradient",
            stops: [
              { position: 0, color: "#ffffff" },
              { position: 0.5, color: "#888888" },
              { position: 1, color: "#000000" },
            ],
            centerX: 0.5,
            centerY: 0.5,
          },
        },
      }],
    }));

    expect(result.ok).toBe(true);
    const fill = result.blocks[0].fill;
    expect(fill).toBeDefined();
    expect(fill!.type).toBe("radial-gradient");
    if (fill!.type === "radial-gradient") {
      expect(fill!.stops).toEqual([
        { offset: 0, color: "#ffffff" },
        { offset: 0.5, color: "#888888" },
        { offset: 1, color: "#000000" },
      ]);
      expect(fill!.centerX).toBe(0.5);
      expect(fill!.centerY).toBe(0.5);
    }
  });

  it("parses a full linear-gradient round-trip with correct offset values", () => {
    const result = parseStructuredTextReconstructionJson(JSON.stringify({
      schemaVersion: "f4.2/v2",
      blocks: [{
        id: "gradient-block",
        text: "Rainbow heading",
        bounds: { x: 10, y: 20, width: 300, height: 50 },
        style: {
          fontFamily: "Impact",
          fontSize: 36,
          bold: true,
          fill: {
            type: "linear-gradient",
            angle: 90,
            stops: [
              { offset: 0, color: "#ff0000" },
              { offset: 0.25, color: "#ffff00" },
              { offset: 0.5, color: "#00ff00" },
              { offset: 0.75, color: "#0000ff" },
              { offset: 1, color: "#8b00ff" },
            ],
          },
        },
        transform: { rotationDeg: 0, scaleX: 1, scaleY: 1 },
        confidence: 0.88,
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0];
    expect(block.text).toBe("Rainbow heading");
    expect(block.fill?.type).toBe("linear-gradient");
    if (block.fill?.type === "linear-gradient") {
      expect(block.fill.angle).toBe(90);
      expect(block.fill.stops).toHaveLength(5);
      expect(block.fill.stops[0]).toEqual({ offset: 0, color: "#ff0000" });
      expect(block.fill.stops[2]).toEqual({ offset: 0.5, color: "#00ff00" });
      expect(block.fill.stops[4]).toEqual({ offset: 1, color: "#8b00ff" });
    }
    expect(block.confidence).toBe(0.88);
  });
});
