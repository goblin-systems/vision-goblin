import { getLayerContext, syncLayerSource } from "./documents";
import { resolveEffectiveSelectionMask } from "./fill";
import { maskBoundingRect } from "./selection";
import type { DocumentState, RasterLayer } from "./types";

export interface GradientCurveNode {
  id: string;
  x: number;
  y: number;
  color: string;
}

export type GradientTargetScope = "selection" | "canvas";

export const DEFAULT_GRADIENT_HEADING_DEGREES = 0;

interface GradientRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface GradientParsedStop {
  x: number;
  rgba: GradientRgba;
}

export interface GradientSampler {
  normalizedNodes: GradientCurveNode[];
  sampleCurveY: (position: number) => number;
  sampleRgba: (position: number) => GradientRgba | null;
  sampleHex: (position: number) => string;
}

export type GradientApplicationResult =
  | { ok: true; message: string }
  | { ok: false; message: string; variant: "error" | "info" };

const MIN_NODE_GAP = 0.02;
const gradientSamplerCache = new WeakMap<GradientCurveNode[], GradientSampler>();

function nextGradientNodeId() {
  return `gradient-node-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeHexColour(colour: string) {
  const normalized = colour.trim();
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

function parseHexColour(colour: string) {
  const hex = normalizeHexColour(colour).slice(1);
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
    if ([r, g, b, a].some((value) => Number.isNaN(value))) {
      return null;
    }
    return { r, g, b, a };
  }
  return null;
}

function blendChannel(source: number, destination: number, sourceAlpha: number, destinationAlpha: number, outAlpha: number) {
  if (outAlpha <= 0) {
    return 0;
  }
  return Math.round(((source * sourceAlpha) + (destination * destinationAlpha * (1 - sourceAlpha))) / outAlpha);
}

function interpolateChannel(start: number, end: number, t: number) {
  return Math.round(start + (end - start) * t);
}

function sampleGradientCurveYNormalized(nodes: GradientCurveNode[], position: number): number {
  const x = clamp01(position);
  if (x <= nodes[0].x) {
    return nodes[0].y;
  }
  if (x >= nodes[nodes.length - 1].x) {
    return nodes[nodes.length - 1].y;
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const start = nodes[index];
    const end = nodes[index + 1];
    if (x < start.x || x > end.x) {
      continue;
    }
    const span = Math.max(end.x - start.x, Number.EPSILON);
    const t = (x - start.x) / span;
    return start.y + (end.y - start.y) * t;
  }

  return nodes[nodes.length - 1].y;
}

function parseGradientStops(nodes: GradientCurveNode[]): GradientParsedStop[] | null {
  const stops: GradientParsedStop[] = [];
  for (const node of nodes) {
    const rgba = parseHexColour(node.color);
    if (!rgba) {
      return null;
    }
    stops.push({ x: node.x, rgba });
  }
  return stops;
}

function sampleGradientStopsRgba(stops: GradientParsedStop[], position: number): GradientRgba {
  if (position <= stops[0].x) {
    return stops[0].rgba;
  }
  if (position >= stops[stops.length - 1].x) {
    return stops[stops.length - 1].rgba;
  }

  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index];
    const end = stops[index + 1];
    if (position < start.x || position > end.x) {
      continue;
    }
    const span = Math.max(end.x - start.x, Number.EPSILON);
    const t = (position - start.x) / span;
    return {
      r: interpolateChannel(start.rgba.r, end.rgba.r, t),
      g: interpolateChannel(start.rgba.g, end.rgba.g, t),
      b: interpolateChannel(start.rgba.b, end.rgba.b, t),
      a: interpolateChannel(start.rgba.a, end.rgba.a, t),
    };
  }

  return stops[stops.length - 1].rgba;
}

function rgbaToHex(rgba: GradientRgba) {
  return `#${[rgba.r, rgba.g, rgba.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function normalizeGradientHeadingDegrees(headingDegrees: number) {
  const normalized = headingDegrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

interface GradientDirectionProjection {
  dirX: number;
  dirY: number;
  min: number;
  max: number;
}

function createGradientDirectionProjection(width: number, height: number, headingDegrees: number): GradientDirectionProjection {
  const angleRadians = (normalizeGradientHeadingDegrees(headingDegrees) * Math.PI) / 180;
  const dirX = Math.cos(angleRadians);
  const dirY = Math.sin(angleRadians);
  const maxX = Math.max(width - 1, 0);
  const maxY = Math.max(height - 1, 0);
  const cornerDots = [
    0,
    maxX * dirX,
    maxY * dirY,
    maxX * dirX + maxY * dirY,
  ];

  return {
    dirX,
    dirY,
    min: Math.min(...cornerDots),
    max: Math.max(...cornerDots),
  };
}

function sampleGradientDirectionPosition(
  projection: GradientDirectionProjection,
  pixelX: number,
  pixelY: number,
) {
  const span = projection.max - projection.min;
  if (span <= Number.EPSILON) {
    return 0;
  }
  const dot = pixelX * projection.dirX + pixelY * projection.dirY;
  return clamp01((dot - projection.min) / span);
}

export function normalizeGradientNodes(nodes: GradientCurveNode[]): GradientCurveNode[] {
  const sorted = [...nodes]
    .map((node) => ({
      ...node,
      x: clamp01(node.x),
      y: clamp01(node.y),
      color: normalizeHexColour(node.color),
    }))
    .sort((left, right) => left.x - right.x);

  if (sorted.length < 2) {
    return createDefaultGradientNodes();
  }

  return sorted.map((node, index) => ({
    ...node,
    x: index === 0 ? 0 : index === sorted.length - 1 ? 1 : node.x,
  }));
}

export function createDefaultGradientNodes(startColour = "#6C63FF", endColour = "#FFFFFF"): GradientCurveNode[] {
  return normalizeGradientNodes([
    { id: nextGradientNodeId(), x: 0, y: 0, color: normalizeHexColour(startColour) },
    { id: nextGradientNodeId(), x: 1, y: 1, color: normalizeHexColour(endColour) },
  ]);
}

export function resetGradientNodes(startColour = "#6C63FF", endColour = "#FFFFFF") {
  return createDefaultGradientNodes(startColour, endColour);
}

export function addGradientNode(nodes: GradientCurveNode[], colour?: string): GradientCurveNode[] {
  const normalized = normalizeGradientNodes(nodes);
  let bestIndex = 0;
  let bestGap = -1;
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const gap = normalized[index + 1].x - normalized[index].x;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }
  const left = normalized[bestIndex];
  const right = normalized[bestIndex + 1];
  const nextX = left.x + (right.x - left.x) / 2;
  const nextY = sampleGradientCurveY(normalized, nextX);
  const nextColour = colour ?? sampleGradientColourHex(normalized, nextX);
  return normalizeGradientNodes([
    ...normalized,
    { id: nextGradientNodeId(), x: nextX, y: nextY, color: nextColour },
  ]);
}

export function addGradientNodeAtPosition(nodes: GradientCurveNode[], x: number, y: number, colour?: string): GradientCurveNode[] {
  const normalized = normalizeGradientNodes(nodes);
  const nextX = clamp01(x);
  const nextY = clamp01(y);
  const nextColour = colour ?? sampleGradientColourHex(normalized, nextX);
  return normalizeGradientNodes([
    ...normalized,
    { id: nextGradientNodeId(), x: nextX, y: nextY, color: nextColour },
  ]);
}

export function moveGradientNode(nodes: GradientCurveNode[], nodeId: string, nextX: number, nextY: number): GradientCurveNode[] {
  const normalized = normalizeGradientNodes(nodes);
  const index = normalized.findIndex((node) => node.id === nodeId);
  if (index < 0) {
    return normalized;
  }

  return normalizeGradientNodes(normalized.map((node, nodeIndex) => {
    if (nodeIndex !== index) {
      return node;
    }

    const minX = nodeIndex === 0 ? 0 : normalized[nodeIndex - 1].x + MIN_NODE_GAP;
    const maxX = nodeIndex === normalized.length - 1 ? 1 : normalized[nodeIndex + 1].x - MIN_NODE_GAP;
    return {
      ...node,
      x: nodeIndex === 0 ? 0 : nodeIndex === normalized.length - 1 ? 1 : Math.max(minX, Math.min(maxX, nextX)),
      y: clamp01(nextY),
    };
  }));
}

export function updateGradientNodeColour(nodes: GradientCurveNode[], nodeId: string, colour: string): GradientCurveNode[] {
  return normalizeGradientNodes(nodes.map((node) => (
    node.id === nodeId ? { ...node, color: normalizeHexColour(colour) } : node
  )));
}

export function removeGradientNode(nodes: GradientCurveNode[], nodeId: string): GradientCurveNode[] {
  const normalized = normalizeGradientNodes(nodes);
  const index = normalized.findIndex((node) => node.id === nodeId);
  if (index <= 0 || index >= normalized.length - 1) {
    return normalized;
  }
  return normalizeGradientNodes(normalized.filter((node) => node.id !== nodeId));
}

export function sampleGradientCurveY(nodes: GradientCurveNode[], position: number): number {
  return createGradientSampler(nodes).sampleCurveY(position);
}

export function createGradientSampler(nodes: GradientCurveNode[]): GradientSampler {
  const cached = gradientSamplerCache.get(nodes);
  if (cached) {
    return cached;
  }

  const normalizedNodes = normalizeGradientNodes(nodes);
  const stops = parseGradientStops(normalizedNodes);
  const sampler: GradientSampler = {
    normalizedNodes,
    sampleCurveY(position) {
      return sampleGradientCurveYNormalized(normalizedNodes, position);
    },
    sampleRgba(position) {
      if (!stops) {
        return null;
      }
      const remappedPosition = clamp01(sampleGradientCurveYNormalized(normalizedNodes, position));
      return sampleGradientStopsRgba(stops, remappedPosition);
    },
    sampleHex(position) {
      const rgba = sampler.sampleRgba(position);
      return rgba ? rgbaToHex(rgba) : "#000000";
    },
  };

  gradientSamplerCache.set(nodes, sampler);
  gradientSamplerCache.set(normalizedNodes, sampler);
  return sampler;
}

function sampleGradientColourRgba(nodes: GradientCurveNode[], position: number) {
  return createGradientSampler(nodes).sampleRgba(position);
}

export function sampleGradientColourHex(nodes: GradientCurveNode[], position: number) {
  return createGradientSampler(nodes).sampleHex(position);
}

export function applyGradientToSelection(
  doc: Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">,
  layer: RasterLayer,
  nodes: GradientCurveNode[],
  targetScope: GradientTargetScope = "selection",
  headingDegrees = DEFAULT_GRADIENT_HEADING_DEGREES,
): GradientApplicationResult {
  const sampler = createGradientSampler(nodes);
  const effectiveMask = targetScope === "selection" ? resolveEffectiveSelectionMask(doc) : null;
  const selectionBounds = effectiveMask ? maskBoundingRect(effectiveMask) : null;
  const targetLeft = selectionBounds ? Math.max(layer.x, selectionBounds.x) : layer.x;
  const targetTop = selectionBounds ? Math.max(layer.y, selectionBounds.y) : layer.y;
  const targetRight = selectionBounds ? Math.min(layer.x + layer.canvas.width, selectionBounds.x + selectionBounds.width) : layer.x + layer.canvas.width;
  const targetBottom = selectionBounds ? Math.min(layer.y + layer.canvas.height, selectionBounds.y + selectionBounds.height) : layer.y + layer.canvas.height;

  if (targetRight <= targetLeft || targetBottom <= targetTop) {
    return { ok: false, message: "Selection does not overlap the active layer", variant: "info" };
  }

  const sampleColour = sampler.sampleRgba(0.5);
  if (!sampleColour) {
    return { ok: false, message: "One or more gradient colours are invalid", variant: "error" };
  }

  const layerCtx = getLayerContext(layer);
  const left = targetLeft - layer.x;
  const top = targetTop - layer.y;
  const width = targetRight - targetLeft;
  const height = targetBottom - targetTop;
  const layerImage = layerCtx.getImageData(left, top, width, height);
  const pixels = layerImage.data;
  const maskCtx = effectiveMask?.getContext("2d") ?? null;
  const maskImage = maskCtx ? maskCtx.getImageData(targetLeft, targetTop, width, height) : null;
  const maskPixels = maskImage?.data ?? null;
  const directionProjection = createGradientDirectionProjection(width, height, headingDegrees);
  let changed = false;
  let hasSelectedOverlap = !effectiveMask;

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const index = (pixelY * width + pixelX) * 4;
      const maskAlpha = maskPixels ? maskPixels[index + 3] / 255 : 1;
      if (maskAlpha === 0) {
        continue;
      }
      hasSelectedOverlap = true;

      const position = sampleGradientDirectionPosition(directionProjection, pixelX, pixelY);
      const rgba = sampler.sampleRgba(position);
      if (!rgba) {
        return { ok: false, message: "One or more gradient colours are invalid", variant: "error" };
      }

      const sourceAlpha = (rgba.a / 255) * maskAlpha;
      const destinationAlpha = pixels[index + 3] / 255;
      const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      const nextR = blendChannel(rgba.r, pixels[index], sourceAlpha, destinationAlpha, outAlpha);
      const nextG = blendChannel(rgba.g, pixels[index + 1], sourceAlpha, destinationAlpha, outAlpha);
      const nextB = blendChannel(rgba.b, pixels[index + 2], sourceAlpha, destinationAlpha, outAlpha);
      const nextA = Math.round(outAlpha * 255);
      if (
        pixels[index] === nextR &&
        pixels[index + 1] === nextG &&
        pixels[index + 2] === nextB &&
        pixels[index + 3] === nextA
      ) {
        continue;
      }
      pixels[index] = nextR;
      pixels[index + 1] = nextG;
      pixels[index + 2] = nextB;
      pixels[index + 3] = nextA;
      changed = true;
    }
  }

  if (!hasSelectedOverlap) {
    return { ok: false, message: "Selection does not overlap the active layer", variant: "info" };
  }

  if (!changed) {
    return { ok: false, message: "Gradient already matches the target area", variant: "info" };
  }

  layerCtx.putImageData(layerImage, left, top);
  layer.fillColor = undefined;
  syncLayerSource(layer);
  return { ok: true, message: effectiveMask ? "Applied gradient to selection" : "Applied gradient to layer" };
}
