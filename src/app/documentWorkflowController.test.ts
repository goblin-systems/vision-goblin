import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { getDefaultSettings } from "../settings";
import { createDocumentSession } from "./documentSession";
import { copyDocumentToClipboard } from "./clipboard";
import { createDocumentWorkflowController, type DocumentWorkflowControllerDeps } from "./documentWorkflowController";

vi.mock("./clipboard", () => ({
  copyDocumentToClipboard: vi.fn(),
}));

function createDeps(): DocumentWorkflowControllerDeps {
  return {
    documentSession: createDocumentSession(),
    io: {
      openImageDialog: vi.fn(),
      openProjectDialog: vi.fn(),
      fileNameFromPath: (path) => path,
      readBinary: vi.fn(),
      loadProject: vi.fn(),
      saveExport: vi.fn(),
      saveProject: vi.fn(),
    },
    getSettings: () => getDefaultSettings(),
    persistSettings: vi.fn(async () => undefined),
    renderEditorState: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
    emitWorkspaceEvent: vi.fn(),
    requestFileOpenFallback: vi.fn(),
    onDocumentActivated: vi.fn(),
    hasActiveTransform: vi.fn(() => false),
    cancelActiveTransform: vi.fn(),
  };
}

describe("documentWorkflowController.copyActiveDocumentToClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false and shows an info toast when there is no active document", async () => {
    const deps = createDeps();
    const controller = createDocumentWorkflowController(deps);

    await expect(controller.copyActiveDocumentToClipboard()).resolves.toBe(false);

    expect(copyDocumentToClipboard).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("No document to copy", "info");
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("returns true, logs success, and shows a success toast when copy succeeds", async () => {
    const deps = createDeps();
    const doc = makeNewDocument("Poster", 64, 64, 100, "transparent");
    deps.documentSession.setActiveDocument(doc);
    vi.mocked(copyDocumentToClipboard).mockResolvedValue(true);
    const controller = createDocumentWorkflowController(deps);

    await expect(controller.copyActiveDocumentToClipboard()).resolves.toBe(true);

    expect(copyDocumentToClipboard).toHaveBeenCalledWith(doc);
    expect(deps.log).toHaveBeenCalledWith("Copied 'Poster' to clipboard", "INFO");
    expect(deps.showToast).toHaveBeenCalledWith("Copied to clipboard");
  });

  it("returns false, logs a warning, and shows an error toast when copy fails", async () => {
    const deps = createDeps();
    const doc = makeNewDocument("Poster", 64, 64, 100, "transparent");
    deps.documentSession.setActiveDocument(doc);
    vi.mocked(copyDocumentToClipboard).mockResolvedValue(false);
    const controller = createDocumentWorkflowController(deps);

    await expect(controller.copyActiveDocumentToClipboard()).resolves.toBe(false);

    expect(copyDocumentToClipboard).toHaveBeenCalledWith(doc);
    expect(deps.log).toHaveBeenCalledWith("Clipboard image copy failed", "WARN");
    expect(deps.showToast).toHaveBeenCalledWith("Failed to copy to clipboard", "error");
  });
});
