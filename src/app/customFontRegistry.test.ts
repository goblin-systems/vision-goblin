import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fontFamilyFromFileName,
  getCustomFonts,
  getCustomFontFamilies,
  registerCustomFont,
  _resetRegistryForTesting,
} from "./customFontRegistry";

// FontFace and document.fonts are not available in jsdom — mock them.
const mockFontFaceLoad = vi.fn().mockResolvedValue(undefined);
const mockFontFace = vi.fn().mockImplementation(() => ({
  load: mockFontFaceLoad,
}));
vi.stubGlobal("FontFace", mockFontFace);
const mockFontsAdd = vi.fn();
Object.defineProperty(document, "fonts", {
  value: { add: mockFontsAdd },
  writable: true,
});

describe("customFontRegistry", () => {
  beforeEach(() => {
    _resetRegistryForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetRegistryForTesting();
  });

  describe("fontFamilyFromFileName", () => {
    it("converts hyphenated file names to spaced family names", () => {
      expect(fontFamilyFromFileName("Fira-Code-Bold.ttf")).toBe("Fira Code Bold");
    });

    it("converts underscored file names to spaced family names", () => {
      expect(fontFamilyFromFileName("Open_Sans_Regular.otf")).toBe("Open Sans Regular");
    });

    it("handles .woff extension", () => {
      expect(fontFamilyFromFileName("MyFont.woff")).toBe("MyFont");
    });

    it("handles .woff2 extension", () => {
      expect(fontFamilyFromFileName("Inter-Variable.woff2")).toBe("Inter Variable");
    });

    it("returns 'Custom Font' for empty base name", () => {
      expect(fontFamilyFromFileName(".ttf")).toBe("Custom Font");
    });

    it("handles names with mixed separators and extra spaces", () => {
      expect(fontFamilyFromFileName("My--Cool__Font.otf")).toBe("My Cool Font");
    });

    it("passes through names without known extensions", () => {
      expect(fontFamilyFromFileName("NoExtension")).toBe("NoExtension");
    });
  });

  describe("getCustomFonts", () => {
    it("starts empty", () => {
      expect(getCustomFonts()).toEqual([]);
    });
  });

  describe("registerCustomFont", () => {
    it("adds an entry and returns the family name", async () => {
      const family = await registerCustomFont("Test Sans", "data:font/ttf;base64,AAA", "TestSans.ttf");

      expect(family).toBe("Test Sans");
      expect(getCustomFonts()).toHaveLength(1);
      expect(getCustomFonts()[0]).toEqual({
        family: "Test Sans",
        dataUrl: "data:font/ttf;base64,AAA",
        fileName: "TestSans.ttf",
      });
      expect(mockFontFace).toHaveBeenCalledWith("Test Sans", "url(data:font/ttf;base64,AAA)");
      expect(mockFontFaceLoad).toHaveBeenCalled();
      expect(mockFontsAdd).toHaveBeenCalled();
    });

    it("skips duplicate families", async () => {
      await registerCustomFont("Dupe Font", "data:font/ttf;base64,BBB", "Dupe.ttf");
      const second = await registerCustomFont("Dupe Font", "data:font/ttf;base64,CCC", "Dupe2.ttf");

      expect(second).toBe("Dupe Font");
      expect(getCustomFonts()).toHaveLength(1);
      // FontFace constructor should only have been called once
      expect(mockFontFace).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCustomFontFamilies", () => {
    it("returns family names only", async () => {
      await registerCustomFont("Alpha", "data:font/ttf;base64,A", "Alpha.ttf");
      await registerCustomFont("Beta", "data:font/otf;base64,B", "Beta.otf");

      expect(getCustomFontFamilies()).toEqual(["Alpha", "Beta"]);
    });
  });
});
