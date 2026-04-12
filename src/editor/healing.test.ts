import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerCanvas } from "./documents";
import { createHealingStrokeSession, healingStroke, resetHealingStrokeSession } from "./healing";
import type { RasterLayer } from "./types";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";

function createRasterLayer(width: number, height: number): RasterLayer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "raster",
    canvas: createLayerCanvas(width, height),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
  };
}

function copyLayer(source: RasterLayer) {
  const next = createRasterLayer(source.canvas.width, source.canvas.height);
  next.canvas.getContext("2d")?.drawImage(source.canvas, 0, 0);
  return next;
}

function fillTexturedSkin(canvas: HTMLCanvasElement) {
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const base = 176 + ((x * 11 + y * 7) % 9) - 4;
      setPixel(canvas, x, y, { r: base + 12, g: base - 4, b: base - 18, a: 255 });
    }
  }
}

function fillSplitBackground(canvas: HTMLCanvasElement) {
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (x < canvas.width / 2) {
        const base = 122 + ((x * 5 + y * 3) % 7) - 3;
        setPixel(canvas, x, y, { r: base, g: base + 6, b: base + 10, a: 255 });
      } else {
        const base = 84 + ((x * 7 + y * 5) % 9) - 4;
        setPixel(canvas, x, y, { r: base - 16, g: base + 26, b: base + 78, a: 255 });
      }
    }
  }
}

function addCircularBlemish(canvas: HTMLCanvasElement, centerX: number, centerY: number, radius: number, colour: { r: number; g: number; b: number; a: number }) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        continue;
      }
      if (Math.hypot(x - centerX, y - centerY) <= radius) {
        setPixel(canvas, x, y, colour);
      }
    }
  }
}

function meanAbsoluteError(actual: HTMLCanvasElement, expected: HTMLCanvasElement, centerX: number, centerY: number, radius: number) {
  let total = 0;
  let count = 0;
  for (let y = Math.max(0, centerY - radius); y <= Math.min(actual.height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(actual.width - 1, centerX + radius); x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > radius) {
        continue;
      }
      const a = readPixel(actual, x, y);
      const b = readPixel(expected, x, y);
      total += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
      count += 3;
    }
  }
  return count === 0 ? 0 : total / count;
}

function legacyHealingStroke(layer: RasterLayer, x: number, y: number, brushSize: number, strength: number) {
  const radius = Math.max(1, brushSize / 2);
  const sampleRadius = radius * 2.4;
  const sx = Math.max(0, Math.floor(x - layer.x - sampleRadius));
  const sy = Math.max(0, Math.floor(y - layer.y - sampleRadius));
  const ex = Math.min(layer.canvas.width, Math.ceil(x - layer.x + sampleRadius));
  const ey = Math.min(layer.canvas.height, Math.ceil(y - layer.y + sampleRadius));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < 1 || sh < 1) return;

  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const source = ctx.getImageData(sx, sy, sw, sh);
  const dest = ctx.getImageData(sx, sy, sw, sh);
  const src = source.data;
  const dst = dest.data;
  const centerX = x - layer.x - sx;
  const centerY = y - layer.y - sy;

  const getPixel = (px: number, py: number) => {
    const index = (py * sw + px) * 4;
    return [src[index]!, src[index + 1]!, src[index + 2]!, src[index + 3]!] as const;
  };

  const centerPixel = getPixel(Math.max(0, Math.min(sw - 1, Math.round(centerX))), Math.max(0, Math.min(sh - 1, Math.round(centerY))));
  for (let py = 0; py < sh; py += 1) {
    for (let px = 0; px < sw; px += 1) {
      const dist = Math.hypot(px - centerX, py - centerY);
      if (dist > radius) continue;
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
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const ringDist = Math.hypot(ox, oy);
          if (ringDist < 1.75 || ringDist > 3.75) continue;
          const sample = getPixel(nx, ny);
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
      if (totalWeight <= 0) continue;
      const index = (py * sw + px) * 4;
      const preserveWeight = Math.max(0.18, 1 - feather * 0.82);
      dst[index] = Math.round(dst[index]! * preserveWeight + (r / totalWeight) * (1 - preserveWeight));
      dst[index + 1] = Math.round(dst[index + 1]! * preserveWeight + (g / totalWeight) * (1 - preserveWeight));
      dst[index + 2] = Math.round(dst[index + 2]! * preserveWeight + (b / totalWeight) * (1 - preserveWeight));
      dst[index + 3] = Math.round(dst[index + 3]! * preserveWeight + (a / totalWeight) * (1 - preserveWeight));
    }
  }

  ctx.putImageData(dest, sx, sy);
}

function legacyGenerateCandidateOffsets(radius: number, sampleRadius: number) {
  const offsets = new Map<string, { x: number; y: number }>();
  const innerRadius = Math.max(radius * 1.15, radius + 1);
  const radialStep = Math.max(2, radius * 0.35);
  for (let ringRadius = innerRadius; ringRadius <= sampleRadius; ringRadius += radialStep) {
    const stepCount = Math.max(16, Math.round((Math.PI * 2 * ringRadius) / Math.max(4, radius * 0.75)));
    for (let step = 0; step < stepCount; step += 1) {
      const angle = (Math.PI * 2 * step) / stepCount;
      const sampleX = Math.round(Math.cos(angle) * ringRadius);
      const sampleY = Math.round(Math.sin(angle) * ringRadius);
      if (sampleX === 0 && sampleY === 0) {
        continue;
      }
      offsets.set(`${sampleX},${sampleY}`, { x: sampleX, y: sampleY });
    }
  }
  return Array.from(offsets.values());
}

function legacyEvaluateHealingOffset(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  offset: { x: number; y: number },
) {
  const boundaryInner = radius * 0.82;
  const boundaryOuter = radius * 1.32;
  let score = 0;
  let weightTotal = 0;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const dist = Math.hypot(px - centerX, py - centerY);
      if (dist < boundaryInner || dist > boundaryOuter) {
        continue;
      }
      const donorX = px + offset.x;
      const donorY = py + offset.y;
      if (donorX < 0 || donorY < 0 || donorX >= width || donorY >= height) {
        continue;
      }
      const targetPixel = readPixelFromData(source, width, px, py);
      const donorPixel = readPixelFromData(source, width, donorX, donorY);
      const weight = 1 - Math.min(1, Math.abs(dist - radius) / Math.max(1, radius * 0.55));
      const alphaWeight = Math.max(targetPixel[3], donorPixel[3]) / 255;
      score += (Math.abs(targetPixel[0] - donorPixel[0])
        + Math.abs(targetPixel[1] - donorPixel[1])
        + Math.abs(targetPixel[2] - donorPixel[2])
        + Math.abs(targetPixel[3] - donorPixel[3]) * 1.5) * Math.max(0.1, weight * alphaWeight);
      weightTotal += weight;
    }
  }

  if (weightTotal < 6) {
    return null;
  }

  return {
    offset,
    normalizedScore: score / weightTotal + Math.hypot(offset.x, offset.y) * 0.12,
  };
}

function readPixelFromData(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const index = (y * width + x) * 4;
  return [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!] as const;
}

function legacyBestHealingOffset(layer: RasterLayer, x: number, y: number, brushSize: number, sampleSpread: number) {
  const radius = Math.max(1, brushSize / 2);
  const sampleRadius = radius * sampleSpread;
  const padding = Math.ceil(sampleRadius + 3);
  const sx = Math.max(0, Math.floor(x - layer.x - padding));
  const sy = Math.max(0, Math.floor(y - layer.y - padding));
  const ex = Math.min(layer.canvas.width, Math.ceil(x - layer.x + padding));
  const ey = Math.min(layer.canvas.height, Math.ceil(y - layer.y + padding));
  const width = ex - sx;
  const height = ey - sy;
  const ctx = layer.canvas.getContext("2d");
  if (!ctx || width < 1 || height < 1) {
    return null;
  }

  const source = ctx.getImageData(sx, sy, width, height).data;
  const centerX = x - layer.x - sx;
  const centerY = y - layer.y - sy;
  const candidateOffsets = legacyGenerateCandidateOffsets(radius, sampleRadius);
  let best: ReturnType<typeof legacyEvaluateHealingOffset> = null;

  for (const candidate of candidateOffsets) {
    const result = legacyEvaluateHealingOffset(source, width, height, centerX, centerY, radius, candidate);
    if (!result) {
      continue;
    }
    if (!best || result.normalizedScore < best.normalizedScore) {
      best = result;
    }
  }

  return best?.offset ?? null;
}

describe("healingStroke", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("beats the legacy blend on a small textured blemish", () => {
    const clean = createRasterLayer(40, 40);
    fillTexturedSkin(clean.canvas);
    const damaged = copyLayer(clean);
    addCircularBlemish(damaged.canvas, 20, 20, 3, { r: 74, g: 38, b: 26, a: 255 });
    const legacy = copyLayer(damaged);
    const improved = copyLayer(damaged);

    legacyHealingStroke(legacy, 20, 20, 10, 1);
    healingStroke(improved, { x: 20, y: 20, brushSize: 10, strength: 1, sampleSpread: 2.8, blend: 0.85 });

    const legacyError = meanAbsoluteError(legacy.canvas, clean.canvas, 20, 20, 5);
    const improvedError = meanAbsoluteError(improved.canvas, clean.canvas, 20, 20, 5);

    expect(improvedError).toBeLessThan(legacyError * 0.8);
  });

  it("preserves a hard nearby edge better than the legacy blend", () => {
    const clean = createRasterLayer(48, 32);
    fillSplitBackground(clean.canvas);
    const damaged = copyLayer(clean);
    addCircularBlemish(damaged.canvas, 27, 16, 3, { r: 224, g: 168, b: 68, a: 255 });
    const legacy = copyLayer(damaged);
    const improved = copyLayer(damaged);

    legacyHealingStroke(legacy, 27, 16, 12, 1);
    healingStroke(improved, { x: 27, y: 16, brushSize: 12, strength: 1, sampleSpread: 2.1, blend: 0.55 });

    const legacyError = meanAbsoluteError(legacy.canvas, clean.canvas, 27, 16, 6);
    const improvedError = meanAbsoluteError(improved.canvas, clean.canvas, 27, 16, 6);

    expect(improvedError).toBeLessThan(legacyError * 0.8);
  });

  it("keeps healing constrained to the active selection mask", () => {
    const layer = createRasterLayer(24, 24);
    fillTexturedSkin(layer.canvas);
    addCircularBlemish(layer.canvas, 12, 12, 3, { r: 20, g: 20, b: 20, a: 255 });
    const selectionMask = createLayerCanvas(24, 24);
    const maskCtx = selectionMask.getContext("2d");
    maskCtx!.fillStyle = "#ffffff";
    maskCtx!.fillRect(10, 10, 3, 5);
    const beforeOutside = readPixel(layer.canvas, 14, 12);

    healingStroke(layer, {
      x: 12,
      y: 12,
      brushSize: 12,
      strength: 1,
      sampleSpread: 2.8,
      blend: 0.85,
      selectionMask,
    });

    expect(readPixel(layer.canvas, 14, 12)).toEqual(beforeOutside);
    expect(readPixel(layer.canvas, 11, 12)).not.toEqual({ r: 20, g: 20, b: 20, a: 255 });
  });

  it("reuses the donor search across dabs in one stroke session", () => {
    const layer = createRasterLayer(40, 40);
    fillTexturedSkin(layer.canvas);
    addCircularBlemish(layer.canvas, 20, 20, 3, { r: 74, g: 38, b: 26, a: 255 });
    const session = createHealingStrokeSession();

    healingStroke(layer, { x: 20, y: 20, brushSize: 10, strength: 1, sampleSpread: 2.8, blend: 0.85 }, session);
    expect(session.donorOffset).not.toBeNull();
    expect(session.donorSearches).toBe(1);

    healingStroke(layer, { x: 21, y: 20, brushSize: 10, strength: 1, sampleSpread: 2.8, blend: 0.85 }, session);
    expect(session.donorSearches).toBe(1);
  });

  it("matches the legacy donor choice while avoiding per-candidate box scans", () => {
    const layer = createRasterLayer(96, 96);
    fillTexturedSkin(layer.canvas);
    addCircularBlemish(layer.canvas, 48, 48, 6, { r: 74, g: 38, b: 26, a: 255 });
    const session = createHealingStrokeSession();
    const expectedOffset = legacyBestHealingOffset(layer, 48, 48, 28, 2.8);

    healingStroke(layer, { x: 48, y: 48, brushSize: 28, strength: 1, sampleSpread: 2.8, blend: 0.85 }, session);

    expect(session.donorOffset).toEqual(expectedOffset);
    expect(session.donorSearches).toBe(1);
  });

  it("resets cached stroke state when the session is cleared", () => {
    const layer = createRasterLayer(40, 40);
    fillTexturedSkin(layer.canvas);
    addCircularBlemish(layer.canvas, 20, 20, 3, { r: 74, g: 38, b: 26, a: 255 });
    const session = createHealingStrokeSession();

    healingStroke(layer, { x: 20, y: 20, brushSize: 10, strength: 1, sampleSpread: 2.8, blend: 0.85 }, session);
    expect(session.donorSearches).toBe(1);

    resetHealingStrokeSession(session);
    expect(session.donorOffset).toBeNull();

    healingStroke(layer, { x: 21, y: 20, brushSize: 10, strength: 1, sampleSpread: 2.8, blend: 0.85 }, session);
    expect(session.donorSearches).toBe(1);
  });
});
