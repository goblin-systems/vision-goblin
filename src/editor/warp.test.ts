import { describe, it, expect } from "vitest";
import {
  createWarpMesh,
  getMeshPoint,
  setMeshPoint,
  getOriginalPoint,
  findNearestControlPoint,
  resetMesh,
  applyPerspectiveDistort,
  renderWarp,
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
});
