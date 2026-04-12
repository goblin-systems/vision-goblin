import { CURATED_LOCAL_FONT_FAMILIES } from "../fonts/curatedFontFamilies";
import { createLayerCanvas, createTextLayer, measureTextBoxBounds } from "./documents";
import type { LayerEffect, TextFill, TextLayerData, TextStroke } from "./types";

const DEFAULT_REPLACEMENT_FONT_FAMILY = CURATED_LOCAL_FONT_FAMILIES[0] ?? "Arial";
const DEFAULT_REPLACEMENT_LINE_HEIGHT = 1.2;
const DEFAULT_REPLACEMENT_KERNING = 0;
const MIN_REPLACEMENT_LINE_HEIGHT = 1;
const MAX_REPLACEMENT_LINE_HEIGHT = 1.4;
const MIN_REPLACEMENT_KERNING = -0.5;
const MAX_REPLACEMENT_KERNING = 1;
const FONT_MATCH_CONFIDENCE_THRESHOLD = 0.58;
const FONT_MATCH_DEFAULT_MARGIN = 0.012;
const FONT_MATCH_RUNNER_UP_MARGIN = 0.004;
const SPACING_IMPROVEMENT_THRESHOLD = 0.03;

export type ReplacementTextStyleHints = Pick<TextLayerData, "alignment" | "fillColor" | "bold" | "italic"> & {
  fill: TextFill;
  stroke: TextStroke | null;
  effects: LayerEffect[];
};

export interface ReplacementTextSignal {
  width: number;
  height: number;
  alphaMask: Uint8ClampedArray;
  pixelCount: number;
  rowWeights: number[];
  columnWeights: number[];
  box: { x: number; y: number; width: number; height: number } | null;
}

interface CandidateScore {
  fontFamily: string;
  lineHeight: number;
  kerning: number;
  score: number;
}

export interface ReplacementTextMatchResult {
  fontFamily: string;
  lineHeight: number;
  kerning: number;
  confidence: number;
  fontMatched: boolean;
  spacingAdjusted: boolean;
}

function clampLineHeight(value: number): number {
  return Math.max(MIN_REPLACEMENT_LINE_HEIGHT, Math.min(MAX_REPLACEMENT_LINE_HEIGHT, value));
}

function clampKerning(value: number): number {
  return Math.max(MIN_REPLACEMENT_KERNING, Math.min(MAX_REPLACEMENT_KERNING, value));
}

function compareScores(left: CandidateScore, right: CandidateScore): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return CURATED_LOCAL_FONT_FAMILIES.indexOf(left.fontFamily as typeof CURATED_LOCAL_FONT_FAMILIES[number])
    - CURATED_LOCAL_FONT_FAMILIES.indexOf(right.fontFamily as typeof CURATED_LOCAL_FONT_FAMILIES[number]);
}

function buildCandidateCanvas(textData: TextLayerData, signal: ReplacementTextSignal): HTMLCanvasElement {
  const textLayer = createTextLayer("Replacement probe", 0, 0, textData);
  const canvas = createLayerCanvas(signal.width, signal.height);
  canvas.getContext("2d")?.drawImage(textLayer.canvas, 0, 0);
  return canvas;
}

function computeAlphaBox(alpha: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;
  const rowWeights = Array.from({ length: height }, () => 0);
  const columnWeights = Array.from({ length: width }, () => 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alphaValue = alpha[(y * width) + x] ?? 0;
      if (alphaValue <= 0) {
        continue;
      }
      pixelCount += 1;
      rowWeights[y] += alphaValue;
      columnWeights[x] += alphaValue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    pixelCount,
    rowWeights,
    columnWeights,
    box: maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
  };
}

function buildCandidateAlphaMask(canvas: HTMLCanvasElement): ReplacementTextSignal {
  const ctx = canvas.getContext("2d");
  const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
  const alphaMask = new Uint8ClampedArray(canvas.width * canvas.height);
  if (!imageData) {
    return {
      width: canvas.width,
      height: canvas.height,
      alphaMask,
      pixelCount: 0,
      rowWeights: Array.from({ length: canvas.height }, () => 0),
      columnWeights: Array.from({ length: canvas.width }, () => 0),
      box: null,
    };
  }
  for (let pixelIndex = 0; pixelIndex < alphaMask.length; pixelIndex += 1) {
    alphaMask[pixelIndex] = imageData[(pixelIndex * 4) + 3] ?? 0;
  }
  const alphaBox = computeAlphaBox(alphaMask, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    alphaMask,
    pixelCount: alphaBox.pixelCount,
    rowWeights: alphaBox.rowWeights,
    columnWeights: alphaBox.columnWeights,
    box: alphaBox.box,
  };
}

function boxSimilarity(
  left: ReplacementTextSignal["box"],
  right: ReplacementTextSignal["box"],
  width: number,
  height: number,
): number {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const xScore = 1 - Math.min(1, Math.abs(left.x - right.x) / Math.max(1, width));
  const yScore = 1 - Math.min(1, Math.abs(left.y - right.y) / Math.max(1, height));
  const widthScore = 1 - Math.min(1, Math.abs(left.width - right.width) / Math.max(1, width));
  const heightScore = 1 - Math.min(1, Math.abs(left.height - right.height) / Math.max(1, height));
  return (xScore + yScore + widthScore + heightScore) / 4;
}

function profileSimilarity(left: number[], right: number[]): number {
  const leftTotal = left.reduce((sum, value) => sum + value, 0);
  const rightTotal = right.reduce((sum, value) => sum + value, 0);
  if (leftTotal <= 0 && rightTotal <= 0) {
    return 1;
  }
  let difference = 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftWeight = leftTotal > 0 ? (left[index] ?? 0) / leftTotal : 0;
    const rightWeight = rightTotal > 0 ? (right[index] ?? 0) / rightTotal : 0;
    difference += Math.abs(leftWeight - rightWeight);
  }
  return 1 - Math.min(1, difference / 2);
}

function scoreCandidate(signal: ReplacementTextSignal, candidate: ReplacementTextSignal): number {
  if (signal.pixelCount <= 0 || candidate.pixelCount <= 0) {
    return 0;
  }

  let intersection = 0;
  let union = 0;
  for (let pixelIndex = 0; pixelIndex < signal.alphaMask.length; pixelIndex += 1) {
    const sourceActive = (signal.alphaMask[pixelIndex] ?? 0) > 0;
    const candidateActive = (candidate.alphaMask[pixelIndex] ?? 0) > 16;
    if (sourceActive || candidateActive) {
      union += 1;
    }
    if (sourceActive && candidateActive) {
      intersection += 1;
    }
  }

  if (intersection <= 0 || union <= 0) {
    return 0;
  }

  const precision = intersection / Math.max(1, candidate.pixelCount);
  const recall = intersection / Math.max(1, signal.pixelCount);
  const f1 = (2 * precision * recall) / Math.max(0.0001, precision + recall);
  const boxScore = boxSimilarity(signal.box, candidate.box, signal.width, signal.height);
  const rowScore = profileSimilarity(signal.rowWeights, candidate.rowWeights);
  const columnScore = profileSimilarity(signal.columnWeights, candidate.columnWeights);
  return (f1 * 0.58) + (boxScore * 0.22) + (rowScore * 0.14) + (columnScore * 0.06);
}

function countSignalRuns(weights: readonly number[]): number {
  let count = 0;
  let active = false;
  const peak = Math.max(0, ...weights);
  const threshold = Math.max(8, peak * 0.12);
  for (const weight of weights) {
    const hasSignal = weight >= threshold;
    if (hasSignal && !active) {
      count += 1;
    }
    active = hasSignal;
  }
  return count;
}

function evaluateCandidate(
  text: string,
  bounds: { width: number; height: number },
  styleHints: ReplacementTextStyleHints,
  signal: ReplacementTextSignal,
  fontFamily: string,
  lineHeight: number,
  kerning: number,
): CandidateScore {
  const textData = fitReplacementTextData(text, bounds, styleHints, {
    fontFamily,
    lineHeight,
    kerning,
  });
  const candidateSignal = buildCandidateAlphaMask(buildCandidateCanvas(textData, signal));
  return {
    fontFamily,
    lineHeight: textData.lineHeight,
    kerning: textData.kerning,
    score: scoreCandidate(signal, candidateSignal),
  };
}

export function fitReplacementTextData(
  text: string,
  bounds: { width: number; height: number },
  styleHints: ReplacementTextStyleHints,
  overrides: Partial<Pick<TextLayerData, "fontFamily" | "lineHeight" | "kerning">> = {},
): TextLayerData {
  const base: TextLayerData = {
    text,
    fontFamily: overrides.fontFamily ?? DEFAULT_REPLACEMENT_FONT_FAMILY,
    fontSize: 1,
    lineHeight: clampLineHeight(overrides.lineHeight ?? DEFAULT_REPLACEMENT_LINE_HEIGHT),
    kerning: clampKerning(overrides.kerning ?? DEFAULT_REPLACEMENT_KERNING),
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    alignment: styleHints.alignment,
    fill: styleHints.fill,
    stroke: styleHints.stroke,
    fillColor: styleHints.fillColor,
    bold: styleHints.bold,
    italic: styleHints.italic,
    underline: false,
    strikethrough: false,
    boxWidth: Math.max(1, Math.round(bounds.width)),
    boxHeight: null,
  };
  const maxWidth = base.boxWidth ?? Math.max(1, Math.round(bounds.width));

  let low = 1;
  let high = Math.max(1, Math.ceil(bounds.height));
  let best = 1;

  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    base.fontSize = candidate;
    const measured = measureTextBoxBounds(base);
    if (measured.height <= bounds.height && measured.width <= maxWidth) {
      best = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }

  base.fontSize = best;
  return base;
}

export function matchReplacementTextRendering(
  text: string,
  bounds: { width: number; height: number },
  styleHints: ReplacementTextStyleHints,
  signal: ReplacementTextSignal,
): ReplacementTextMatchResult {
  if (!text.trim() || signal.pixelCount <= 0) {
    return {
      fontFamily: DEFAULT_REPLACEMENT_FONT_FAMILY,
      lineHeight: DEFAULT_REPLACEMENT_LINE_HEIGHT,
      kerning: DEFAULT_REPLACEMENT_KERNING,
      confidence: 0,
      fontMatched: false,
      spacingAdjusted: false,
    };
  }

  const lineHeightOptions = countSignalRuns(signal.rowWeights) >= 2
    ? [1, 1.1, DEFAULT_REPLACEMENT_LINE_HEIGHT, 1.3, 1.4]
    : [DEFAULT_REPLACEMENT_LINE_HEIGHT];
  const nonWhitespaceLength = text.replace(/\s+/g, "").length;
  const kerningOptions = nonWhitespaceLength >= 4
    ? [MIN_REPLACEMENT_KERNING, DEFAULT_REPLACEMENT_KERNING, 0.5, MAX_REPLACEMENT_KERNING]
    : [DEFAULT_REPLACEMENT_KERNING];

  const bestPerFamily = CURATED_LOCAL_FONT_FAMILIES.map((fontFamily) => {
    let best = evaluateCandidate(
      text,
      bounds,
      styleHints,
      signal,
      fontFamily,
      DEFAULT_REPLACEMENT_LINE_HEIGHT,
      DEFAULT_REPLACEMENT_KERNING,
    );
    for (const lineHeight of lineHeightOptions) {
      for (const kerning of kerningOptions) {
        const next = evaluateCandidate(text, bounds, styleHints, signal, fontFamily, lineHeight, kerning);
        if (compareScores(next, best) < 0) {
          best = next;
        }
      }
    }
    return best;
  }).sort(compareScores);

  const defaultFamilyCandidate = bestPerFamily.find((candidate) => candidate.fontFamily === DEFAULT_REPLACEMENT_FONT_FAMILY)
    ?? bestPerFamily[0]
    ?? {
      fontFamily: DEFAULT_REPLACEMENT_FONT_FAMILY,
      lineHeight: DEFAULT_REPLACEMENT_LINE_HEIGHT,
      kerning: DEFAULT_REPLACEMENT_KERNING,
      score: 0,
    };
  const bestCandidate = bestPerFamily[0] ?? defaultFamilyCandidate;
  const runnerUpCandidate = bestPerFamily.find((candidate) => candidate.fontFamily !== bestCandidate.fontFamily) ?? defaultFamilyCandidate;
  const fontMatched = bestCandidate.fontFamily !== DEFAULT_REPLACEMENT_FONT_FAMILY
    && bestCandidate.score >= FONT_MATCH_CONFIDENCE_THRESHOLD
    && (bestCandidate.score - defaultFamilyCandidate.score) >= FONT_MATCH_DEFAULT_MARGIN
    && (bestCandidate.score - runnerUpCandidate.score) >= FONT_MATCH_RUNNER_UP_MARGIN;

  const chosenFamilyCandidate = fontMatched ? bestCandidate : defaultFamilyCandidate;
  const defaultSpacingCandidate = evaluateCandidate(
    text,
    bounds,
    styleHints,
    signal,
    chosenFamilyCandidate.fontFamily,
    DEFAULT_REPLACEMENT_LINE_HEIGHT,
    DEFAULT_REPLACEMENT_KERNING,
  );
  const spacingAdjusted = (
    chosenFamilyCandidate.lineHeight !== DEFAULT_REPLACEMENT_LINE_HEIGHT
    || chosenFamilyCandidate.kerning !== DEFAULT_REPLACEMENT_KERNING
  ) && (chosenFamilyCandidate.score - defaultSpacingCandidate.score) >= SPACING_IMPROVEMENT_THRESHOLD;

  return {
    fontFamily: chosenFamilyCandidate.fontFamily,
    lineHeight: spacingAdjusted ? chosenFamilyCandidate.lineHeight : DEFAULT_REPLACEMENT_LINE_HEIGHT,
    kerning: spacingAdjusted ? chosenFamilyCandidate.kerning : DEFAULT_REPLACEMENT_KERNING,
    confidence: chosenFamilyCandidate.score,
    fontMatched,
    spacingAdjusted,
  };
}
