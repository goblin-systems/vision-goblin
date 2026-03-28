import { describe, expect, it } from "vitest";
import { pathBoundingRect, isPointInPath, simplifyPath } from "./selection";
import type { SelectionPath } from "./types";

describe("pathBoundingRect", () => {
  it("computes bounding rect of a triangle", () => {
    const path: SelectionPath = { points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 30, y: 60 }], closed: true };
    const rect = pathBoundingRect(path);
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(40);
  });

  it("returns zero rect for empty path", () => {
    const rect = pathBoundingRect({ points: [], closed: false });
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });
});

describe("isPointInPath", () => {
  const square: SelectionPath = {
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    closed: true,
  };

  it("returns true for point inside", () => {
    expect(isPointInPath(50, 50, square)).toBe(true);
  });

  it("returns false for point outside", () => {
    expect(isPointInPath(150, 50, square)).toBe(false);
  });

  it("returns false for open path", () => {
    expect(isPointInPath(50, 50, { ...square, closed: false })).toBe(false);
  });

  it("returns false for too few points", () => {
    expect(isPointInPath(50, 50, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: true })).toBe(false);
  });
});

describe("simplifyPath", () => {
  it("removes points closer than minDistance", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 }, // too close
      { x: 1, y: 1 },     // too close
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    const result = simplifyPath(points, 3);
    expect(result.length).toBeLessThan(points.length);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 20, y: 20 });
  });

  it("keeps all points if distance is large enough", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    expect(simplifyPath(points, 1)).toHaveLength(3);
  });
});
