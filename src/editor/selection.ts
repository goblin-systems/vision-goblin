/**
 * Selection utilities — mask-based selection system.
 *
 * The selection mask is an HTMLCanvasElement the same size as the document.
 * White pixels (#fff, alpha=255) are selected, transparent pixels are not.
 * All selection operations (marquee, lasso, magic wand, add/subtract/intersect)
 * modify the mask. The mask is the source of truth for compound selections.
 */

import type { Rect, SelectionPath } from "./types";

export interface SelectionTransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
}

// ---------------------------------------------------------------------------
// Mask creation
// ---------------------------------------------------------------------------

export function createMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function cloneMaskCanvas(mask: HTMLCanvasElement): HTMLCanvasElement {
  const clone = createMaskCanvas(mask.width, mask.height);
  clone.getContext("2d")?.drawImage(mask, 0, 0);
  return clone;
}

export function normalizeSelectionToMask(
  width: number,
  height: number,
  selectionRect: Rect | null,
  selectionShape: "rect" | "ellipse",
  selectionPath: SelectionPath | null,
  selectionMask: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  if (selectionMask) {
    return cloneMaskCanvas(selectionMask);
  }
  if (selectionPath?.closed && selectionPath.points.length >= 3) {
    const mask = createMaskCanvas(width, height);
    rasterizePathToMask(mask, selectionPath);
    return mask;
  }
  if (!selectionRect || selectionRect.width <= 0 || selectionRect.height <= 0) {
    return null;
  }
  const mask = createMaskCanvas(width, height);
  rasterizeRectToMask(mask, selectionRect, selectionShape === "ellipse" ? 11 : 4);
  return mask;
}

export function transformMaskInDocumentSpace(
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  matrix: SelectionTransformMatrix,
  pivotX: number,
  pivotY: number,
): HTMLCanvasElement {
  const transformed = createMaskCanvas(width, height);
  const ctx = transformed.getContext("2d");
  if (!ctx) {
    return transformed;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    pivotX - matrix.a * pivotX - matrix.c * pivotY,
    pivotY - matrix.b * pivotX - matrix.d * pivotY,
  );
  ctx.drawImage(mask, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return transformed;
}

// ---------------------------------------------------------------------------
// Rasterize shapes onto a mask (fills white where selected)
// ---------------------------------------------------------------------------

/**
 * Default rotation for a polygon so that:
 * - odd-sided: pointy vertex at the top (-π/2)
 * - even-sided: flat edge at the top (-π/2 + π/sides)
 */
export function defaultPolygonRotation(sides: number): number {
  if (sides > 10) return 0;
  return sides % 2 === 0
    ? -Math.PI / 2 + Math.PI / sides
    : -Math.PI / 2;
}

export function isAxisAlignedRectMarquee(sides: number): boolean {
  return sides === 4;
}

/**
 * Trace a regular polygon path (or ellipse when sides > 10) onto a context.
 * When `perfect` is true (default), both radii use min(rx, ry) so the polygon
 * is inscribed in a circle. When false, it follows the full ellipse.
 */
export function traceMarqueeShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  sides: number, rotation = defaultPolygonRotation(sides), perfect = true, axisAlignedRect = isAxisAlignedRectMarquee(sides),
) {
  const actualRx = perfect ? Math.min(rx, ry) : rx;
  const actualRy = perfect ? Math.min(rx, ry) : ry;
  ctx.beginPath();
  if (sides > 10) {
    ctx.ellipse(cx, cy, Math.max(0, actualRx), Math.max(0, actualRy), 0, 0, Math.PI * 2);
  } else if (isAxisAlignedRectMarquee(sides) && axisAlignedRect) {
    ctx.rect(cx - actualRx, cy - actualRy, Math.max(0, actualRx * 2), Math.max(0, actualRy * 2));
  } else {
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (Math.PI * 2 * i) / sides;
      const px = cx + actualRx * Math.cos(angle);
      const py = cy + actualRy * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}

export const SHAPE_NAMES: Record<number, string> = {
  3: "Triangle",
  4: "Square",
  5: "Pentagon",
  6: "Hexagon",
  7: "Heptagon",
  8: "Octagon",
  9: "Nonagon",
  10: "Decagon",
  11: "Ellipse",
};

export function rasterizeRectToMask(
  mask: HTMLCanvasElement, rect: Rect,
  sides: number, rotation = defaultPolygonRotation(sides), perfect = true, axisAlignedRect = isAxisAlignedRectMarquee(sides),
) {
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#fff";
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  traceMarqueeShape(ctx, cx, cy, rx, ry, sides, rotation, perfect, axisAlignedRect);
  ctx.fill();
}

export function rasterizePathToMask(mask: HTMLCanvasElement, path: SelectionPath) {
  if (!path.closed || path.points.length < 3) return;
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < path.points.length; i++) {
    ctx.lineTo(path.points[i].x, path.points[i].y);
  }
  ctx.closePath();
  ctx.fill();
}

export function rasterizeFloodFillToMask(
  mask: HTMLCanvasElement,
  binaryMask: Uint8Array,
  maskW: number,
  maskH: number,
  offsetX: number,
  offsetY: number
) {
  const ctx = mask.getContext("2d")!;
  const imageData = ctx.createImageData(maskW, maskH);
  const d = imageData.data;
  for (let i = 0; i < binaryMask.length; i++) {
    if (binaryMask[i]) {
      const p = i * 4;
      d[p] = 255;
      d[p + 1] = 255;
      d[p + 2] = 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(imageData, offsetX, offsetY);
}

// ---------------------------------------------------------------------------
// Combine masks with boolean operations
// ---------------------------------------------------------------------------

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

export function combineMasks(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  mode: SelectionMode
) {
  const ctx = target.getContext("2d")!;
  switch (mode) {
    case "replace":
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(source, 0, 0);
      break;
    case "add":
      // Union: draw source on top (any white from either stays white)
      ctx.drawImage(source, 0, 0);
      break;
    case "subtract":
      // Remove source from target: destination-out
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(source, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      break;
    case "intersect":
      // Keep only where both overlap: destination-in
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(source, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      break;
  }
}

// ---------------------------------------------------------------------------
// Mask queries
// ---------------------------------------------------------------------------

export function maskBoundingRect(mask: HTMLCanvasElement): Rect | null {
  const ctx = mask.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, mask.width, mask.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function maskContainsRect(mask: HTMLCanvasElement, rect: Rect): boolean {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(mask.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(mask.height, Math.ceil(rect.y + rect.height));
  if (endX <= startX || endY <= startY) {
    return false;
  }
  const ctx = mask.getContext("2d")!;
  const { data, width } = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        return true;
      }
    }
  }
  return false;
}

export function isMaskEmpty(mask: HTMLCanvasElement): boolean {
  const ctx = mask.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return false;
  }
  return true;
}

export function isPointInMask(mask: HTMLCanvasElement, x: number, y: number): boolean {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  const ctx = mask.getContext("2d")!;
  return ctx.getImageData(px, py, 1, 1).data[3] > 0;
}

export function invertMask(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, mask.width, mask.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const wasSelected = d[i + 3] > 0;
    d[i] = wasSelected ? 0 : 255;
    d[i + 1] = wasSelected ? 0 : 255;
    d[i + 2] = wasSelected ? 0 : 255;
    d[i + 3] = wasSelected ? 0 : 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function fillMask(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, mask.width, mask.height);
}

// ---------------------------------------------------------------------------
// Mask-based clipping for paint operations
// ---------------------------------------------------------------------------

let _clipTmp: HTMLCanvasElement | null = null;

function getClipTmp(w: number, h: number): HTMLCanvasElement {
  if (!_clipTmp || _clipTmp.width !== w || _clipTmp.height !== h) {
    _clipTmp = createMaskCanvas(w, h);
  }
  return _clipTmp;
}

/**
 * Apply mask-based clipping for a paint operation.
 * Draws `drawFn` onto a temp canvas, composites through the mask, then onto the layer.
 * `drawFn` receives a context in layer-local coordinates.
 */
export function drawThroughMask(
  layerCtx: CanvasRenderingContext2D,
  layerWidth: number,
  layerHeight: number,
  mask: HTMLCanvasElement,
  inverted: boolean,
  layerX: number,
  layerY: number,
  drawFn: (ctx: CanvasRenderingContext2D) => void,
  layerCompositeOperation: GlobalCompositeOperation = "source-over",
) {
  const tmp = getClipTmp(layerWidth, layerHeight);
  const tmpCtx = tmp.getContext("2d")!;
  tmpCtx.clearRect(0, 0, layerWidth, layerHeight);

  // Draw the stroke onto temp canvas
  tmpCtx.save();
  drawFn(tmpCtx);
  tmpCtx.restore();

  // Apply mask: keep stroke only where mask is white (or inverse)
  tmpCtx.save();
  tmpCtx.globalCompositeOperation = inverted ? "destination-out" : "destination-in";
  tmpCtx.drawImage(mask, -layerX, -layerY);
  tmpCtx.restore();

  // Composite result onto layer
  layerCtx.save();
  layerCtx.globalCompositeOperation = layerCompositeOperation;
  layerCtx.drawImage(tmp, 0, 0);
  layerCtx.restore();
}

// ---------------------------------------------------------------------------
// Multi-contour tracing from mask (for marching ants rendering)
// ---------------------------------------------------------------------------

/**
 * Trace all contour boundaries from a selection mask.
 * Returns an array of closed polygon paths (in document coordinates).
 * Handles outer boundaries, holes, and disconnected regions.
 */
export function traceMaskContours(mask: HTMLCanvasElement): Array<Array<{ x: number; y: number }>> {
  const ctx = mask.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, mask.width, mask.height);

  // Binary sample: 1 if selected, 0 otherwise. Out-of-bounds = 0.
  const s = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return data[(y * width + x) * 4 + 3] > 0 ? 1 : 0;
  };

  // Track visited edges. Each cell (cx, cy) can have up to 2 segments.
  // We track by entry edge: `${cx},${cy},${entryEdge}`
  const visited = new Set<string>();
  const contours: Array<Array<{ x: number; y: number }>> = [];

  // Edge midpoint coordinates for cell (cx, cy):
  // top=0: (cx+0.5, cy), right=1: (cx+1, cy+0.5), bottom=2: (cx+0.5, cy+1), left=3: (cx, cy+0.5)
  const edgeMidpoint = (cx: number, cy: number, edge: number): { x: number; y: number } => {
    switch (edge) {
      case 0: return { x: cx + 0.5, y: cy };
      case 1: return { x: cx + 1, y: cy + 0.5 };
      case 2: return { x: cx + 0.5, y: cy + 1 };
      case 3: return { x: cx, y: cy + 0.5 };
      default: return { x: cx + 0.5, y: cy + 0.5 };
    }
  };

  // Opposite edge when moving to a neighbor cell
  const oppositeEdge = [2, 3, 0, 1]; // top↔bottom, right↔left

  // Neighbor cell when exiting through an edge
  const neighborDelta = [
    [0, -1],  // exit top → cell above
    [1, 0],   // exit right → cell to right
    [0, 1],   // exit bottom → cell below
    [-1, 0],  // exit left → cell to left
  ];

  // For each case, map entry edge → exit edge
  // Cases are computed from 4 corners: TL*8 + TR*4 + BR*2 + BL
  // Edges: 0=top, 1=right, 2=bottom, 3=left
  // Segments go from low-value to high-value side
  const caseExitMap: Record<number, Record<number, number>> = {
    1:  { 3: 2, 2: 3 },         // BL only
    2:  { 2: 1, 1: 2 },         // BR only
    3:  { 3: 1, 1: 3 },         // BL+BR
    4:  { 0: 1, 1: 0 },         // TR only
    5:  { 3: 0, 0: 3, 2: 1, 1: 2 }, // saddle: TL=0 TR=1 BR=0 BL=1
    6:  { 0: 2, 2: 0 },         // TR+BR
    7:  { 3: 0, 0: 3 },         // TR+BR+BL
    8:  { 0: 3, 3: 0 },         // TL only
    9:  { 0: 2, 2: 0 },         // TL+BL
    10: { 0: 1, 1: 0, 2: 3, 3: 2 }, // saddle: TL=1 TR=0 BR=1 BL=0
    11: { 0: 1, 1: 0 },         // TL+BL+BR
    12: { 3: 1, 1: 3 },         // TL+TR
    13: { 2: 1, 1: 2 },         // TL+TR+BL
    14: { 3: 2, 2: 3 },         // TL+TR+BR
  };

  // Iterate all cells. Cell (cx, cy) has corners at pixels (cx-1,cy-1), (cx,cy-1), (cx,cy), (cx-1,cy).
  for (let cy = 0; cy <= height; cy++) {
    for (let cx = 0; cx <= width; cx++) {
      const tl = s(cx - 1, cy - 1);
      const tr = s(cx, cy - 1);
      const br = s(cx, cy);
      const bl = s(cx - 1, cy);
      const caseIdx = tl * 8 + tr * 4 + br * 2 + bl;
      if (caseIdx === 0 || caseIdx === 15) continue;

      const exitMap = caseExitMap[caseIdx];
      if (!exitMap) continue;

      // Try each possible entry edge for this cell
      for (const entryStr of Object.keys(exitMap)) {
        const entry = Number(entryStr);
        const key = `${cx},${cy},${entry}`;
        if (visited.has(key)) continue;

        // Trace contour starting here
        const points: Array<{ x: number; y: number }> = [];
        let curCx = cx, curCy = cy, curEntry = entry;

        for (let step = 0; step < (width + 1) * (height + 1) * 4; step++) {
          const k = `${curCx},${curCy},${curEntry}`;
          if (visited.has(k)) {
            if (curCx === cx && curCy === cy && curEntry === entry && points.length > 0) {
              // Completed the loop
            }
            break;
          }
          visited.add(k);

          const curCase = s(curCx - 1, curCy - 1) * 8 + s(curCx, curCy - 1) * 4 + s(curCx, curCy) * 2 + s(curCx - 1, curCy);
          if (curCase === 0 || curCase === 15) break;

          const curExitMap = caseExitMap[curCase];
          if (!curExitMap || curExitMap[curEntry] === undefined) break;

          const exitEdge = curExitMap[curEntry];
          points.push(edgeMidpoint(curCx, curCy, exitEdge));

          // Move to neighbor cell
          const [ndx, ndy] = neighborDelta[exitEdge];
          curCx += ndx;
          curCy += ndy;
          curEntry = oppositeEdge[exitEdge];
        }

        if (points.length >= 3) {
          contours.push(points);
        }
      }
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Legacy helpers (still used by some code paths)
// ---------------------------------------------------------------------------

export function pathBoundingRect(path: SelectionPath): Rect {
  if (path.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of path.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
  };
}

export function traceSelectionPath(ctx: CanvasRenderingContext2D, path: SelectionPath, offsetX = 0, offsetY = 0) {
  if (path.points.length < 2) return;
  ctx.moveTo(path.points[0].x + offsetX, path.points[0].y + offsetY);
  for (let i = 1; i < path.points.length; i++) {
    ctx.lineTo(path.points[i].x + offsetX, path.points[i].y + offsetY);
  }
  if (path.closed) {
    ctx.closePath();
  }
}

export function applySelectionClip(
  ctx: CanvasRenderingContext2D,
  selectionRect: Rect,
  selectionShape: "rect" | "ellipse",
  selectionInverted: boolean,
  selectionPath: SelectionPath | null,
  layerX: number,
  layerY: number,
  layerWidth: number,
  layerHeight: number
) {
  const sx = selectionRect.x - layerX;
  const sy = selectionRect.y - layerY;
  const sw = selectionRect.width;
  const sh = selectionRect.height;

  if (selectionInverted) {
    ctx.beginPath();
    ctx.rect(0, 0, layerWidth, layerHeight);
    if (selectionPath && selectionPath.closed) {
      traceSelectionPath(ctx, selectionPath, -layerX, -layerY);
    } else if (selectionShape === "ellipse") {
      ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(sx, sy, sw, sh);
    }
    ctx.clip("evenodd");
  } else {
    ctx.beginPath();
    if (selectionPath && selectionPath.closed) {
      traceSelectionPath(ctx, selectionPath, -layerX, -layerY);
    } else if (selectionShape === "ellipse") {
      ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(sx, sy, sw, sh);
    }
    ctx.clip();
  }
}

export function isPointInPath(x: number, y: number, path: SelectionPath): boolean {
  if (!path.closed || path.points.length < 3) return false;
  const pts = path.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function simplifyPath(points: Array<{ x: number; y: number }>, minDistance = 2): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const result = [points[0]];
  const minDist2 = minDistance * minDistance;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const dx = points[i].x - prev.x;
    const dy = points[i].y - prev.y;
    if (dx * dx + dy * dy >= minDist2) {
      result.push(points[i]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

export function serializeMask(mask: HTMLCanvasElement): string {
  return mask.toDataURL("image/png");
}

export function deserializeMask(dataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = createMaskCanvas(width, height);
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => {
      resolve(createMaskCanvas(width, height));
    };
    img.src = dataUrl;
  });
}
