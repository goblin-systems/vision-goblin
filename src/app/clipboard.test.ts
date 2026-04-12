import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyDocumentToClipboard } from "./clipboard";
import { makeNewDocument } from "../editor/actions/documentActions";

class ClipboardItemMock {
  readonly items: Record<string, Blob>;

  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

describe("copyDocumentToClipboard", () => {
  beforeEach(() => {
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
  });

  it("writes a PNG clipboard item", async () => {
    const write = vi.fn(async (_items: ClipboardItemMock[]) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const doc = makeNewDocument("Doc", 3, 2, 100, "transparent");

    const copied = await copyDocumentToClipboard(doc);

    expect(copied).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]?.[0];
    expect(items).toBeDefined();
    expect(items).toHaveLength(1);
    expect(items?.[0]).toBeInstanceOf(ClipboardItemMock);
    expect(items?.[0].items["image/png"]?.type).toBe("image/png");
  });

  it("returns false when clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: vi.fn(async () => Promise.reject(new Error("blocked"))) },
    });
    const doc = makeNewDocument("Doc", 3, 2, 100, "transparent");

    await expect(copyDocumentToClipboard(doc)).resolves.toBe(false);
  });
});
