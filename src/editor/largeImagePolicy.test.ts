import { describe, expect, it } from "vitest";
import { createAdjustmentLayer, createBlankDocument, createLayerCanvas } from "./documents";
import { estimateDocumentBytes, formatLargeImageMetrics, getLargeImagePolicy, getRenderDegradationPolicy } from "./largeImagePolicy";

describe("large image policy", () => {
  it("classifies representative large documents and lowers history budgets", () => {
    const doc = createBlankDocument("Huge", 8000, 6000, 100);

    const policy = getLargeImagePolicy(doc);

    expect(policy.tier).toBe("huge");
    expect(policy.history.entryLimit).toBeLessThan(40);
    expect(policy.history.byteBudget).toBeLessThan(160 * 1024 * 1024);
  });

  it("accounts for extra runtime canvases in memory estimates", () => {
    const doc = createBlankDocument("Doc", 1600, 1200, 100);
    doc.selectionMask = createLayerCanvas(1600, 1200);
    doc.layers[1]!.sourceCanvas = createLayerCanvas(1600, 1200);

    expect(estimateDocumentBytes(doc)).toBeGreaterThan(1600 * 1200 * 4 * 3);
  });

  it("degrades interactive rendering for large documents with adjustment layers", () => {
    const doc = createBlankDocument("Large", 6000, 4000, 100);
    doc.selectionMask = createLayerCanvas(doc.width, doc.height);
    doc.layers.push(createAdjustmentLayer("Levels", { kind: "levels", params: { inputBlack: 0, inputWhite: 255, gamma: 1 } }));

    const degradation = getRenderDegradationPolicy(doc, true);

    expect(degradation.active).toBe(true);
    expect(degradation.skipAdjustmentLayers).toBe(true);
    expect(degradation.skipSelectionOverlays).toBe(true);
    expect(degradation.skipQuickMaskOverlay).toBe(true);
  });

  it("formats render diagnostics in a readable compact form", () => {
    expect(formatLargeImageMetrics({ pixelCount: 24_000_000, estimatedBytes: 201 * 1024 * 1024 })).toBe("24.0 MP / ~201 MiB");
  });
});
