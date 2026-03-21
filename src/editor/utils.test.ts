import { describe, expect, it } from "vitest";
import { clamp, fileNameFromPath, stripExtension } from "./utils";

describe("editor utils", () => {
  it("clamps values below minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps values above maximum", () => {
    expect(clamp(22, 0, 10)).toBe(10);
  });

  it("returns values already in range", () => {
    expect(clamp(7, 0, 10)).toBe(7);
  });

  it("extracts file names from windows paths", () => {
    expect(fileNameFromPath("C:\\temp\\image.png")).toBe("image.png");
  });

  it("extracts file names from unix paths", () => {
    expect(fileNameFromPath("/tmp/image.png")).toBe("image.png");
  });

  it("strips a simple extension", () => {
    expect(stripExtension("photo.jpg")).toBe("photo");
  });

  it("keeps names without extensions intact", () => {
    expect(stripExtension("README")).toBe("README");
  });

  it("removes only the last extension", () => {
    expect(stripExtension("archive.tar.gz")).toBe("archive.tar");
  });
});
