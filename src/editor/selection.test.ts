import { describe, expect, it, vi } from "vitest";
import { defaultPolygonRotation, isAxisAlignedRectMarquee, traceMarqueeShape } from "./selection";

describe("selection marquee geometry", () => {
  it("treats the four-sided marquee as an axis-aligned rectangle", () => {
    expect(isAxisAlignedRectMarquee(4)).toBe(true);
    expect(isAxisAlignedRectMarquee(3)).toBe(false);
    expect(isAxisAlignedRectMarquee(11)).toBe(false);
  });

  it("draws the four-sided marquee with rect geometry instead of a rotated polygon", () => {
    const ctx = {
      beginPath: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    traceMarqueeShape(ctx, 25, 35, 15, 10, 4, defaultPolygonRotation(4), false);

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.rect).toHaveBeenCalledWith(10, 25, 30, 20);
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(ctx.closePath).not.toHaveBeenCalled();
  });

  it("can still trace a four-sided marquee as a rotated polygon when requested", () => {
    const ctx = {
      beginPath: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    traceMarqueeShape(ctx, 25, 35, 15, 15, 4, Math.PI / 4, true, false);

    expect(ctx.rect).not.toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(3);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it("still traces non-rectangular polygons with polygon vertices", () => {
    const ctx = {
      beginPath: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    traceMarqueeShape(ctx, 25, 35, 15, 10, 5, defaultPolygonRotation(5), false);

    expect(ctx.rect).not.toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(4);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });
});
