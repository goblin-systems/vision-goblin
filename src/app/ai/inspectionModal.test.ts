import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJobInspectionData } from "./inspection";

vi.mock("@goblin-systems/goblin-design-system", () => ({
  applyIcons: vi.fn(),
  openModal: vi.fn(({ backdrop, onAccept, onReject }: { backdrop: HTMLElement; onAccept?: () => void; onReject?: () => void }) => {
    backdrop.querySelectorAll(".modal-btn-accept").forEach((button) => button.addEventListener("click", () => onAccept?.()));
    backdrop.querySelectorAll(".modal-btn-reject").forEach((button) => button.addEventListener("click", () => onReject?.()));
  }),
}));

describe("AI inspection modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders prompt, sent assets, received artifacts, and raw payload", async () => {
    const { openAiJobInspectionModal } = await import("./inspectionModal");
    const inspection: AiJobInspectionData = {
      task: {
        id: "job-1",
        family: "inpainting",
        prompt: "Replace the sky",
        input: {
          image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 },
          mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,BBBB", width: 10, height: 10 },
        },
      },
      providerId: "gemini",
      model: "gemini-2.5-flash-image",
      request: {
        prompt: "Replace the sky",
        assets: [
          { kind: "image", label: "input image", mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 },
          { kind: "mask", label: "mask", mimeType: "image/png", data: "data:image/png;base64,BBBB", width: 10, height: 10 },
        ],
      },
      response: {
        returnedContent: "model said ok",
        rawPayload: { model: "test", data: [{ b64_json: "[omitted]" }] },
      },
    };

    openAiJobInspectionModal("Inspect job", inspection, [
      { kind: "image", mimeType: "image/png", data: "data:image/png;base64,CCCC", width: 10, height: 10, purpose: "inpainted" },
    ]);

    expect(document.body.textContent).toContain("Replace the sky");
    expect(document.body.textContent).toContain("Provider");
    expect(document.body.textContent).toContain("gemini");
    expect(document.body.textContent).toContain("Model");
    expect(document.body.textContent).toContain("gemini-2.5-flash-image");
    expect(document.body.textContent).toContain("input image");
    expect(document.body.textContent).toContain("mask");
    expect(document.body.textContent).toContain("inpainted");
    expect(document.body.textContent).toContain("model said ok");
    expect(document.body.textContent).toContain('"model": "test"');
    expect(document.querySelectorAll("img")).toHaveLength(3);
  });

  it("renders modal body with selectable text content in code blocks", async () => {
    const { openAiJobInspectionModal } = await import("./inspectionModal");
    const inspection: AiJobInspectionData = {
      task: { id: "job-select", family: "inpainting", prompt: "test prompt", input: { image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AA" }, mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,BB" } } },
      providerId: "test",
      model: "test-model",
      request: { prompt: "test prompt", assets: [] },
      response: { returnedContent: "response text", rawPayload: { data: "payload" } },
    };

    openAiJobInspectionModal("Copy test", inspection, []);

    const modalBody = document.querySelector(".ai-inspection-modal-body");
    expect(modalBody).toBeTruthy();
    const codeBlocks = modalBody!.querySelectorAll(".ai-inspection-code");
    expect(codeBlocks.length).toBeGreaterThan(0);
    codeBlocks.forEach((block) => {
      expect(block.textContent!.length).toBeGreaterThan(0);
    });
  });

  it("renders planned provider and model values without falling back to Unknown", async () => {
    const { openAiJobInspectionModal } = await import("./inspectionModal");
    const inspection: AiJobInspectionData = {
      task: {
        id: "job-planned",
        family: "generation",
        prompt: "Generate a goblin",
      },
      providerId: "gemini",
      model: "gemini-2.5-flash-image",
      request: {
        prompt: "Generate a goblin",
        assets: [],
      },
    };

    openAiJobInspectionModal("Inspect planned job", inspection, []);

    expect(document.body.textContent).toContain("gemini");
    expect(document.body.textContent).toContain("gemini-2.5-flash-image");
    expect(document.body.textContent).not.toContain("Unknown");
  });
});
