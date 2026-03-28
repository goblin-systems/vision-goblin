import { applyIcons, closeModal, confirmModal, openModal } from "@goblin-systems/goblin-design-system";
import type { VisionSettings } from "../settings";
import type { DocumentState } from "../editor/types";
import {
  autosaveDocuments,
  clearRecoveryEntries,
  discardRecoveryEntry,
  loadRecoveryEntries,
  startAutosaveTimer,
  stopAutosaveTimer,
  type AutosaveTarget,
  type RecoveryEntry,
} from "../editor/autosave";
import { addBlobAsLayer, duplicateDocument, importDocumentFromBlob, makeNewDocument } from "../editor/actions/documentActions";
import { byId } from "./dom";
import type { DocumentSession } from "./documentSession";
import type { IoController } from "./io";
import { buildAutosaveTargets, getRecoveryPromptCopy, restoreRecoveryDocuments, trimRecentItems } from "./documentWorkflowHelpers";

export interface NewDocumentValues {
  name: string;
  width: number;
  height: number;
  background: DocumentState["background"];
}

function getImageMimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "png";
  return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
}

function renderRecentMenuList(containerId: string, items: string[], navPrefix: string, io: IoController) {
  const container = byId<HTMLElement>(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nav-option nav-option--disabled recent-menu-empty";
    empty.textContent = "Nothing yet";
    container.appendChild(empty);
    return;
  }

  items.forEach((path, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-option recent-menu-item";
    button.dataset.navId = `${navPrefix}:${index}`;
    button.innerHTML = `<span class="nav-option-label">${io.fileNameFromPath(path)}</span>`;
    button.title = path;
    container.appendChild(button);
  });
}

async function requestNewDocumentValues(
  documentCount: number,
  showToast: (message: string, variant?: "success" | "error" | "info") => void,
  onCreateFromClipboard: () => Promise<void>,
): Promise<NewDocumentValues | null> {
  return new Promise((resolve) => {
    const backdrop = byId<HTMLElement>("new-document-modal");
    const presetSelect = byId<HTMLSelectElement>("new-document-preset-select");
    const nameInput = byId<HTMLInputElement>("new-document-name-input");
    const widthInput = byId<HTMLInputElement>("new-document-width-input");
    const heightInput = byId<HTMLInputElement>("new-document-height-input");
    const backgroundSelect = byId<HTMLSelectElement>("new-document-background-select");
    const submitBtn = byId<HTMLButtonElement>("new-document-submit-btn");
    const clipboardBtn = byId<HTMLButtonElement>("new-document-clipboard-btn");

    presetSelect.value = "custom";
    nameInput.value = `Untitled ${documentCount + 1}`;
    widthInput.value = "1600";
    heightInput.value = "1200";
    backgroundSelect.value = "white";

    let settled = false;
    const inputNodes = [nameInput, widthInput, heightInput, presetSelect, backgroundSelect];
    const applyPreset = () => {
      if (presetSelect.value === "custom") {
        return;
      }
      const [width, height] = presetSelect.value.split("x").map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        widthInput.value = String(width);
        heightInput.value = String(height);
      }
    };
    const cleanup = () => {
      submitBtn.removeEventListener("click", onSubmit);
      clipboardBtn.removeEventListener("click", onClipboard);
      presetSelect.removeEventListener("change", applyPreset);
      inputNodes.forEach((input) => input.removeEventListener("keydown", onKeyDown));
    };
    const finish = (result: NewDocumentValues | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        onSubmit();
      }
    };
    const onSubmit = () => {
      const name = nameInput.value.trim() || `Untitled ${documentCount + 1}`;
      const width = Math.round(Number(widthInput.value));
      const height = Math.round(Number(heightInput.value));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        showToast("Enter valid canvas dimensions", "error");
        widthInput.focus();
        return;
      }
      closeModal({ backdrop });
      finish({ name, width, height, background: backgroundSelect.value as DocumentState["background"] });
    };
    const onClipboard = () => {
      closeModal({ backdrop });
      finish(null);
      void onCreateFromClipboard();
    };

    submitBtn.addEventListener("click", onSubmit);
    clipboardBtn.addEventListener("click", onClipboard);
    presetSelect.addEventListener("change", applyPreset);
    inputNodes.forEach((input) => input.addEventListener("keydown", onKeyDown));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(null),
    });
    requestAnimationFrame(() => nameInput.focus());
  });
}

export interface DocumentWorkflowControllerDeps {
  documentSession: DocumentSession;
  io: IoController;
  getSettings: () => VisionSettings;
  persistSettings: (next: VisionSettings, message?: string) => Promise<void>;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  emitWorkspaceEvent: (type: string, detail: Record<string, unknown>) => void;
  requestFileOpenFallback: () => void;
  onDocumentActivated: (documentId: string) => void;
  hasActiveTransform: () => boolean;
  cancelActiveTransform: (showMessage?: boolean) => void;
}

export interface DocumentWorkflowController {
  activateDocument: (documentId: string) => void;
  renderRecentMenus: () => void;
  createNewDocumentFlow: () => Promise<void>;
  closeDocument: (documentId: string) => Promise<void>;
  openDocumentFromBlob: (name: string, blob: Blob, sourcePath: string | null) => Promise<void>;
  addBlobAsLayerToActiveDocument: (name: string, blob: Blob) => Promise<void>;
  openProjectFromPath: (path: string) => Promise<void>;
  handleOpenImage: () => Promise<void>;
  handleOpenProject: () => Promise<void>;
  loadImageFromFileInput: (file: File) => Promise<void>;
  handleExportImage: () => Promise<void>;
  handleSaveProject: (saveAs?: boolean) => Promise<void>;
  duplicateActiveDocument: () => void;
  tryPasteImageFromClipboard: () => Promise<boolean>;
  handleRecentNavSelection: (id: string) => Promise<boolean>;
  clearRecent: () => Promise<void>;
  configureAutosaveTimer: () => void;
  checkCrashRecovery: () => Promise<void>;
  cleanShutdown: () => Promise<void>;
}

export function createDocumentWorkflowController(deps: DocumentWorkflowControllerDeps): DocumentWorkflowController {
  const { documentSession, io } = deps;

  function getSettings() {
    return deps.getSettings();
  }

  function getDocuments() {
    return documentSession.documents;
  }

  function getActiveDocument() {
    return documentSession.getActiveDocument();
  }

  function setActiveDocument(doc: DocumentState) {
    const isNewDocument = documentSession.setActiveDocument(doc);
    if (isNewDocument) {
      deps.log(`Registered document '${doc.name}' (${doc.id})`, "INFO");
    }
    deps.log(`Active document set to '${doc.name}' (${doc.id})`, "INFO");
  }

  async function rememberRecentImage(path: string) {
    const settings = getSettings();
    await deps.persistSettings({ ...settings, recentImages: trimRecentItems(settings.recentImages, path) });
  }

  async function rememberRecentProject(path: string) {
    const settings = getSettings();
    await deps.persistSettings({ ...settings, recentProjects: trimRecentItems(settings.recentProjects, path) });
  }

  async function removeRecent(path: string, kind: "image" | "project") {
    const settings = getSettings();
    if (kind === "image") {
      await deps.persistSettings({ ...settings, recentImages: settings.recentImages.filter((item) => item !== path) });
      return;
    }
    await deps.persistSettings({ ...settings, recentProjects: settings.recentProjects.filter((item) => item !== path) });
  }

  function renderRecentMenus() {
    const settings = getSettings();
    renderRecentMenuList("recent-projects-nav", settings.recentProjects, "recent-project", io);
    renderRecentMenuList("recent-images-nav", settings.recentImages, "recent-image", io);
    applyIcons();
  }

  function activateDocument(documentId: string) {
    if (!documentSession.activateDocument(documentId)) {
      return;
    }
    deps.onDocumentActivated(documentId);
    deps.renderEditorState();
    deps.emitWorkspaceEvent("document-activated", { documentId });
  }

  async function createNewDocumentFlow() {
    const nextDocument = await requestNewDocumentValues(
      getDocuments().length,
      deps.showToast,
      async () => {
        const pasted = await tryPasteImageFromClipboard();
        if (!pasted) {
          deps.showToast("No image found on clipboard", "info");
        }
      },
    );
    if (!nextDocument) {
      return;
    }
    const { name, width, height, background } = nextDocument;
    const doc = makeNewDocument(name, width, height, getSettings().defaultZoom, background);
    doc.dirty = true;
    setActiveDocument(doc);
    deps.renderEditorState();
    deps.emitWorkspaceEvent("document-created", { documentId: doc.id, source: "blank" });
    deps.log(`Created new document '${doc.name}' at ${width}x${height}`, "INFO");
    deps.showToast(`Created ${width}x${height} ${background} canvas`);
  }

  async function closeDocument(documentId: string) {
    if (deps.hasActiveTransform() && documentSession.activeDocumentId === documentId) {
      deps.cancelActiveTransform(false);
    }
    const doc = documentSession.getDocument(documentId);
    if (!doc) {
      return;
    }
    if (doc.dirty) {
      const confirmed = await confirmModal({
        title: `Close ${doc.name}?`,
        message: "This canvas has unsaved changes. Closing it now will discard them.",
        acceptLabel: "Discard changes",
        rejectLabel: "Keep open",
        variant: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    documentSession.removeDocument(documentId);
    void discardRecoveryEntry(documentId);
    deps.renderEditorState();
    deps.emitWorkspaceEvent("document-closed", { documentId });
    deps.log(`Closed document '${doc.name}' (${documentId})`, "INFO");
    deps.showToast(`${doc.name} closed`);
  }

  async function openDocumentFromBlob(name: string, blob: Blob, sourcePath: string | null) {
    const doc = await importDocumentFromBlob(name, blob, sourcePath, getSettings().defaultZoom);
    setActiveDocument(doc);
    deps.renderEditorState();
    if (sourcePath) {
      await rememberRecentImage(sourcePath);
    }
    deps.emitWorkspaceEvent("document-created", { documentId: doc.id, source: sourcePath ? "file" : "clipboard" });
    deps.log(`Opened document '${doc.name}'`, "INFO");
    deps.showToast(`Opened ${doc.name}`);
  }

  async function addBlobAsLayerToActiveDocument(name: string, blob: Blob) {
    const doc = getActiveDocument();
    if (!doc) {
      await openDocumentFromBlob(name, blob, null);
      return;
    }

    const layer = await addBlobAsLayer(doc, name, blob);
    deps.renderEditorState();
    deps.log(`Added layer '${layer.name}' from blob`, "INFO");
    deps.showToast(`Added ${layer.name} as a new layer`);
  }

  async function openProjectFromPath(path: string) {
    const doc = await io.loadProject(path);
    setActiveDocument(doc);
    deps.renderEditorState();
    await rememberRecentProject(path);
    deps.log(`Opened project '${doc.name}'`, "INFO");
    deps.showToast(`Opened project ${doc.name}`);
  }

  async function handleOpenImage() {
    try {
      const path = await io.openImageDialog();
      if (!path || Array.isArray(path)) {
        return;
      }
      const bytes = await io.readBinary(path);
      await openDocumentFromBlob(io.fileNameFromPath(path), new Blob([bytes], { type: getImageMimeType(path) }), path);
    } catch (error) {
      console.error(error);
      deps.log(`Failed to open image: ${String(error)}`, "ERROR");
      deps.requestFileOpenFallback();
    }
  }

  async function handleOpenProject() {
    try {
      const path = await io.openProjectDialog();
      if (!path || Array.isArray(path)) {
        return;
      }
      await openProjectFromPath(path);
    } catch (error) {
      console.error(error);
      deps.log(`Failed to open project: ${String(error)}`, "ERROR");
      deps.showToast("Failed to open project");
    }
  }

  async function loadImageFromFileInput(file: File) {
    await openDocumentFromBlob(file.name, file, null);
  }

  async function handleExportImage() {
    const doc = getActiveDocument();
    if (!doc) {
      deps.showToast("No document to export");
      return;
    }

    try {
      const outputPath = await io.saveExport(doc, getSettings());
      if (!outputPath) {
        return;
      }
      doc.dirty = false;
      deps.renderEditorState();
      deps.log(`Exported '${doc.name}' to '${io.fileNameFromPath(outputPath)}'`, "INFO");
      deps.showToast(`Exported ${io.fileNameFromPath(outputPath)}`);
    } catch (error) {
      console.error(error);
      deps.log(`Export failed: ${String(error)}`, "ERROR");
      deps.showToast("Export failed");
    }
  }

  async function saveProject(doc: DocumentState, saveAs = false) {
    const outputPath = await io.saveProject(doc, saveAs);
    if (!outputPath) {
      return;
    }
    doc.projectPath = outputPath;
    doc.dirty = false;
    void discardRecoveryEntry(doc.id);
    await rememberRecentProject(outputPath);
    deps.renderEditorState();
    deps.log(`Saved project '${doc.name}'`, "INFO");
    deps.showToast(`Saved ${io.fileNameFromPath(outputPath)}`);
  }

  async function handleSaveProject(saveAs = false) {
    const doc = getActiveDocument();
    if (!doc) {
      deps.showToast("No document to save");
      return;
    }

    try {
      await saveProject(doc, saveAs);
    } catch (error) {
      console.error(error);
      deps.log(`Project save failed: ${String(error)}`, "ERROR");
      deps.showToast("Project save failed");
    }
  }

  function duplicateActiveDocument() {
    const doc = getActiveDocument();
    if (!doc) {
      return;
    }
    const copy = duplicateDocument(doc);
    setActiveDocument(copy);
    deps.renderEditorState();
    deps.log(`Duplicated document '${doc.name}'`, "INFO");
    deps.showToast(`Duplicated ${doc.name}`);
  }

  async function tryPasteImageFromClipboard(): Promise<boolean> {
    try {
      const clipboard = navigator.clipboard as Clipboard & {
        read?: () => Promise<ClipboardItem[]>;
      };
      if (!clipboard.read) {
        return false;
      }
      const items = await clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await addBlobAsLayerToActiveDocument(`Pasted ${getDocuments().length + 1}.png`, blob);
        return true;
      }
    } catch {
      deps.log("Clipboard image read failed", "WARN");
      return false;
    }
    return false;
  }

  async function openRecentProject(path: string) {
    try {
      await openProjectFromPath(path);
    } catch {
      await removeRecent(path, "project");
      deps.showToast("Recent project is no longer available", "error");
    }
  }

  async function openRecentImage(path: string) {
    try {
      const bytes = await io.readBinary(path);
      await openDocumentFromBlob(io.fileNameFromPath(path), new Blob([bytes], { type: getImageMimeType(path) }), path);
    } catch {
      await removeRecent(path, "image");
      deps.showToast("Recent image is no longer available", "error");
    }
  }

  async function handleRecentNavSelection(id: string) {
    const settings = getSettings();
    if (id.startsWith("recent-project:")) {
      const path = settings.recentProjects[Number(id.split(":")[1])];
      if (path) {
        await openRecentProject(path);
      }
      return true;
    }
    if (id.startsWith("recent-image:")) {
      const path = settings.recentImages[Number(id.split(":")[1])];
      if (path) {
        await openRecentImage(path);
      }
      return true;
    }
    return false;
  }

  async function clearRecent() {
    const settings = getSettings();
    await deps.persistSettings({ ...settings, recentImages: [], recentProjects: [] }, "Recent files cleared");
  }

  async function performAutosave() {
    const count = await autosaveDocuments(buildAutosaveTargets(getDocuments()));
    if (count > 0) {
      deps.log(`Autosaved ${count} document(s)`, "INFO");
    }
    return count;
  }

  function configureAutosaveTimer() {
    stopAutosaveTimer();
    const settings = getSettings();
    if (settings.autosaveEnabled) {
      startAutosaveTimer(() => void performAutosave(), settings.autosaveIntervalSeconds * 1000);
      deps.log(`Autosave timer started (${settings.autosaveIntervalSeconds}s)`, "INFO");
    }
  }

  async function checkCrashRecovery() {
    let entries: RecoveryEntry[];
    try {
      entries = await loadRecoveryEntries();
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }

    const prompt = getRecoveryPromptCopy(entries.length);
    const confirmed = await confirmModal({
      title: prompt.title,
      message: prompt.message,
      acceptLabel: prompt.acceptLabel,
      rejectLabel: prompt.rejectLabel,
      variant: "default",
    });

    if (confirmed) {
      const result = await restoreRecoveryDocuments(entries);
      result.restored.forEach((doc) => setActiveDocument(doc));
      result.failed.forEach(({ entry, error }) => {
        deps.log(`Failed to restore '${entry.name}': ${String(error)}`, "ERROR");
      });
      if (result.restored.length > 0) {
        deps.renderEditorState();
        deps.showToast(`Restored ${result.restored.length} document${result.restored.length > 1 ? "s" : ""}`, "success");
        deps.log(`Restored ${result.restored.length} document(s) from crash recovery`, "INFO");
      }
    }

    await clearRecoveryEntries();
  }

  async function cleanShutdown() {
    stopAutosaveTimer();
    const hasDirty = getDocuments().some((doc) => doc.dirty);
    if (!hasDirty) {
      await clearRecoveryEntries();
    }
  }

  return {
    activateDocument,
    renderRecentMenus,
    createNewDocumentFlow,
    closeDocument,
    openDocumentFromBlob,
    addBlobAsLayerToActiveDocument,
    openProjectFromPath,
    handleOpenImage,
    handleOpenProject,
    loadImageFromFileInput,
    handleExportImage,
    handleSaveProject,
    duplicateActiveDocument,
    tryPasteImageFromClipboard,
    handleRecentNavSelection,
    clearRecent,
    configureAutosaveTimer,
    checkCrashRecovery,
    cleanShutdown,
  };
}
