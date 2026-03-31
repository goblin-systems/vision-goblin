import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn(() => Promise.resolve("")));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { configureDebugLogging, saveAiDebugImage } from "./logger";

describe("saveAiDebugImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call invoke when debug logging is disabled", () => {
    saveAiDebugImage(
      "data:image/png;base64,iVBORw0KGgo=",
      "AI inpainting",
      "input",
      "image",
    );
    // Only configureDebugLogging would have called invoke, not saveAiDebugImage
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "save_ai_debug_image",
      expect.anything(),
    );
  });

  it("calls invoke with correct parameters when debug logging is enabled", async () => {
    await configureDebugLogging(true);
    mockInvoke.mockClear();

    saveAiDebugImage(
      "data:image/png;base64,iVBORw0KGgo=",
      "AI inpainting",
      "input",
      "image",
    );

    expect(mockInvoke).toHaveBeenCalledWith("save_ai_debug_image", {
      imageBase64: "iVBORw0KGgo=",
      jobName: "AI inpainting",
      direction: "input",
      label: "image",
    });
  });

  it("strips data:image/png;base64, prefix", async () => {
    await configureDebugLogging(true);
    mockInvoke.mockClear();

    saveAiDebugImage(
      "data:image/png;base64,AAAA",
      "test",
      "output",
      "result",
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      "save_ai_debug_image",
      expect.objectContaining({ imageBase64: "AAAA" }),
    );
  });

  it("strips data:image/webp;base64, prefix", async () => {
    await configureDebugLogging(true);
    mockInvoke.mockClear();

    saveAiDebugImage(
      "data:image/webp;base64,BBBB",
      "test",
      "output",
      "result",
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      "save_ai_debug_image",
      expect.objectContaining({ imageBase64: "BBBB" }),
    );
  });

  it("passes through raw base64 without a data URL prefix", async () => {
    await configureDebugLogging(true);
    mockInvoke.mockClear();

    saveAiDebugImage("iVBORw0KGgo=", "test", "input", "mask");

    expect(mockInvoke).toHaveBeenCalledWith(
      "save_ai_debug_image",
      expect.objectContaining({ imageBase64: "iVBORw0KGgo=" }),
    );
  });

  it("does not throw when invoke rejects", async () => {
    await configureDebugLogging(true);
    mockInvoke.mockClear();
    mockInvoke.mockRejectedValueOnce(new Error("disk full"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw
    saveAiDebugImage(
      "data:image/png;base64,AAAA",
      "test",
      "input",
      "image",
    );

    // Wait for the rejected promise to be caught
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to save AI debug image:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
