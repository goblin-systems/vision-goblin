import { pushHistory } from "./history";
import { createTextLayer, snapshotDocument, syncLayerSource, cloneCanvas } from "./documents";
import type { DocumentState, LayerEffect, RasterLayer, TextFill, TextLayer, TextStroke } from "./types";
import { fitReplacementTextData } from "./textReplacementMatcher";

export interface StructuredTextReconstructionBlock {
  id: string;
  text: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  kerning?: number;
  alignment?: "left" | "center" | "right";
  fill?: TextFill;
  stroke?: TextStroke | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  skewXDeg?: number;
  skewYDeg?: number;
  effects?: LayerEffect[];
  opacity?: number;
  blendMode?: GlobalCompositeOperation;
  boxHeight?: number | null;
  name?: string;
  confidence?: number;
  notes?: string;
}

function clampOpacity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function createStructuredTextLayer(block: StructuredTextReconstructionBlock, fallbackName: string): TextLayer {
  const styleHints = {
    alignment: block.alignment ?? "left",
    fillColor: block.fill?.type === "solid" ? block.fill.color : block.fill?.stops[0]?.color ?? "#111111",
    fill: block.fill ?? { type: "solid" as const, color: "#111111" },
    stroke: block.stroke ?? null,
    effects: block.effects ?? [],
    bold: block.bold ?? false,
    italic: block.italic ?? false,
  };

  const fittedData = fitReplacementTextData(block.text, block.bounds, styleHints, {
    fontFamily: block.fontFamily,
    lineHeight: block.lineHeight,
    kerning: block.kerning,
  });

  const textLayer = createTextLayer(
    block.name ?? fallbackName,
    Math.round(block.bounds.x),
    Math.round(block.bounds.y),
    {
      ...fittedData,
      text: block.text,
      fontFamily: block.fontFamily ?? fittedData.fontFamily,
      fontSize: clampPositive(block.fontSize, fittedData.fontSize),
      lineHeight: clampPositive(block.lineHeight, fittedData.lineHeight),
      kerning: typeof block.kerning === "number" && Number.isFinite(block.kerning) ? block.kerning : fittedData.kerning,
      alignment: block.alignment ?? fittedData.alignment,
      fill: block.fill ?? fittedData.fill,
      stroke: block.stroke ?? fittedData.stroke,
      bold: block.bold ?? fittedData.bold,
      italic: block.italic ?? fittedData.italic,
      underline: block.underline ?? false,
      strikethrough: block.strikethrough ?? false,
      boxWidth: Math.max(1, Math.round(block.bounds.width)),
      boxHeight: block.boxHeight === null ? null : typeof block.boxHeight === "number" && Number.isFinite(block.boxHeight)
        ? Math.max(1, Math.round(block.boxHeight))
        : fittedData.boxHeight,
      rotationDeg: typeof block.rotationDeg === "number" && Number.isFinite(block.rotationDeg) ? block.rotationDeg : 0,
      scaleX: clampPositive(block.scaleX, 1),
      scaleY: clampPositive(block.scaleY, 1),
      skewXDeg: typeof block.skewXDeg === "number" && Number.isFinite(block.skewXDeg) ? block.skewXDeg : 0,
      skewYDeg: typeof block.skewYDeg === "number" && Number.isFinite(block.skewYDeg) ? block.skewYDeg : 0,
    },
  );
  textLayer.effects = [...(block.effects ?? [])];
  textLayer.opacity = clampOpacity(block.opacity);
  textLayer.blendMode = block.blendMode;
  return textLayer;
}

export function applyStructuredTextReconstruction(
  doc: DocumentState,
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  blocks: StructuredTextReconstructionBlock[],
  historyLabel: string,
  rasterOffset?: { rasterX: number; rasterY: number },
): TextLayer[] {
  if (blocks.length === 0) {
    throw new Error("Structured text reconstruction requires at least one block.");
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const textLayers = blocks.map((block, index) => createStructuredTextLayer(block, `Text ${doc.layers.length + index + 1}`));

  layer.canvas = cloneCanvas(cleanedCanvas);
  if (rasterOffset) {
    layer.x = Math.round(rasterOffset.rasterX);
    layer.y = Math.round(rasterOffset.rasterY);
  }
  syncLayerSource(layer);

  const layerIndex = doc.layers.findIndex((entry) => entry.id === layer.id);
  doc.layers.splice(layerIndex >= 0 ? layerIndex + 1 : doc.layers.length, 0, ...textLayers);
  const lastTextLayer = textLayers[textLayers.length - 1] ?? null;
  if (lastTextLayer) {
    doc.activeLayerId = lastTextLayer.id;
    doc.selectedLayerIds = textLayers.length > 1 ? textLayers.map((textLayer) => textLayer.id) : [];
  }
  doc.dirty = true;
  pushHistory(doc, historyLabel);
  return textLayers;
}
