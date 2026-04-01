import { describe, it, expect } from "vitest";
import {
  createWarpMesh,
  getMeshPoint,
  setMeshPoint,
  getOriginalPoint,
  findNearestControlPoint,
  resetMesh,
  smoothMesh,
  applyPerspectiveDistort,
  renderWarp,
  WARP_PRESETS,
  type WarpMesh,
  type Point,
} from "./warp";

describe("warp", () => {
  describe("createWarpMesh", () => {
    it("creates correct number of control points", () => {
      const mesh = createWarpMesh(100, 100, 3, 3);
      expect(mesh.points.length).toBe(16); // (3+1) * (3+1)
      expect(mesh.original.length).toBe(16);
    });

    it("places corners at image boundaries", () => {
      const mesh = createWarpMesh(200, 150, 2, 4);
      const tl = getMeshPoint(mesh, 0, 0);
      const tr = getMeshPoint(mesh, 0, 4);
      const bl = getMeshPoint(mesh, 2, 0);
      const br = getMeshPoint(mesh, 2, 4);
      expect(tl).toEqual({ x: 0, y: 0 });
      expect(tr).toEqual({ x: 200, y: 0 });
      expect(bl).toEqual({ x: 0, y: 150 });
      expect(br).toEqual({ x: 200, y: 150 });
    });

    it("distributes interior points evenly", () => {
      const mesh = createWarpMesh(300, 200, 2, 3);
      const mid = getMeshPoint(mesh, 1, 1);
      expect(mid.x).toBeCloseTo(100);
      expect(mid.y).toBeCloseTo(100);
    });
  });

  describe("getMeshPoint / setMeshPoint", () => {
    it("gets and sets control points correctly", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      setMeshPoint(mesh, 1, 1, { x: 55, y: 60 });
      const p = getMeshPoint(mesh, 1, 1);
      expect(p).toEqual({ x: 55, y: 60 });
    });
  });

  describe("getOriginalPoint", () => {
    it("returns the original position even after modification", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      const original = getOriginalPoint(mesh, 1, 1);
      setMeshPoint(mesh, 1, 1, { x: 99, y: 99 });
      const stillOriginal = getOriginalPoint(mesh, 1, 1);
      expect(stillOriginal).toEqual(original);
    });
  });

  describe("findNearestControlPoint", () => {
    it("finds exact point", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      const idx = findNearestControlPoint(mesh, 50, 50, 10);
      expect(idx).toBeGreaterThanOrEqual(0);
      const p = mesh.points[idx];
      expect(p.x).toBeCloseTo(50);
      expect(p.y).toBeCloseTo(50);
    });

    it("returns -1 when no point is within threshold", () => {
      const mesh = createWarpMesh(100, 100, 1, 1);
      // Points are at (0,0), (100,0), (0,100), (100,100)
      const idx = findNearestControlPoint(mesh, 50, 50, 5);
      expect(idx).toBe(-1);
    });

    it("finds the closest point when multiple are within threshold", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      // Center point is at (50, 50)
      const idx = findNearestControlPoint(mesh, 48, 50, 20);
      const p = mesh.points[idx];
      expect(p.x).toBeCloseTo(50);
      expect(p.y).toBeCloseTo(50);
    });
  });

  describe("resetMesh", () => {
    it("restores all points to original positions", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      setMeshPoint(mesh, 1, 1, { x: 80, y: 80 });
      setMeshPoint(mesh, 0, 0, { x: 10, y: 10 });
      resetMesh(mesh);
      for (let i = 0; i < mesh.points.length; i++) {
        expect(mesh.points[i]).toEqual(mesh.original[i]);
      }
    });
  });

  describe("applyPerspectiveDistort", () => {
    it("sets corner points to target positions", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      const corners = {
        tl: { x: 10, y: 10 },
        tr: { x: 90, y: 5 },
        bl: { x: 5, y: 95 },
        br: { x: 95, y: 90 },
      };
      applyPerspectiveDistort(mesh, corners);
      const tl = getMeshPoint(mesh, 0, 0);
      const tr = getMeshPoint(mesh, 0, 2);
      const bl = getMeshPoint(mesh, 2, 0);
      const br = getMeshPoint(mesh, 2, 2);
      expect(tl.x).toBeCloseTo(10);
      expect(tl.y).toBeCloseTo(10);
      expect(tr.x).toBeCloseTo(90);
      expect(tr.y).toBeCloseTo(5);
      expect(bl.x).toBeCloseTo(5);
      expect(bl.y).toBeCloseTo(95);
      expect(br.x).toBeCloseTo(95);
      expect(br.y).toBeCloseTo(90);
    });

    it("interpolates interior points bilinearly", () => {
      const mesh = createWarpMesh(100, 100, 2, 2);
      // Uniform corners — center should be center of those 4 points
      const corners = {
        tl: { x: 0, y: 0 },
        tr: { x: 100, y: 0 },
        bl: { x: 0, y: 100 },
        br: { x: 100, y: 100 },
      };
      applyPerspectiveDistort(mesh, corners);
      const center = getMeshPoint(mesh, 1, 1);
      expect(center.x).toBeCloseTo(50);
      expect(center.y).toBeCloseTo(50);
    });
  });

  describe("renderWarp", () => {
    it("produces output canvas of same dimensions", () => {
      // Create a small 4x4 source
      const source = document.createElement("canvas");
      source.width = 4;
      source.height = 4;
      const sCtx = source.getContext("2d")!;
      sCtx.fillStyle = "red";
      sCtx.fillRect(0, 0, 4, 4);

      const target = document.createElement("canvas");
      target.width = 4;
      target.height = 4;

      const mesh = createWarpMesh(4, 4, 1, 1);
      renderWarp(source, target, mesh);

      // Target should have been written to
      const tCtx = target.getContext("2d")!;
      const data = tCtx.getImageData(0, 0, 4, 4).data;
      // Stub getImageData returns fixed 1-pixel data, so just verify it ran
      expect(data.length).toBeGreaterThan(0);
      // putImageData should have been called on the target context
      expect(tCtx.putImageData).toHaveBeenCalled();
    });

    it("runs without error on deformed mesh", () => {
      const source = document.createElement("canvas");
      source.width = 8;
      source.height = 8;

      const target = document.createElement("canvas");
      target.width = 8;
      target.height = 8;

      const mesh = createWarpMesh(8, 8, 2, 2);
      // Deform center point
      setMeshPoint(mesh, 1, 1, { x: 5, y: 5 });
      // Should not throw
      renderWarp(source, target, mesh);
    });
  });

  describe("warp presets", () => {
    const W = 200;
    const H = 150;
    const GRID = 4;

    function freshMesh(): WarpMesh {
      return createWarpMesh(W, H, GRID, GRID);
    }

    function meshPointsMatchOriginal(mesh: WarpMesh): boolean {
      for (let i = 0; i < mesh.points.length; i++) {
        if (
          Math.abs(mesh.points[i].x - mesh.original[i].x) > 1e-9 ||
          Math.abs(mesh.points[i].y - mesh.original[i].y) > 1e-9
        ) {
          return false;
        }
      }
      return true;
    }

    function distFromCentre(p: Point): number {
      const cx = W / 2;
      const cy = H / 2;
      return Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    }

    function angleFromCentre(p: Point): number {
      return Math.atan2(p.y - H / 2, p.x - W / 2);
    }

    describe("WARP_PRESETS array", () => {
      it("has 6 presets", () => {
        expect(WARP_PRESETS.length).toBe(6);
      });

      it("each preset has id, label, and apply function", () => {
        for (const preset of WARP_PRESETS) {
          expect(typeof preset.id).toBe("string");
          expect(preset.id.length).toBeGreaterThan(0);
          expect(typeof preset.label).toBe("string");
          expect(preset.label.length).toBeGreaterThan(0);
          expect(typeof preset.apply).toBe("function");
        }
      });

      it("each preset has a unique id", () => {
        const ids = WARP_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });

    describe("strength 0 leaves mesh unchanged", () => {
      for (const preset of WARP_PRESETS) {
        it(`${preset.id} at strength 0`, () => {
          const mesh = freshMesh();
          preset.apply(mesh, 0);
          expect(meshPointsMatchOriginal(mesh)).toBe(true);
        });
      }
    });

    describe("strength 50 modifies interior points", () => {
      for (const preset of WARP_PRESETS) {
        it(`${preset.id} at strength 50`, () => {
          const mesh = freshMesh();
          preset.apply(mesh, 50);
          expect(meshPointsMatchOriginal(mesh)).toBe(false);
        });
      }
    });

    describe("fisheye", () => {
      it("displaces interior points outward from centre", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "fisheye")!;
        // Record original distances for interior points (excluding exact centre)
        const interiorIndices: number[] = [];
        for (let r = 1; r < GRID; r++) {
          for (let c = 1; c < GRID; c++) {
            const idx = r * (GRID + 1) + c;
            if (distFromCentre(mesh.original[idx]) > 1e-6) {
              interiorIndices.push(idx);
            }
          }
        }
        expect(interiorIndices.length).toBeGreaterThan(0);
        const origDists = interiorIndices.map((i) => distFromCentre(mesh.original[i]));
        preset.apply(mesh, 50);
        const newDists = interiorIndices.map((i) => distFromCentre(mesh.points[i]));
        for (let i = 0; i < interiorIndices.length; i++) {
          expect(newDists[i]).toBeGreaterThan(origDists[i]);
        }
      });
    });

    describe("pinch", () => {
      it("displaces interior points inward toward centre", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "pinch")!;
        const interiorIndices: number[] = [];
        for (let r = 1; r < GRID; r++) {
          for (let c = 1; c < GRID; c++) {
            const idx = r * (GRID + 1) + c;
            if (distFromCentre(mesh.original[idx]) > 1e-6) {
              interiorIndices.push(idx);
            }
          }
        }
        expect(interiorIndices.length).toBeGreaterThan(0);
        const origDists = interiorIndices.map((i) => distFromCentre(mesh.original[i]));
        preset.apply(mesh, 50);
        const newDists = interiorIndices.map((i) => distFromCentre(mesh.points[i]));
        for (let i = 0; i < interiorIndices.length; i++) {
          expect(newDists[i]).toBeLessThan(origDists[i]);
        }
      });
    });

    describe("twist", () => {
      it("rotates points (angle changes, distance similar)", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "twist")!;
        // Pick an interior point that is not at the centre
        const idx = 2 * (GRID + 1) + 1; // row 2, col 1
        const origAngle = angleFromCentre(mesh.original[idx]);
        const origDist = distFromCentre(mesh.original[idx]);
        preset.apply(mesh, 50);
        const newAngle = angleFromCentre(mesh.points[idx]);
        const newDist = distFromCentre(mesh.points[idx]);
        expect(newAngle).not.toBeCloseTo(origAngle, 2);
        // Distance should remain similar (within 20% for moderate twist)
        expect(Math.abs(newDist - origDist) / origDist).toBeLessThan(0.01);
      });
    });

    describe("flag", () => {
      it("displaces points vertically only (x unchanged)", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "flag")!;
        preset.apply(mesh, 50);
        let anyYChanged = false;
        for (let i = 0; i < mesh.points.length; i++) {
          expect(mesh.points[i].x).toBeCloseTo(mesh.original[i].x, 9);
          if (Math.abs(mesh.points[i].y - mesh.original[i].y) > 1e-9) {
            anyYChanged = true;
          }
        }
        expect(anyYChanged).toBe(true);
      });
    });

    describe("wave", () => {
      it("displaces points horizontally only (y unchanged)", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "wave")!;
        preset.apply(mesh, 50);
        let anyXChanged = false;
        for (let i = 0; i < mesh.points.length; i++) {
          expect(mesh.points[i].y).toBeCloseTo(mesh.original[i].y, 9);
          if (Math.abs(mesh.points[i].x - mesh.original[i].x) > 1e-9) {
            anyXChanged = true;
          }
        }
        expect(anyXChanged).toBe(true);
      });
    });

    describe("bulge", () => {
      it("displaces centre-adjacent points outward with falloff", () => {
        const mesh = freshMesh();
        const preset = WARP_PRESETS.find((p) => p.id === "bulge")!;
        // Pick a near-centre point that is NOT exactly at centre
        // row 2, col 1 on a 4-grid 200x150 mesh = (50, 75) — not at centre (100, 75)
        const nearIdx = 2 * (GRID + 1) + 1;
        const farIdx = 0 * (GRID + 1) + 0;  // row 0, col 0 — top-left corner
        const nearOrigDist = distFromCentre(mesh.original[nearIdx]);
        const farOrigDist = distFromCentre(mesh.original[farIdx]);
        expect(nearOrigDist).toBeGreaterThan(0);
        expect(farOrigDist).toBeGreaterThan(0);
        preset.apply(mesh, 50);
        const nearNewDist = distFromCentre(mesh.points[nearIdx]);
        const farNewDist = distFromCentre(mesh.points[farIdx]);
        const nearDisplacement = nearNewDist - nearOrigDist;
        const farDisplacement = farNewDist - farOrigDist;
        // Near-centre points should be displaced outward more than far points
        expect(nearDisplacement).toBeGreaterThan(0);
        // Gaussian falloff means centre-adjacent displacement > corner displacement ratio
        // (the corner is at maxR so its Gaussian weight is smallest)
        expect(nearDisplacement).toBeGreaterThan(farDisplacement);
      });
    });
  });

  describe("smoothMesh", () => {
    const W = 200;
    const H = 150;
    const GRID = 4;

    function freshMesh(): WarpMesh {
      return createWarpMesh(W, H, GRID, GRID);
    }

    it("smoothness 0 leaves mesh unchanged", () => {
      const mesh = freshMesh();
      // Displace an interior point
      const idx = 2 * (GRID + 1) + 2; // row 2, col 2 — interior
      mesh.points[idx] = { x: mesh.points[idx].x + 20, y: mesh.points[idx].y + 15 };
      const before = mesh.points.map((p) => ({ ...p }));
      smoothMesh(mesh, 0);
      for (let i = 0; i < mesh.points.length; i++) {
        expect(mesh.points[i].x).toBe(before[i].x);
        expect(mesh.points[i].y).toBe(before[i].y);
      }
    });

    it("smoothness > 0 smooths interior point displacements", () => {
      const mesh = freshMesh();
      // Displace a single interior point
      const idx = 2 * (GRID + 1) + 2; // row 2, col 2
      const origX = mesh.original[idx].x;
      const origY = mesh.original[idx].y;
      mesh.points[idx] = { x: origX + 40, y: origY + 30 };
      smoothMesh(mesh, 50); // 5 iterations
      // The displacement should be reduced (pulled back toward neighbours which have 0 displacement)
      const newDx = Math.abs(mesh.points[idx].x - origX);
      const newDy = Math.abs(mesh.points[idx].y - origY);
      expect(newDx).toBeLessThan(40);
      expect(newDy).toBeLessThan(30);
    });

    it("boundary points are never modified", () => {
      const mesh = freshMesh();
      // Displace ALL points
      for (let i = 0; i < mesh.points.length; i++) {
        mesh.points[i] = { x: mesh.points[i].x + 10, y: mesh.points[i].y + 5 };
      }
      // Snapshot boundary points before smoothing
      const boundaryBefore: { idx: number; x: number; y: number }[] = [];
      for (let r = 0; r <= GRID; r++) {
        for (let c = 0; c <= GRID; c++) {
          if (r === 0 || r === GRID || c === 0 || c === GRID) {
            const idx = r * (GRID + 1) + c;
            boundaryBefore.push({ idx, x: mesh.points[idx].x, y: mesh.points[idx].y });
          }
        }
      }
      smoothMesh(mesh, 100); // 10 iterations — maximum smoothing
      for (const bp of boundaryBefore) {
        expect(mesh.points[bp.idx].x).toBe(bp.x);
        expect(mesh.points[bp.idx].y).toBe(bp.y);
      }
    });

    it("higher smoothness produces more averaging", () => {
      // Test with smoothness 20 vs 80
      const meshLow = freshMesh();
      const meshHigh = freshMesh();
      const idx = 2 * (GRID + 1) + 2; // interior point
      const origX = meshLow.original[idx].x;
      const origY = meshLow.original[idx].y;
      meshLow.points[idx] = { x: origX + 40, y: origY + 30 };
      meshHigh.points[idx] = { x: origX + 40, y: origY + 30 };

      smoothMesh(meshLow, 20);  // 2 iterations
      smoothMesh(meshHigh, 80); // 8 iterations

      const lowDx = Math.abs(meshLow.points[idx].x - origX);
      const highDx = Math.abs(meshHigh.points[idx].x - origX);
      const lowDy = Math.abs(meshLow.points[idx].y - origY);
      const highDy = Math.abs(meshHigh.points[idx].y - origY);

      // Higher smoothness means the displacement is averaged more, so closer to 0
      expect(highDx).toBeLessThan(lowDx);
      expect(highDy).toBeLessThan(lowDy);
    });

    it("smoothing preserves mesh structure", () => {
      const mesh = freshMesh();
      const origLength = mesh.points.length;
      const origRows = mesh.rows;
      const origCols = mesh.cols;
      // Displace some points
      mesh.points[6] = { x: mesh.points[6].x + 15, y: mesh.points[6].y - 10 };
      mesh.points[8] = { x: mesh.points[8].x - 5, y: mesh.points[8].y + 20 };
      smoothMesh(mesh, 60);
      expect(mesh.rows).toBe(origRows);
      expect(mesh.cols).toBe(origCols);
      expect(mesh.points.length).toBe(origLength);
    });
  });
});
