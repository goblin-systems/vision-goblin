import { getLayerContext } from "./documents";
import type { RasterLayer, Rect, SelectionPath } from "./types";

export interface HealingStrokeOptions {
  x: number;
  y: number;
  brushSize: number;
  strength: number;
  sampleSpread: number;
  blend: number;
  selectionRect?: Rect | null;
  selectionInverted?: boolean;
  selectionShape?: "rect" | "ellipse";
  selectionPath?: SelectionPath | null;
  selectionMask?: HTMLCanvasElement | null;
}

type CandidateOffset = { x: number; y: number };

type HealingEvaluationSample = {
  x: number;
  y: number;
  weight: number;
  targetR: number;
  targetG: number;
  targetB: number;
  targetA: number;
};

export interface HealingStrokeSession {
  brushSize: number | null;
  sampleSpread: number | null;
  selectionRect: Rect | null;
  selectionInverted: boolean;
  selectionShape: "rect" | "ellipse";
  selectionPath: SelectionPath | null;
  selectionMask: HTMLCanvasElement | null;
  selectionAllowsDocPoint: ((docX: number, docY: number) => boolean) | null;
  candidateOffsets: CandidateOffset[] | null;
  donorOffset: CandidateOffset | null;
  donorSearches: number;
}

type Pixel = [number, number, number, number];

const MIN_SAMPLE_SPREAD = 1.4;
const MAX_SAMPLE_SPREAD = 4;

export function createHealingStrokeSession(): HealingStrokeSession {
  return {
    brushSize: null,
    sampleSpread: null,
    selectionRect: null,
    selectionInverted: false,
    selectionShape: "rect",
    selectionPath: null,
    selectionMask: null,
    selectionAllowsDocPoint: null,
    candidateOffsets: null,
    donorOffset: null,
    donorSearches: 0,
  };
}

export function resetHealingStrokeSession(session: HealingStrokeSession) {
  session.brushSize = null;
  session.sampleSpread = null;
  session.selectionRect = null;
  session.selectionInverted = false;
  session.selectionShape = "rect";
  session.selectionPath = null;
  session.selectionMask = null;
  session.selectionAllowsDocPoint = null;
  session.candidateOffsets = null;
  session.donorOffset = null;
  session.donorSearches = 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number) {
  return Math.round(clamp(value, 0, 255));
}

function isPointInRectSelection(x: number, y: number, rect: Rect, shape: "rect" | "ellipse") {
  if (shape === "ellipse") {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
  }
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function isPointInPath(path: SelectionPath, x: number, y: number) {
  if (!path.closed || path.points.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = path.points.length - 1; i < path.points.length; j = i, i += 1) {
    const current = path.points[i]!;
    const previous = path.points[j]!;
    const intersects = ((current.y > y) !== (previous.y > y))
      && (x < ((previous.x - current.x) * (y - current.y)) / Math.max(0.00001, previous.y - current.y) + current.x);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function createSelectionPredicate(options: Pick<HealingStrokeOptions, "selectionRect" | "selectionInverted" | "selectionShape" | "selectionPath" | "selectionMask">) {
  const selectionShape = options.selectionShape ?? "rect";
  const mask = options.selectionMask ?? null;
  const maskData = mask?.getContext("2d")?.getImageData(0, 0, mask.width, mask.height).data ?? null;

  return (docX: number, docY: number) => {
    let selected = true;
    if (mask && maskData) {
      const px = Math.round(docX);
      const py = Math.round(docY);
      selected = px >= 0
        && py >= 0
        && px < mask.width
        && py < mask.height
        && maskData[(py * mask.width + px) * 4 + 3] > 0;
    } else if (options.selectionPath?.closed) {
      selected = isPointInPath(options.selectionPath, docX, docY);
    } else if (options.selectionRect) {
      selected = isPointInRectSelection(docX, docY, options.selectionRect, selectionShape);
    }

    return options.selectionInverted ? !selected : selected;
  };
}

function sessionMatchesOptions(session: HealingStrokeSession, options: HealingStrokeOptions) {
  return session.brushSize === options.brushSize
    && session.sampleSpread === options.sampleSpread
    && session.selectionRect === (options.selectionRect ?? null)
    && session.selectionInverted === (options.selectionInverted ?? false)
    && session.selectionShape === (options.selectionShape ?? "rect")
    && session.selectionPath === (options.selectionPath ?? null)
    && session.selectionMask === (options.selectionMask ?? null);
}

function primeSession(session: HealingStrokeSession, options: HealingStrokeOptions, sampleRadius: number) {
  if (!sessionMatchesOptions(session, options)) {
    resetHealingStrokeSession(session);
    session.brushSize = options.brushSize;
    session.sampleSpread = options.sampleSpread;
    session.selectionRect = options.selectionRect ?? null;
    session.selectionInverted = options.selectionInverted ?? false;
    session.selectionShape = options.selectionShape ?? "rect";
    session.selectionPath = options.selectionPath ?? null;
    session.selectionMask = options.selectionMask ?? null;
  }

  session.selectionAllowsDocPoint ??= createSelectionPredicate(options);
  session.candidateOffsets ??= generateCandidateOffsets(Math.max(1, options.brushSize / 2), sampleRadius);
}

function getPixel(data: Uint8ClampedArray, width: number, x: number, y: number): Pixel {
  const index = (y * width + x) * 4;
  return [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!];
}

function getBoxMean(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, radius = 1): Pixel {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || py < 0 || px >= width || py >= height) {
        continue;
      }
      const pixel = getPixel(data, width, px, py);
      r += pixel[0];
      g += pixel[1];
      b += pixel[2];
      a += pixel[3];
      count += 1;
    }
  }
  if (count === 0) {
    return [0, 0, 0, 0];
  }
  return [r / count, g / count, b / count, a / count];
}

function generateCandidateOffsets(radius: number, sampleRadius: number) {
  const offsets = new Map<string, { x: number; y: number }>();
  const innerRadius = Math.max(radius * 1.15, radius + 1);
  const radialStep = Math.max(2, radius * 0.35);
  for (let ringRadius = innerRadius; ringRadius <= sampleRadius; ringRadius += radialStep) {
    const stepCount = Math.max(16, Math.round((Math.PI * 2 * ringRadius) / Math.max(4, radius * 0.75)));
    for (let step = 0; step < stepCount; step += 1) {
      const angle = (Math.PI * 2 * step) / stepCount;
      const x = Math.round(Math.cos(angle) * ringRadius);
      const y = Math.round(Math.sin(angle) * ringRadius);
      if (x === 0 && y === 0) {
        continue;
      }
      offsets.set(`${x},${y}`, { x, y });
    }
  }
  return Array.from(offsets.values());
}

function createHealingEvaluationSamples(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
) {
  const boundaryInner = radius * 0.82;
  const boundaryOuter = radius * 1.32;
  const samples: HealingEvaluationSample[] = [];
  const minX = Math.max(0, Math.floor(centerX - boundaryOuter));
  const maxX = Math.min(width - 1, Math.ceil(centerX + boundaryOuter));
  const minY = Math.max(0, Math.floor(centerY - boundaryOuter));
  const maxY = Math.min(height - 1, Math.ceil(centerY + boundaryOuter));

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dist = Math.hypot(px - centerX, py - centerY);
      if (dist < boundaryInner || dist > boundaryOuter) {
        continue;
      }
      const weight = 1 - Math.min(1, Math.abs(dist - radius) / Math.max(1, radius * 0.55));
      const index = (py * width + px) * 4;
      samples.push({
        x: px,
        y: py,
        weight,
        targetR: source[index]!,
        targetG: source[index + 1]!,
        targetB: source[index + 2]!,
        targetA: source[index + 3]!,
      });
    }
  }

  return samples;
}

function evaluateHealingOffset(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  samples: HealingEvaluationSample[],
  offset: CandidateOffset,
) {
  let score = 0;
  let weightTotal = 0;
  let targetR = 0;
  let targetG = 0;
  let targetB = 0;
  let targetA = 0;
  let donorR = 0;
  let donorG = 0;
  let donorB = 0;
  let donorA = 0;

  for (const sample of samples) {
    const donorX = sample.x + offset.x;
    const donorY = sample.y + offset.y;
    if (donorX < 0 || donorY < 0 || donorX >= width || donorY >= height) {
      continue;
    }
    const donorIndex = (donorY * width + donorX) * 4;
    const donorRValue = source[donorIndex]!;
    const donorGValue = source[donorIndex + 1]!;
    const donorBValue = source[donorIndex + 2]!;
    const donorAValue = source[donorIndex + 3]!;
    const alphaWeight = Math.max(sample.targetA, donorAValue) / 255;
    score += (Math.abs(sample.targetR - donorRValue)
      + Math.abs(sample.targetG - donorGValue)
      + Math.abs(sample.targetB - donorBValue)
      + Math.abs(sample.targetA - donorAValue) * 1.5) * Math.max(0.1, sample.weight * alphaWeight);
    targetR += sample.targetR * sample.weight;
    targetG += sample.targetG * sample.weight;
    targetB += sample.targetB * sample.weight;
    targetA += sample.targetA * sample.weight;
    donorR += donorRValue * sample.weight;
    donorG += donorGValue * sample.weight;
    donorB += donorBValue * sample.weight;
    donorA += donorAValue * sample.weight;
    weightTotal += sample.weight;
  }

  if (weightTotal < 6) {
    return null;
  }

  return {
    offset,
    normalizedScore: score / weightTotal + Math.hypot(offset.x, offset.y) * 0.12,
    targetMean: [targetR / weightTotal, targetG / weightTotal, targetB / weightTotal, targetA / weightTotal] as Pixel,
    donorMean: [donorR / weightTotal, donorG / weightTotal, donorB / weightTotal, donorA / weightTotal] as Pixel,
  };
}

function findBestHealingOffset(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  samples: HealingEvaluationSample[],
  candidateOffsets: CandidateOffset[],
) {
  let bestOffset: ReturnType<typeof evaluateHealingOffset> = null;

  for (const candidate of candidateOffsets) {
    const result = evaluateHealingOffset(source, width, height, samples, candidate);
    if (!result) {
      continue;
    }
    if (!bestOffset || result.normalizedScore < bestOffset.normalizedScore) {
      bestOffset = result;
    }
  }

  return bestOffset;
}

function fallbackHeal(
  source: Uint8ClampedArray,
  dest: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  strength: number,
  canWrite: (x: number, y: number) => boolean,
) {
  const baseCenterX = clamp(Math.round(centerX), 0, width - 1);
  const baseCenterY = clamp(Math.round(centerY), 0, height - 1);
  const centerPixel = getPixel(source, width, baseCenterX, baseCenterY);

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!canWrite(px, py)) {
        continue;
      }
      const dist = Math.hypot(px - centerX, py - centerY);
      if (dist > radius) {
        continue;
      }
      const feather = Math.pow(1 - dist / radius, 1.6) * strength;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let totalWeight = 0;
      for (let oy = -3; oy <= 3; oy += 1) {
        for (let ox = -3; ox <= 3; ox += 1) {
          const nx = px + ox;
          const ny = py + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const ringDist = Math.hypot(ox, oy);
          if (ringDist < 1.75 || ringDist > 3.75) {
            continue;
          }
          const sample = getPixel(source, width, nx, ny);
          const colorDistance = Math.abs(sample[0] - centerPixel[0]) + Math.abs(sample[1] - centerPixel[1]) + Math.abs(sample[2] - centerPixel[2]);
          const alphaWeight = sample[3] / 255;
          const colorWeight = Math.max(0.08, 1 - colorDistance / 180);
          const radialWeight = 1 - Math.abs(ringDist - 2.8) / 1.2;
          const weight = colorWeight * radialWeight * alphaWeight;
          r += sample[0] * weight;
          g += sample[1] * weight;
          b += sample[2] * weight;
          a += sample[3] * weight;
          totalWeight += weight;
        }
      }
      if (totalWeight <= 0) {
        continue;
      }
      const index = (py * width + px) * 4;
      const preserveWeight = Math.max(0.18, 1 - feather * 0.82);
      dest[index] = Math.round(dest[index]! * preserveWeight + (r / totalWeight) * (1 - preserveWeight));
      dest[index + 1] = Math.round(dest[index + 1]! * preserveWeight + (g / totalWeight) * (1 - preserveWeight));
      dest[index + 2] = Math.round(dest[index + 2]! * preserveWeight + (b / totalWeight) * (1 - preserveWeight));
      dest[index + 3] = Math.round(dest[index + 3]! * preserveWeight + (a / totalWeight) * (1 - preserveWeight));
    }
  }
}

export function healingStroke(layer: RasterLayer, options: HealingStrokeOptions, session?: HealingStrokeSession | null) {
  const radius = Math.max(1, options.brushSize / 2);
  const strength = clamp(options.strength, 0, 1);
  const blend = clamp(options.blend, 0, 1);
  const sampleSpread = clamp(options.sampleSpread, MIN_SAMPLE_SPREAD, MAX_SAMPLE_SPREAD);
  const sampleRadius = radius * sampleSpread;
  const padding = Math.ceil(sampleRadius + 3);
  const sx = Math.max(0, Math.floor(options.x - layer.x - padding));
  const sy = Math.max(0, Math.floor(options.y - layer.y - padding));
  const ex = Math.min(layer.canvas.width, Math.ceil(options.x - layer.x + padding));
  const ey = Math.min(layer.canvas.height, Math.ceil(options.y - layer.y + padding));
  const width = ex - sx;
  const height = ey - sy;
  if (width < 1 || height < 1) {
    return;
  }

  const ctx = getLayerContext(layer);
  const sourceImage = ctx.getImageData(sx, sy, width, height);
  const destImage = ctx.getImageData(sx, sy, width, height);
  const source = sourceImage.data;
  const dest = destImage.data;
  const centerX = options.x - layer.x - sx;
  const centerY = options.y - layer.y - sy;
  if (session) {
    primeSession(session, { ...options, sampleSpread }, sampleRadius);
  }
  const evaluationSamples = createHealingEvaluationSamples(source, width, height, centerX, centerY, radius);
  const selectionAllowsDocPoint = session?.selectionAllowsDocPoint ?? createSelectionPredicate(options);
  const canWrite = (localX: number, localY: number) => selectionAllowsDocPoint(localX + sx + layer.x, localY + sy + layer.y);
  let bestOffset = session?.donorOffset
    ? evaluateHealingOffset(source, width, height, evaluationSamples, session.donorOffset)
    : null;

  if (!bestOffset) {
    const candidateOffsets = session?.candidateOffsets ?? generateCandidateOffsets(radius, sampleRadius);
    bestOffset = findBestHealingOffset(source, width, height, evaluationSamples, candidateOffsets);
    if (session && bestOffset) {
      session.donorOffset = { ...bestOffset.offset };
      session.donorSearches += 1;
    }
  }

  if (!bestOffset) {
    fallbackHeal(source, dest, width, height, centerX, centerY, radius, strength, canWrite);
    ctx.putImageData(destImage, sx, sy);
    return;
  }

  const toneDelta: Pixel = [
    bestOffset.targetMean[0] - bestOffset.donorMean[0],
    bestOffset.targetMean[1] - bestOffset.donorMean[1],
    bestOffset.targetMean[2] - bestOffset.donorMean[2],
    bestOffset.targetMean[3] - bestOffset.donorMean[3],
  ];

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!canWrite(px, py)) {
        continue;
      }
      const dist = Math.hypot(px - centerX, py - centerY);
      if (dist > radius) {
        continue;
      }

      const donorX = px + bestOffset.offset.x;
      const donorY = py + bestOffset.offset.y;
      if (donorX < 0 || donorY < 0 || donorX >= width || donorY >= height) {
        continue;
      }

      const sourcePixel = getPixel(source, width, px, py);
      const donorPixel = getPixel(source, width, donorX, donorY);
      const donorBlur = getBoxMean(source, width, height, donorX, donorY, 1);
      const correctedSmooth: Pixel = [
        donorBlur[0] + toneDelta[0],
        donorBlur[1] + toneDelta[1],
        donorBlur[2] + toneDelta[2],
        donorBlur[3] + toneDelta[3],
      ];
      const correctedSharp: Pixel = [
        donorPixel[0] + toneDelta[0],
        donorPixel[1] + toneDelta[1],
        donorPixel[2] + toneDelta[2],
        donorPixel[3] + toneDelta[3],
      ];
      const healed: Pixel = [
        correctedSmooth[0] + (correctedSharp[0] - correctedSmooth[0]) * blend,
        correctedSmooth[1] + (correctedSharp[1] - correctedSmooth[1]) * blend,
        correctedSmooth[2] + (correctedSharp[2] - correctedSmooth[2]) * blend,
        correctedSmooth[3] + (correctedSharp[3] - correctedSmooth[3]) * blend,
      ];
      const amount = strength * Math.pow(Math.max(0, 1 - dist / radius), 1.35);
      const index = (py * width + px) * 4;
      dest[index] = clampByte(sourcePixel[0] + (healed[0] - sourcePixel[0]) * amount);
      dest[index + 1] = clampByte(sourcePixel[1] + (healed[1] - sourcePixel[1]) * amount);
      dest[index + 2] = clampByte(sourcePixel[2] + (healed[2] - sourcePixel[2]) * amount);
      dest[index + 3] = clampByte(sourcePixel[3] + (healed[3] - sourcePixel[3]) * amount);
    }
  }

  ctx.putImageData(destImage, sx, sy);
}
