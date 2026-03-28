import { describe, expect, it } from "vitest";
import { createBlankDocument } from "./documents";
import { addLayer } from "./layers";
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCenterH, alignCenterV,
  distributeH, distributeV,
} from "./alignment";

function setup3(width = 400, height = 400) {
  const doc = createBlankDocument("Test", width, height, 100);
  const a = addLayer(doc, "A");
  const b = addLayer(doc, "B");
  const c = addLayer(doc, "C");
  // Position layers at different spots
  a.x = 10; a.y = 20; a.canvas.width = 50; a.canvas.height = 50;
  b.x = 100; b.y = 80; b.canvas.width = 60; b.canvas.height = 40;
  c.x = 200; c.y = 150; c.canvas.width = 80; c.canvas.height = 30;
  const ids = [a.id, b.id, c.id];
  return { doc, a, b, c, ids };
}

describe("alignment", () => {
  describe("align to selection bounds", () => {
    it("align left", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignLeft(doc, ids, "selection");
      expect(moved).toBe(true);
      expect(a.x).toBe(10);  // already leftmost
      expect(b.x).toBe(10);
      expect(c.x).toBe(10);
    });

    it("align right", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignRight(doc, ids, "selection");
      expect(moved).toBe(true);
      // rightmost edge = 200 + 80 = 280
      expect(a.x).toBe(280 - 50);  // 230
      expect(b.x).toBe(280 - 60);  // 220
      expect(c.x).toBe(280 - 80);  // 200 (unchanged)
    });

    it("align top", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignTop(doc, ids, "selection");
      expect(moved).toBe(true);
      expect(a.y).toBe(20);  // already topmost
      expect(b.y).toBe(20);
      expect(c.y).toBe(20);
    });

    it("align bottom", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignBottom(doc, ids, "selection");
      expect(moved).toBe(true);
      // bottommost edge = 150 + 30 = 180
      expect(a.y).toBe(180 - 50);  // 130
      expect(b.y).toBe(180 - 40);  // 140
      expect(c.y).toBe(180 - 30);  // 150 (unchanged)
    });

    it("align center horizontal", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignCenterH(doc, ids, "selection");
      expect(moved).toBe(true);
      // selection bounds x=10, width=270 (10→280), center = 145
      expect(a.x).toBe(Math.round(145 - 25));  // 120
      expect(b.x).toBe(Math.round(145 - 30));  // 115
      expect(c.x).toBe(Math.round(145 - 40));  // 105
    });

    it("align center vertical", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignCenterV(doc, ids, "selection");
      expect(moved).toBe(true);
      // selection bounds y=20, height=160 (20→180), center = 100
      expect(a.y).toBe(Math.round(100 - 25));  // 75
      expect(b.y).toBe(Math.round(100 - 20));  // 80 (unchanged)
      expect(c.y).toBe(Math.round(100 - 15));  // 85
    });
  });

  describe("align to canvas", () => {
    it("align left to canvas", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignLeft(doc, ids, "canvas");
      expect(moved).toBe(true);
      expect(a.x).toBe(0);
      expect(b.x).toBe(0);
      expect(c.x).toBe(0);
    });

    it("align right to canvas (400px wide)", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignRight(doc, ids, "canvas");
      expect(moved).toBe(true);
      expect(a.x).toBe(350);  // 400 - 50
      expect(b.x).toBe(340);  // 400 - 60
      expect(c.x).toBe(320);  // 400 - 80
    });

    it("align center H to canvas", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignCenterH(doc, ids, "canvas");
      expect(moved).toBe(true);
      // canvas center = 200
      expect(a.x).toBe(175);  // 200 - 25
      expect(b.x).toBe(170);  // 200 - 30
      expect(c.x).toBe(160);  // 200 - 40
    });

    it("align center V to canvas", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = alignCenterV(doc, ids, "canvas");
      expect(moved).toBe(true);
      // canvas center = 200
      expect(a.y).toBe(175);  // 200 - 25
      expect(b.y).toBe(180);  // 200 - 20
      expect(c.y).toBe(185);  // 200 - 15
    });
  });

  describe("distribute", () => {
    it("distribute horizontal spacing", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = distributeH(doc, ids);
      // Sorted by x: a(10,50), b(100,60), c(200,80)
      // total space = (200+80)-10 = 270
      // total widths = 50+60+80 = 190
      // gap = (270-190)/2 = 40
      // a stays at 10, b should be at 10+50+40=100 (already there), c stays at 200
      // Nothing actually moved since b was already at 100
      expect(moved).toBe(false);
      expect(a.x).toBe(10);
      expect(b.x).toBe(100);
      expect(c.x).toBe(200);
    });

    it("distribute horizontal actually moves layers", () => {
      const { doc, a, b, c, ids } = setup3();
      // Shift b out of position
      b.x = 50;
      const moved = distributeH(doc, ids);
      expect(moved).toBe(true);
      // Sorted by x: a(10,50), b(50,60), c(200,80)
      // total space = (200+80)-10 = 270
      // total widths = 50+60+80 = 190
      // gap = (270-190)/2 = 40
      // b should move to 10+50+40=100
      expect(a.x).toBe(10);
      expect(b.x).toBe(100);
      expect(c.x).toBe(200);
    });

    it("distribute vertical spacing", () => {
      const { doc, a, b, c, ids } = setup3();
      const moved = distributeV(doc, ids);
      expect(moved).toBe(true);
      // Sorted by y: a(20,50), b(80,40), c(150,30)
      // total space = (150+30)-20 = 160
      // total heights = 50+40+30 = 120
      // gap = (160-120)/2 = 20
      // a stays at 20, b → 20+50+20=90, c stays at 150
      expect(a.y).toBe(20);
      expect(b.y).toBe(90);
      expect(c.y).toBe(150);
    });

    it("needs at least 3 layers", () => {
      const doc = createBlankDocument("Test", 400, 400, 100);
      const a = addLayer(doc, "A");
      const b = addLayer(doc, "B");
      expect(distributeH(doc, [a.id, b.id])).toBe(false);
      expect(distributeV(doc, [a.id, b.id])).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("skips locked layers", () => {
      const { doc, a, b, c, ids } = setup3();
      b.locked = true;
      alignLeft(doc, ids, "canvas");
      expect(a.x).toBe(0);
      expect(b.x).toBe(100);  // unchanged, locked
      expect(c.x).toBe(0);
    });

    it("skips background layer", () => {
      const { doc, ids } = setup3();
      const bg = doc.layers[0];
      bg.x = 50;
      alignLeft(doc, [...ids, bg.id], "canvas");
      expect(bg.x).toBe(50);  // unchanged, background
    });

    it("returns false for empty layer list", () => {
      const { doc } = setup3();
      expect(alignLeft(doc, [], "canvas")).toBe(false);
    });

    it("returns false when no movement needed", () => {
      const { doc, a, b, ids } = setup3();
      a.x = 0; b.x = 0;
      // Only a and b, already at canvas left
      expect(alignLeft(doc, [a.id, b.id], "canvas")).toBe(false);
    });
  });
});
