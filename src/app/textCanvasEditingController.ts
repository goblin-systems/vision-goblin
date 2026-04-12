import { byId } from "./dom";
import { getDocCoordinates } from "../editor/geometry";
import { measureTextBoxBounds, refreshLayerCanvas, snapshotDocument } from "../editor/documents";
import { pushHistory } from "../editor/history";
import { selectLayer } from "../editor/layers";
import { getTextFillColor } from "../editor/types";
import type { DocumentState, Layer, TextLayer, TransformDraft } from "../editor/types";

const OVERLAY_CLASS = "canvas-text-editor";
const COMMIT_MESSAGE = "Edited text";

type ToastVariant = "success" | "error" | "info";
type LogLevel = "INFO" | "WARN" | "ERROR";

type TextEditSession = {
  docId: string;
  layerId: string;
  initialText: string;
  initialDirty: boolean;
  initialSnapshot: string;
  textarea: HTMLTextAreaElement;
  settling: boolean;
};

type PointerHitResult = {
  layer: TextLayer | null;
  canEdit: boolean;
};

export interface TextCanvasEditingControllerDeps {
  editorCanvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getActiveTool: () => string;
  getTransformDraft: () => TransformDraft | null;
  commitTransformDraft: () => void;
  cancelTransformDraft: (showMessage?: boolean) => void;
  renderEditorState: () => void;
  log: (message: string, level?: LogLevel) => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}

export interface TextCanvasEditingController {
  bind: () => void;
  beginEditingActiveTextLayer: (options?: { selectAll?: boolean }) => boolean;
  syncOverlayPosition: () => void;
  getHiddenLayerId: () => string | null;
  isEditing: () => boolean;
  isTextLayoutInteractionActive: () => boolean;
  isTextInteractionActive: () => boolean;
}

function isEditableTextLayer(layer: Layer | null): layer is TextLayer {
  return !!layer && layer.type === "text" && !layer.locked && !layer.isBackground && layer.visible;
}

function getActiveEditableTextLayer(
  getActiveDocument: () => DocumentState | null,
  getActiveLayer: (doc: DocumentState) => Layer | null,
): { doc: DocumentState; layer: TextLayer } | null {
  const doc = getActiveDocument();
  if (!doc) {
    return null;
  }
  const layer = getActiveLayer(doc);
  if (!isEditableTextLayer(layer)) {
    return null;
  }
  return { doc, layer };
}

function syncInspectorTextValue(value: string) {
  const input = document.getElementById("text-value-input");
  if (input instanceof HTMLTextAreaElement) {
    input.value = value;
  }
}

export function createCanvasTextEditorTextarea(): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = OVERLAY_CLASS;
  textarea.setAttribute("data-canvas-text-editor", "true");
  textarea.setAttribute("aria-label", "Edit active text layer");
  textarea.spellcheck = false;
  textarea.wrap = "soft";
  return textarea;
}

export function isPointInsideActiveTextLayer(params: {
  doc: DocumentState;
  layer: TextLayer;
  clientX: number;
  clientY: number;
  canvasRect: DOMRect;
}) {
  const coords = getDocCoordinates(params.clientX, params.clientY, params.doc, params.canvasRect);
  return coords.x >= params.layer.x
    && coords.x <= params.layer.x + params.layer.canvas.width
    && coords.y >= params.layer.y
    && coords.y <= params.layer.y + params.layer.canvas.height;
}

function findEditableTextLayerAtPoint(params: {
  doc: DocumentState;
  clientX: number;
  clientY: number;
  canvasRect: DOMRect;
}): TextLayer | null {
  for (let index = params.doc.layers.length - 1; index >= 0; index -= 1) {
    const layer = params.doc.layers[index] ?? null;
    if (!isEditableTextLayer(layer)) {
      continue;
    }
    if (isPointInsideActiveTextLayer({
      doc: params.doc,
      layer,
      clientX: params.clientX,
      clientY: params.clientY,
      canvasRect: params.canvasRect,
    })) {
      return layer;
    }
  }
  return null;
}

function resolveTextPointerHit(params: {
  doc: DocumentState;
  activeTool: string;
  activeLayer: Layer | null;
  clientX: number;
  clientY: number;
  canvasRect: DOMRect;
}): PointerHitResult {
  const hoveredLayer = findEditableTextLayerAtPoint({
    doc: params.doc,
    clientX: params.clientX,
    clientY: params.clientY,
    canvasRect: params.canvasRect,
  });
  if (!hoveredLayer || params.activeTool !== "text") {
    return { layer: hoveredLayer, canEdit: false };
  }
  return {
    layer: hoveredLayer,
    canEdit: !!params.activeLayer && params.activeLayer.id === hoveredLayer.id,
  };
}

function hasMeaningfulTextLayoutDraftChange(doc: DocumentState, draft: TransformDraft) {
  const layer = doc.layers.find((item) => item.id === draft.layerId);
  if (!layer || layer.type !== "text" || draft.intent !== "text-layout") {
    return false;
  }
  const currentBoxWidth = layer.textData.boxWidth ?? null;
  const currentBoxHeight = layer.textData.boxHeight ?? null;
  const draftBoxWidth = draft.textBoxWidth ?? currentBoxWidth;
  const draftBoxHeight = draft.textBoxHeight ?? currentBoxHeight;
  const currentCenterX = layer.x + layer.canvas.width / 2;
  const currentCenterY = layer.y + layer.canvas.height / 2;
  return draftBoxWidth !== currentBoxWidth
    || draftBoxHeight !== currentBoxHeight
    || Math.abs(draft.centerX - currentCenterX) > 0.001
    || Math.abs(draft.centerY - currentCenterY) > 0.001;
}

export function createTextCanvasEditingController(deps: TextCanvasEditingControllerDeps): TextCanvasEditingController {
  let session: TextEditSession | null = null;

  function isTextLayoutInteractionActive() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    const draft = deps.getTransformDraft();
    return layer?.type === "text" && draft?.intent === "text-layout" && draft.layerId === layer.id;
  }

  function syncCanvasCursor(cursor: string) {
    deps.editorCanvas.style.cursor = cursor;
  }

  function cleanupSession() {
    if (!session) {
      return;
    }
    session.textarea.remove();
    session = null;
  }

  function syncOverlayPosition() {
    if (!session) {
      return;
    }

    const state = getActiveEditableTextLayer(deps.getActiveDocument, deps.getActiveLayer);
    if (!state || state.doc.id !== session.docId || state.layer.id !== session.layerId) {
      finalizeSession("commit");
      return;
    }

    const { doc, layer } = state;
    const rect = deps.editorCanvas.getBoundingClientRect();
    const coords = getDocCoordinates(rect.left, rect.top, doc, rect);
    const scale = coords.bounds.scale;
    const baseBounds = measureTextBoxBounds(layer.textData);
    const frameWidth = layer.textData.boxWidth ?? baseBounds.width;
    const frameHeight = layer.textData.boxHeight ?? baseBounds.height;
    const width = Math.max(48, Math.round(frameWidth * scale));
    const height = Math.max(36, Math.round(frameHeight * scale));
    const centerX = coords.bounds.originX + (layer.x + layer.canvas.width / 2) * scale;
    const centerY = coords.bounds.originY + (layer.y + layer.canvas.height / 2) * scale;
    session.textarea.style.left = `${Math.round(centerX)}px`;
    session.textarea.style.top = `${Math.round(centerY)}px`;
    session.textarea.style.width = `${width}px`;
    session.textarea.style.height = `${height}px`;
    session.textarea.style.fontFamily = layer.textData.fontFamily;
    session.textarea.style.fontSize = `${Math.max(8, Math.round(layer.textData.fontSize * scale))}px`;
    session.textarea.style.lineHeight = String(layer.textData.lineHeight);
    session.textarea.style.letterSpacing = `${layer.textData.kerning * scale}px`;
    session.textarea.style.fontWeight = layer.textData.bold ? "700" : "400";
    session.textarea.style.fontStyle = layer.textData.italic ? "italic" : "normal";
    session.textarea.style.textAlign = layer.textData.alignment;
    session.textarea.style.color = getTextFillColor(layer.textData.fill);
    session.textarea.style.transformOrigin = "center center";
    session.textarea.style.transform = `translate(-50%, -50%) rotate(${layer.textData.rotationDeg}deg) scale(${layer.textData.scaleX}, ${layer.textData.scaleY})`;
  }

  function applySessionText(nextText: string) {
    if (!session) {
      return;
    }
    const state = getActiveEditableTextLayer(deps.getActiveDocument, deps.getActiveLayer);
    if (!state || state.doc.id !== session.docId || state.layer.id !== session.layerId) {
      return;
    }
    state.layer.textData.text = nextText;
    refreshLayerCanvas(state.layer);
    state.doc.dirty = state.doc.dirty || nextText !== session.initialText;
    syncInspectorTextValue(nextText);
    syncOverlayPosition();
  }

  function finalizeSession(mode: "commit" | "cancel") {
    if (!session || session.settling) {
      return;
    }
    session.settling = true;

    const activeSession = session;
    const doc = deps.getActiveDocument();
    const layer = doc?.layers.find((item) => item.id === activeSession.layerId);
    const currentText = layer?.type === "text" ? layer.textData.text : activeSession.initialText;
    const changed = currentText !== activeSession.initialText;

    if (layer?.type === "text" && mode === "cancel") {
      layer.textData.text = activeSession.initialText;
      refreshLayerCanvas(layer);
      if (doc) {
        doc.dirty = activeSession.initialDirty;
      }
      syncInspectorTextValue(activeSession.initialText);
      deps.log(`Cancelled text edit for '${layer.name}'`, "INFO");
      deps.showToast("Text edit cancelled", "info");
    } else if (doc && layer?.type === "text" && changed) {
      doc.undoStack.push(activeSession.initialSnapshot);
      doc.redoStack = [];
      pushHistory(doc, COMMIT_MESSAGE);
      deps.log(`Committed text edit for '${layer.name}'`, "INFO");
    } else if (doc) {
      doc.dirty = activeSession.initialDirty;
    }

    cleanupSession();
    deps.renderEditorState();
  }

  function beginEditingActiveTextLayer(options: { selectAll?: boolean } = {}) {
    const activeDraft = deps.getTransformDraft();
    const activeDoc = deps.getActiveDocument();
    if (activeDoc && activeDraft?.intent === "text-layout") {
      if (hasMeaningfulTextLayoutDraftChange(activeDoc, activeDraft)) {
        deps.commitTransformDraft();
      } else {
        deps.cancelTransformDraft(false);
      }
    }

    const state = getActiveEditableTextLayer(deps.getActiveDocument, deps.getActiveLayer);
    if (!state) {
      return false;
    }
    const { doc, layer } = state;

    if (session?.docId === doc.id && session.layerId === layer.id) {
      syncOverlayPosition();
      session.textarea.focus();
      if (options.selectAll) {
        session.textarea.select();
      }
      return true;
    }

    if (session) {
      finalizeSession("commit");
    }

    const textarea = createCanvasTextEditorTextarea();
    textarea.value = layer.textData.text;
    textarea.addEventListener("input", () => {
      applySessionText(textarea.value);
    });
    textarea.addEventListener("blur", () => {
      finalizeSession("commit");
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeSession("cancel");
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finalizeSession("commit");
      }
    });

    session = {
      docId: doc.id,
      layerId: layer.id,
      initialText: layer.textData.text,
      initialDirty: doc.dirty,
      initialSnapshot: snapshotDocument(doc),
      textarea,
      settling: false,
    };

    deps.canvasWrap.appendChild(textarea);
    syncOverlayPosition();
    textarea.focus();
    if (options.selectAll ?? true) {
      textarea.select();
    }
    deps.log(`Started text edit for '${layer.name}'`, "INFO");
    deps.renderEditorState();
    return true;
  }

  function bind() {
    deps.editorCanvas.addEventListener("pointermove", (event) => {
      const doc = deps.getActiveDocument();
      if (!doc || deps.getActiveTool() !== "text") {
        syncCanvasCursor("");
        return;
      }
      const hit = resolveTextPointerHit({
        doc,
        activeTool: deps.getActiveTool(),
        activeLayer: deps.getActiveLayer(doc),
        clientX: event.clientX,
        clientY: event.clientY,
        canvasRect: deps.editorCanvas.getBoundingClientRect(),
      });
      syncCanvasCursor(hit.canEdit ? "text" : "");
    });

    deps.editorCanvas.addEventListener("pointerleave", () => {
      syncCanvasCursor("");
    });

    deps.editorCanvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || deps.getActiveTool() !== "text") {
        return;
      }
      const doc = deps.getActiveDocument();
      if (!doc) {
        return;
      }
      const targetLayer = findEditableTextLayerAtPoint({
        doc,
        clientX: event.clientX,
        clientY: event.clientY,
        canvasRect: deps.editorCanvas.getBoundingClientRect(),
      });
      if (!targetLayer) {
        return;
      }
      selectLayer(doc, targetLayer.id);
    });

    deps.editorCanvas.addEventListener("dblclick", (event) => {
      const state = getActiveEditableTextLayer(deps.getActiveDocument, deps.getActiveLayer);
      if (!state) {
        return;
      }
      if (!isPointInsideActiveTextLayer({
        doc: state.doc,
        layer: state.layer,
        clientX: event.clientX,
        clientY: event.clientY,
        canvasRect: deps.editorCanvas.getBoundingClientRect(),
      })) {
        return;
      }
      event.preventDefault();
      beginEditingActiveTextLayer();
    });

    window.addEventListener("resize", syncOverlayPosition);
    window.addEventListener("scroll", syncOverlayPosition, true);
  }

  return {
    bind,
    beginEditingActiveTextLayer,
    syncOverlayPosition,
    getHiddenLayerId: () => session?.layerId ?? null,
    isEditing: () => !!session,
    isTextLayoutInteractionActive,
    isTextInteractionActive: () => !!session || isTextLayoutInteractionActive(),
  };
}

export function getCanvasTextEditorForTests() {
  return byId<HTMLTextAreaElement>("text-value-input");
}
