/**
 * Warp engine — mesh-based image deformation.
 *
 * A rectangular grid of control points (rows+1 x cols+1) defines a mesh
 * that maps source image regions to deformed output positions.
 * Each cell is a quad defined by its four corner control points.
 * Rendering uses inverse bilinear interpolation to map output pixels
 * back to source coordinates.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface WarpMesh {
  /** Number of grid rows (cells). */
  rows: number;
  /** Number of grid columns (cells). */
  cols: number;
  /** Control points in row-major order: (rows+1) * (cols+1) points. */
  points: Point[];
  /** Original (undeformed) control points — same layout as `points`. */
  original: Point[];
}

// ---------------------------------------------------------------------------
// Mesh creation
// ---------------------------------------------------------------------------

/**
 * Create a uniform warp mesh for an image of given dimensions.
 * @param width  Source image width in pixels.
 * @param height Source image height in pixels.
 * @param rows   Number of grid rows (cells), e.g. 3.
 * @param cols   Number of grid columns (cells), e.g. 3.
 */
export function createWarpMesh(width: number, height: number, rows: number, cols: number): WarpMesh {
  const points: Point[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      points.push({ x: (c / cols) * width, y: (r / rows) * height });
    }
  }
  return {
    rows,
    cols,
    points,
    original: points.map((p) => ({ ...p })),
  };
}

/**
 * Get the control point at grid position (row, col).
 */
export function getMeshPoint(mesh: WarpMesh, row: number, col: number): Point {
  return mesh.points[row * (mesh.cols + 1) + col];
}

/**
 * Set the control point at grid position (row, col).
 */
export function setMeshPoint(mesh: WarpMesh, row: number, col: number, p: Point): void {
  mesh.points[row * (mesh.cols + 1) + col] = p;
}

/**
 * Get the original (undeformed) point at grid position (row, col).
 */
export function getOriginalPoint(mesh: WarpMesh, row: number, col: number): Point {
  return mesh.original[row * (mesh.cols + 1) + col];
}

/**
 * Find the closest control point to (px, py) within `threshold` pixels.
 * Returns the index into mesh.points, or -1 if none found.
 */
export function findNearestControlPoint(mesh: WarpMesh, px: number, py: number, threshold: number): number {
  let bestIdx = -1;
  let bestDist = threshold * threshold;
  for (let i = 0; i < mesh.points.length; i++) {
    const dx = mesh.points[i].x - px;
    const dy = mesh.points[i].y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Reset the mesh back to its undeformed state.
 */
export function resetMesh(mesh: WarpMesh): void {
  for (let i = 0; i < mesh.points.length; i++) {
    mesh.points[i] = { ...mesh.original[i] };
  }
}

// ---------------------------------------------------------------------------
// Perspective / 4-corner distort
// ---------------------------------------------------------------------------

/**
 * Apply a 4-corner perspective distort to a mesh by mapping the four mesh
 * corners to the given target positions. Interior points are bilinearly
 * interpolated from the corner displacements.
 */
export function applyPerspectiveDistort(mesh: WarpMesh, corners: { tl: Point; tr: Point; bl: Point; br: Point }): void {
  const { rows, cols } = mesh;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      // Bilinear interpolation of the four corners
      const x =
        (1 - u) * (1 - v) * corners.tl.x +
        u * (1 - v) * corners.tr.x +
        (1 - u) * v * corners.bl.x +
        u * v * corners.br.x;
      const y =
        (1 - u) * (1 - v) * corners.tl.y +
        u * (1 - v) * corners.tr.y +
        (1 - u) * v * corners.bl.y +
        u * v * corners.br.y;
      setMeshPoint(mesh, r, c, { x, y });
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering — forward mapping via sub-triangle rasterization
// ---------------------------------------------------------------------------

/**
 * Render a warped image from `source` onto `target` using the given mesh.
 *
 * For each mesh cell, we split it into two triangles and rasterize each
 * triangle by scanning output pixels and mapping back to source via
 * barycentric coordinates.
 */
export function renderWarp(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  mesh: WarpMesh,
): void {
  const tw = target.width;
  const th = target.height;
  const sw = source.width;
  const sh = source.height;

  const srcCtx = source.getContext("2d")!;
  const srcData = srcCtx.getImageData(0, 0, sw, sh);
  const srcPixels = srcData.data;

  const tgtCtx = target.getContext("2d")!;
  const tgtData = tgtCtx.createImageData(tw, th);
  const tgtPixels = tgtData.data;

  const { rows, cols } = mesh;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Deformed quad corners
      const p00 = getMeshPoint(mesh, r, c);
      const p10 = getMeshPoint(mesh, r, c + 1);
      const p01 = getMeshPoint(mesh, r + 1, c);
      const p11 = getMeshPoint(mesh, r + 1, c + 1);

      // Original (source) quad corners
      const s00 = getOriginalPoint(mesh, r, c);
      const s10 = getOriginalPoint(mesh, r, c + 1);
      const s01 = getOriginalPoint(mesh, r + 1, c);
      const s11 = getOriginalPoint(mesh, r + 1, c + 1);

      // Split into two triangles and rasterize each
      rasterizeTriangle(
        tgtPixels, tw, th, srcPixels, sw, sh,
        p00, p10, p01,
        s00, s10, s01,
      );
      rasterizeTriangle(
        tgtPixels, tw, th, srcPixels, sw, sh,
        p10, p11, p01,
        s10, s11, s01,
      );
    }
  }

  tgtCtx.putImageData(tgtData, 0, 0);
}

/**
 * Rasterize a single triangle defined by three destination vertices (d0, d1, d2)
 * mapping back to source vertices (s0, s1, s2) via barycentric coordinates.
 */
function rasterizeTriangle(
  tgtPixels: Uint8ClampedArray, tw: number, th: number,
  srcPixels: Uint8ClampedArray, sw: number, sh: number,
  d0: Point, d1: Point, d2: Point,
  s0: Point, s1: Point, s2: Point,
): void {
  // Bounding box of destination triangle
  const minX = Math.max(0, Math.floor(Math.min(d0.x, d1.x, d2.x)));
  const maxX = Math.min(tw - 1, Math.ceil(Math.max(d0.x, d1.x, d2.x)));
  const minY = Math.max(0, Math.floor(Math.min(d0.y, d1.y, d2.y)));
  const maxY = Math.min(th - 1, Math.ceil(Math.max(d0.y, d1.y, d2.y)));

  // Precompute barycentric denominator
  const denom = (d1.y - d2.y) * (d0.x - d2.x) + (d2.x - d1.x) * (d0.y - d2.y);
  if (Math.abs(denom) < 1e-10) return; // degenerate triangle
  const invDenom = 1 / denom;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Barycentric coordinates
      const w0 = ((d1.y - d2.y) * (px - d2.x) + (d2.x - d1.x) * (py - d2.y)) * invDenom;
      const w1 = ((d2.y - d0.y) * (px - d2.x) + (d0.x - d2.x) * (py - d2.y)) * invDenom;
      const w2 = 1 - w0 - w1;

      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;

      // Map to source
      const sx = w0 * s0.x + w1 * s1.x + w2 * s2.x;
      const sy = w0 * s0.y + w1 * s1.y + w2 * s2.y;

      // Bilinear sampling from source
      const fx = Math.max(0, Math.min(sw - 1, sx));
      const fy = Math.max(0, Math.min(sh - 1, sy));
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const dx = fx - ix;
      const dy = fy - iy;

      const ix1 = Math.min(ix + 1, sw - 1);
      const iy1 = Math.min(iy + 1, sh - 1);

      const i00 = (iy * sw + ix) * 4;
      const i10 = (iy * sw + ix1) * 4;
      const i01 = (iy1 * sw + ix) * 4;
      const i11 = (iy1 * sw + ix1) * 4;

      const tIdx = (py * tw + px) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const v =
          srcPixels[i00 + ch] * (1 - dx) * (1 - dy) +
          srcPixels[i10 + ch] * dx * (1 - dy) +
          srcPixels[i01 + ch] * (1 - dx) * dy +
          srcPixels[i11 + ch] * dx * dy;
        tgtPixels[tIdx + ch] = Math.round(v);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mesh grid drawing (for overlay)
// ---------------------------------------------------------------------------

/**
 * Draw the warp mesh grid lines and control point handles onto a canvas context.
 * @param ctx    The rendering context to draw on (already positioned).
 * @param mesh   The warp mesh.
 * @param scale  Display scale factor (for consistent handle sizes).
 * @param activePointIndex  Index of the actively dragged point, or -1.
 */
export function drawMeshOverlay(
  ctx: CanvasRenderingContext2D,
  mesh: WarpMesh,
  scale: number,
  activePointIndex: number,
): void {
  const { rows, cols } = mesh;

  // Grid lines
  ctx.strokeStyle = "rgba(0, 180, 255, 0.7)";
  ctx.lineWidth = 1 / scale;

  // Horizontal lines
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const p = getMeshPoint(mesh, r, c);
      if (c === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Vertical lines
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) {
      const p = getMeshPoint(mesh, r, c);
      if (r === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Control points
  const handleRadius = 4 / scale;
  for (let i = 0; i < mesh.points.length; i++) {
    const p = mesh.points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, handleRadius, 0, Math.PI * 2);
    if (i === activePointIndex) {
      ctx.fillStyle = "rgba(255, 255, 0, 0.9)";
    } else {
      ctx.fillStyle = "rgba(0, 180, 255, 0.9)";
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
  }
}
