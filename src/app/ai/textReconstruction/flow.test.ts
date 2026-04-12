import { describe, expect, it, vi } from "vitest";

vi.mock("../editingSupport", () => ({
  buildInpaintingTask: vi.fn((img: unknown, mask: unknown, prompt: string, mode: string) => ({
    id: "task-inpaint-1",
    family: "inpainting",
    prompt,
    input: { image: img, mask },
    options: { mode },
  })),
  buildTextReplacementTask: vi.fn((img: unknown, mask: unknown, prompt: string) => ({
    id: "task-replace-1",
    family: "text-replacement",
    prompt,
    input: { image: img, mask },
  })),
  getJsonArtifact: vi.fn(),
  getImageArtifact: vi.fn(),
}));

vi.mock("../prompts", () => ({
  RASTER_TEXT_CLEANUP_PROMPT: "mock cleanup prompt",
  buildStructuredTextReconstructionPrompt: vi.fn(() => "mock reconstruction prompt"),
}));

vi.mock("./schema", () => ({
  parseStructuredTextReconstructionJson: vi.fn(),
}));

import { runTwoStageTextReplacement } from "./flow";
import { buildInpaintingTask, buildTextReplacementTask, getJsonArtifact, getImageArtifact } from "../editingSupport";
import { parseStructuredTextReconstructionJson } from "./schema";
import type { Mock } from "vitest";

function makeResponse(warnings: string[] = []) {
  return { jobId: "j-1", artifacts: [], warnings };
}

function makeImageAsset() {
  return { kind: "image" as const, mimeType: "image/png", data: "data:image/png;base64,AAA", width: 100, height: 50 };
}

function makeMaskAsset() {
  return { kind: "mask" as const, mimeType: "image/png", data: "data:image/png;base64,BBB", width: 100, height: 50 };
}

function makeImageArtifact() {
  return { kind: "image" as const, mimeType: "image/png", data: "data:image/png;base64,CCC", width: 100, height: 50, purpose: "inpainted" as const };
}

function makeDeps() {
  return {
    runTask: vi.fn(),
    showToast: vi.fn(),
  };
}

describe("runTwoStageTextReplacement", () => {
  it("returns cleaned image and parsed blocks when both stages succeed", async () => {
    const deps = makeDeps();
    const inpaintingResponse = makeResponse();
    const reconstructionResponse = makeResponse();
    deps.runTask.mockResolvedValueOnce(inpaintingResponse);
    deps.runTask.mockResolvedValueOnce(reconstructionResponse);
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    (getJsonArtifact as Mock).mockReturnValueOnce({ text: '{"valid": true}', role: "text-reconstruction" });
    (parseStructuredTextReconstructionJson as Mock).mockReturnValueOnce({
      ok: true,
      blocks: [{ id: "b1", text: "Hello", bounds: { x: 0, y: 0, width: 50, height: 20 } }],
      warnings: [],
    });

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.cleanedImageArtifact).toBeDefined();
    expect(result.cleanedImageArtifact?.purpose).toBe("inpainted");
    expect(deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("stage 1 uses inpainting task family, stage 2 uses text-replacement task family", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse());
    deps.runTask.mockResolvedValueOnce(makeResponse());
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    (getJsonArtifact as Mock).mockReturnValueOnce({ text: '{"ok": true}', role: "text-reconstruction" });
    (parseStructuredTextReconstructionJson as Mock).mockReturnValueOnce({
      ok: true,
      blocks: [],
      warnings: [],
    });

    await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    // Stage 1: inpainting
    const stage1Task = (deps.runTask as Mock).mock.calls[0][1].task;
    expect(stage1Task.family).toBe("inpainting");
    expect(stage1Task.options.mode).toBe("remove");
    expect(buildInpaintingTask).toHaveBeenCalledWith(
      makeImageAsset(),
      makeMaskAsset(),
      "mock cleanup prompt",
      "remove",
    );

    // Stage 2: text-replacement
    const stage2Task = (deps.runTask as Mock).mock.calls[1][1].task;
    expect(stage2Task.family).toBe("text-replacement");
    expect(buildTextReplacementTask).toHaveBeenCalledWith(
      makeImageAsset(),
      makeMaskAsset(),
      "mock reconstruction prompt",
    );
  });

  it("fails when stage 1 inpainting runTask returns null", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(null);

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("inpainting");
    expect(deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("fails when stage 1 returns no image artifact", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse());
    (getImageArtifact as Mock).mockReturnValueOnce(null);

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cleaned image");
    expect(deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("fails when stage 2 text-replacement runTask returns null", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse());
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    deps.runTask.mockResolvedValueOnce(null);

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("text reconstruction");
    expect(deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("fails when stage 2 returns no JSON artifact", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse());
    deps.runTask.mockResolvedValueOnce(makeResponse());
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    (getJsonArtifact as Mock).mockReturnValueOnce(null);

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("structured JSON artifact");
    expect(deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("fails when JSON parse returns an error", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse());
    deps.runTask.mockResolvedValueOnce(makeResponse());
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    (getJsonArtifact as Mock).mockReturnValueOnce({ text: '{"bad": true}', role: "text-reconstruction" });
    (parseStructuredTextReconstructionJson as Mock).mockReturnValueOnce({
      ok: false,
      blocks: [],
      warnings: ["parse-warn"],
      error: "bad JSON",
    });

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(false);
    expect(result.error).toBe("bad JSON");
    expect(result.warnings).toContain("parse-warn");
    expect(deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("collects warnings from both stages on success", async () => {
    const deps = makeDeps();
    deps.runTask.mockResolvedValueOnce(makeResponse(["stage1-warn"]));
    deps.runTask.mockResolvedValueOnce(makeResponse(["stage2-warn"]));
    (getImageArtifact as Mock).mockReturnValueOnce(makeImageArtifact());
    (getJsonArtifact as Mock).mockReturnValueOnce({ text: '{"ok": true}', role: "text-reconstruction" });
    (parseStructuredTextReconstructionJson as Mock).mockReturnValueOnce({
      ok: true,
      blocks: [{ id: "b1", text: "OK", bounds: { x: 0, y: 0, width: 50, height: 20 } }],
      warnings: ["schema-warn"],
    });

    const result = await runTwoStageTextReplacement(deps, makeImageAsset(), makeMaskAsset());

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("stage1-warn");
    expect(result.warnings).toContain("stage2-warn");
    expect(result.warnings).toContain("schema-warn");
    expect(deps.runTask).toHaveBeenCalledTimes(2);
  });
});
