import { describe, expect, it } from "vitest";
import { createWarpMesh } from "../editor/warp";
import { getDistortSessionError, isWarpMeshModified } from "./distortModalController";

describe("distortModalController helpers", () => {
  it("guards unsupported layer types before opening distort sessions", () => {
    expect(getDistortSessionError(null)).toBe("No active layer");
    expect(getDistortSessionError({ type: "adjustment" } as never, "warp")).toBe("Cannot warp adjustment layers");
    expect(getDistortSessionError({ type: "smart-object" } as never)).toBe("Rasterize smart object first");
    expect(getDistortSessionError({ type: "raster" } as never)).toBeNull();
  });

  it("detects whether a warp mesh has changed meaningfully", () => {
    const mesh = createWarpMesh(100, 80, 2, 2);

    expect(isWarpMeshModified(mesh)).toBe(false);

    mesh.points[0] = { x: mesh.points[0].x + 1, y: mesh.points[0].y };
    expect(isWarpMeshModified(mesh)).toBe(true);
  });
});
