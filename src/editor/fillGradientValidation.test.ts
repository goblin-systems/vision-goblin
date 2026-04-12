import { describe, expect, it } from "vitest";
import { getFillGradientNoOverlapMessage, getFillGradientSelectionRequiredMessage, getFillGradientTargetError } from "./fillGradientValidation";

describe("fillGradientValidation", () => {
  it("keeps equivalent fill and gradient selection copy aligned", () => {
    expect(getFillGradientSelectionRequiredMessage("fill")).toBe("Create a selection before using Fill");
    expect(getFillGradientSelectionRequiredMessage("gradient")).toBe("Create a selection before using Gradient");
    expect(getFillGradientNoOverlapMessage()).toBe("Selection does not overlap the active layer");
  });

  it("keeps raster target validation copy aligned across fill and gradient", () => {
    expect(getFillGradientTargetError("fill", null)).toBe("Select a raster layer to fill");
    expect(getFillGradientTargetError("gradient", null)).toBe("Select a raster layer to apply a gradient");
    expect(getFillGradientTargetError("fill", { type: "text", locked: false } as never)).toBe("Select a raster layer to fill");
    expect(getFillGradientTargetError("gradient", { type: "text", locked: false } as never)).toBe("Select a raster layer to apply a gradient");
    expect(getFillGradientTargetError("fill", { type: "raster", locked: true } as never)).toBe("Unlock the active layer before filling");
    expect(getFillGradientTargetError("gradient", { type: "raster", locked: true } as never)).toBe("Unlock the active layer before applying a gradient");
  });
});
