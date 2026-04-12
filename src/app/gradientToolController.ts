import { applyIcons, bindRadial, closeModal, openModal, type RadialHandle } from "@goblin-systems/goblin-design-system";
import { byId } from "./dom";
import {
  addGradientNode,
  addGradientNodeAtPosition,
  applyGradientToSelection,
  createGradientSampler,
  createDefaultGradientNodes,
  DEFAULT_GRADIENT_HEADING_DEGREES,
  moveGradientNode,
  removeGradientNode,
  resetGradientNodes,
  textFillToGradientConfig,
  updateGradientNodeColour,
  type GradientConfig,
  type GradientCurveNode,
  type GradientTargetScope,
} from "../editor/gradient";
import { getFillGradientTargetError, resolveEffectiveSelectionMask } from "../editor/fillGradientValidation";
import { beginDocumentOperation, cancelDocumentOperation, commitDocumentOperation, markDocumentOperationChanged } from "../editor/history";
import { snapshotDocument } from "../editor/documents";
import { BUILT_IN_GRADIENT_PRESETS, createGradientConfigFromPreset } from "../editor/gradientPresets";
import type { DocumentState, GradientType, Layer, LinearGradientFill, RadialGradientFill, RasterLayer } from "../editor/types";

type ToastVariant = "success" | "error" | "info";
type PreviewDragMode = "linear-start" | "linear-end" | "radial-center";

export interface GradientToolControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getGradientPaletteColours: () => string[];
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}

export interface GradientEditorResult {
  config: GradientConfig;
}

export interface GradientToolController {
  openGradientToolModal: () => void;
  openGradientEditorForText: (
    currentFill: LinearGradientFill | RadialGradientFill,
    onConfirm: (result: GradientEditorResult) => void,
  ) => void;
}

type EditorMode =
  | { type: "raster-apply" }
  | { type: "text-configure"; onConfirm: (result: GradientEditorResult) => void };

export function getGradientToolTargetError(layer: Layer | null) {
  return getFillGradientTargetError("gradient", layer);
}

function clampNormalized(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatNormalizedValue(value: number) {
  return clampNormalized(value).toFixed(2);
}

function getNodeLabel(nodes: GradientCurveNode[], index: number) {
  if (index === 0) return "Start";
  if (index === nodes.length - 1) return "End";
  return `Node ${index}`;
}

function getLinearPreviewHandlePoints(width: number, height: number, headingDegrees: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const angleRadians = (headingDegrees * Math.PI) / 180;
  const radius = Math.max(Math.min(width, height) * 0.32, 14);
  const dx = Math.cos(angleRadians) * radius;
  const dy = Math.sin(angleRadians) * radius;
  return {
    centerX,
    centerY,
    start: { x: centerX - dx, y: centerY - dy },
    end: { x: centerX + dx, y: centerY + dy },
  };
}

function drawCurveCanvas(canvas: HTMLCanvasElement, nodes: GradientCurveNode[], activeNodeId: string | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const x = (canvas.width * index) / 4;
    const y = (canvas.height * index) / 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#6C63FF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  nodes.forEach((node, index) => {
    const x = node.x * canvas.width;
    const y = (1 - node.y) * canvas.height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const activeNode = activeNodeId ? nodes.find((node) => node.id === activeNodeId) ?? null : null;
  if (activeNode) {
    const activeX = activeNode.x * canvas.width;
    const activeY = (1 - activeNode.y) * canvas.height;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(activeX, 0);
    ctx.lineTo(activeX, canvas.height);
    ctx.moveTo(0, activeY);
    ctx.lineTo(canvas.width, activeY);
    ctx.stroke();
    ctx.restore();
  }

  nodes.forEach((node, index) => {
    const x = node.x * canvas.width;
    const y = (1 - node.y) * canvas.height;
    const active = activeNodeId === node.id;
    if (active) {
      ctx.fillStyle = "rgba(108,99,255,0.22)";
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(x, y, active ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = active ? "#FFFFFF" : "rgba(7,11,21,0.9)";
    ctx.stroke();
    ctx.fillStyle = active ? "#FFFFFF" : "rgba(255,255,255,0.7)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(getNodeLabel(nodes, index), x, Math.max(14, y - 14));
  });
}

function drawPreviewHandle(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean, fillStyle: string) {
  if (active) {
    ctx.fillStyle = "rgba(108,99,255,0.28)";
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
}

function drawPreviewCanvas(
  canvas: HTMLCanvasElement,
  nodes: GradientCurveNode[],
  gradientType: GradientType,
  headingDegrees: number,
  centerX: number,
  centerY: number,
  previewDragMode: PreviewDragMode | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sampler = createGradientSampler(nodes);

  if (gradientType === "radial") {
    const cxPx = centerX * Math.max(canvas.width - 1, 0);
    const cyPx = centerY * Math.max(canvas.height - 1, 0);
    const cornerDistances = [
      Math.hypot(cxPx, cyPx),
      Math.hypot(canvas.width - 1 - cxPx, cyPx),
      Math.hypot(cxPx, canvas.height - 1 - cyPx),
      Math.hypot(canvas.width - 1 - cxPx, canvas.height - 1 - cyPx),
    ];
    const maxDist = Math.max(...cornerDistances, Number.EPSILON);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const dist = Math.hypot(x - cxPx, y - cyPx);
        const position = Math.max(0, Math.min(1, dist / maxDist));
        ctx.fillStyle = sampler.sampleHex(position);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  } else {
    const angleRadians = (headingDegrees * Math.PI) / 180;
    const dirX = Math.cos(angleRadians);
    const dirY = Math.sin(angleRadians);
    const maxX = Math.max(canvas.width - 1, 0);
    const maxY = Math.max(canvas.height - 1, 0);
    const minDot = Math.min(0, maxX * dirX, maxY * dirY, maxX * dirX + maxY * dirY);
    const maxDot = Math.max(0, maxX * dirX, maxY * dirY, maxX * dirX + maxY * dirY);
    const dotSpan = Math.max(maxDot - minDot, Number.EPSILON);

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const position = Math.max(0, Math.min(1, ((x * dirX + y * dirY) - minDot) / dotSpan));
        ctx.fillStyle = sampler.sampleHex(position);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.restore();

  if (gradientType === "radial") {
    const cx = clampNormalized(centerX) * Math.max(canvas.width - 1, 0);
    const cy = clampNormalized(centerY) * Math.max(canvas.height - 1, 0);
    const ringRadius = Math.max(Math.min(canvas.width, canvas.height) * 0.22, 10);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawPreviewHandle(ctx, cx, cy, previewDragMode === "radial-center", "#6C63FF");
  } else {
    const handles = getLinearPreviewHandlePoints(canvas.width, canvas.height, headingDegrees);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(handles.start.x, handles.start.y);
    ctx.lineTo(handles.end.x, handles.end.y);
    ctx.stroke();
    ctx.restore();
    drawPreviewHandle(ctx, handles.start.x, handles.start.y, previewDragMode === "linear-start", "#0B1020");
    drawPreviewHandle(ctx, handles.end.x, handles.end.y, previewDragMode === "linear-end", "#6C63FF");
  }
}

function renderNodeList(
  root: HTMLElement,
  nodes: GradientCurveNode[],
  activeNodeId: string | null,
  onSelect: (id: string) => void,
  onColourChange: (id: string, colour: string) => void,
  onRemove: (id: string) => void,
) {
  root.innerHTML = "";
  nodes.forEach((node, index) => {
    const row = document.createElement("div");
    row.className = `gradient-node-row${activeNodeId === node.id ? " is-active" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", activeNodeId === node.id ? "true" : "false");
    row.addEventListener("click", () => onSelect(node.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(node.id);
      }
    });

    const label = document.createElement("div");
    label.className = "gradient-node-meta";
    label.textContent = getNodeLabel(nodes, index);

    const position = document.createElement("div");
    position.className = "gradient-node-position";
    position.textContent = `Stop ${Math.round(node.x * 100)}% · Curve ${Math.round(node.y * 100)}%`;

    const selection = document.createElement("div");
    selection.className = "gradient-node-selection";
    selection.textContent = activeNodeId === node.id ? "Selected" : "Click to select";

    const input = document.createElement("input");
    input.type = "color";
    input.value = node.color;
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", () => onColourChange(node.id, input.value));

    row.append(label, position, selection, input);
    if (index > 0 && index < nodes.length - 1) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "secondary-btn slim-btn";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", (event) => event.stopPropagation());
      removeButton.addEventListener("click", () => onRemove(node.id));
      row.append(removeButton);
    }
    root.append(row);
  });
}

function renderPresetButtons(root: HTMLElement, activePresetId: string | null, onApply: (presetId: string) => void) {
  root.innerHTML = "";
  BUILT_IN_GRADIENT_PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `secondary-btn gradient-preset-btn${activePresetId === preset.id ? " is-active" : ""}`;
    button.dataset.presetId = preset.id;
    button.textContent = preset.label;
    button.addEventListener("click", () => onApply(preset.id));
    root.append(button);
  });
}

function resolveGradientPaletteColours(colours: string[]) {
  const normalized = colours.filter((colour) => typeof colour === "string" && colour.trim().length > 0);
  return normalized.length >= 2 ? normalized : ["#6C63FF", "#FFFFFF"];
}

function createPaletteGradientNodes(colours: string[]) {
  const paletteColours = resolveGradientPaletteColours(colours);
  return createDefaultGradientNodes(paletteColours[0], paletteColours[1] ?? paletteColours[0]);
}

function getNextPaletteColour(colours: string[], nodes: GradientCurveNode[]) {
  const paletteColours = resolveGradientPaletteColours(colours);
  return paletteColours[nodes.length % paletteColours.length] ?? paletteColours[0];
}

function getInsertedNodeId(previousNodes: GradientCurveNode[], nextNodes: GradientCurveNode[]) {
  const previousIds = new Set(previousNodes.map((node) => node.id));
  return nextNodes.find((node) => !previousIds.has(node.id))?.id ?? null;
}

export function createGradientToolController(deps: GradientToolControllerDeps): GradientToolController {
  function openEditor(mode: EditorMode, initialFill?: LinearGradientFill | RadialGradientFill) {
    if (mode.type === "raster-apply") {
      const doc = deps.getActiveDocument();
      if (!doc) {
        deps.showToast("No document open", "error");
        return;
      }
      const layer = deps.getActiveLayer(doc);
      const error = getGradientToolTargetError(layer);
      if (error) {
        deps.showToast(error, "error");
        return;
      }
    }

    const backdrop = byId<HTMLElement>("gradient-tool-modal");
    const curveCanvas = byId<HTMLCanvasElement>("gradient-curve-canvas");
    const previewCanvas = byId<HTMLCanvasElement>("gradient-preview-canvas");
    const nodeList = byId<HTMLElement>("gradient-node-list");
    const presetList = byId<HTMLElement>("gradient-preset-list");
    const addButton = byId<HTMLButtonElement>("gradient-add-node-btn");
    const resetButton = byId<HTMLButtonElement>("gradient-reset-btn");
    const applyButton = byId<HTMLButtonElement>("gradient-apply-btn");
    const targetSelect = byId<HTMLSelectElement>("gradient-target-select");
    const targetRow = byId<HTMLElement>("gradient-target-row");
    const headingControl = byId<HTMLElement>("gradient-heading-control");
    const headingRow = byId<HTMLElement>("gradient-heading-row");
    const typeSelect = byId<HTMLSelectElement>("gradient-type-select");
    const centerControls = byId<HTMLElement>("gradient-center-controls");
    const centerXInput = byId<HTMLInputElement>("gradient-center-x");
    const centerYInput = byId<HTMLInputElement>("gradient-center-y");
    const titleEl = byId<HTMLElement>("gradient-tool-title");

    let gradientType: GradientType;
    let nodes: GradientCurveNode[];
    let headingDegrees: number;
    let centerX: number;
    let centerY: number;

    if (initialFill) {
      const config = textFillToGradientConfig(initialFill);
      gradientType = config.gradientType;
      nodes = config.nodes;
      headingDegrees = config.headingDegrees;
      centerX = config.centerX;
      centerY = config.centerY;
    } else {
      gradientType = "linear";
      nodes = createPaletteGradientNodes(deps.getGradientPaletteColours());
      headingDegrees = DEFAULT_GRADIENT_HEADING_DEGREES;
      centerX = 0.5;
      centerY = 0.5;
    }

    let activeNodeId: string | null = nodes[0]?.id ?? null;
    let draggingPointerId: number | null = null;
    let previewDraggingPointerId: number | null = null;
    let previewDragMode: PreviewDragMode | null = null;
    let targetScope: GradientTargetScope = "canvas";
    let radialHandle: RadialHandle | null = null;
    let activePresetId: string | null = null;

    titleEl.textContent = mode.type === "text-configure" ? "Edit Gradient Fill" : "Gradient";
    targetRow.hidden = mode.type === "text-configure";

    if (mode.type === "raster-apply") {
      const doc = deps.getActiveDocument()!;
      const hasEffectiveSelection = resolveEffectiveSelectionMask(doc) !== null;
      targetScope = hasEffectiveSelection ? "selection" : "canvas";
      targetSelect.disabled = !hasEffectiveSelection;
      targetSelect.value = targetScope;
    }

    typeSelect.value = gradientType;
    centerXInput.value = formatNormalizedValue(centerX);
    centerYInput.value = formatNormalizedValue(centerY);

    const syncTypeVisibility = () => {
      headingRow.hidden = gradientType === "radial";
      centerControls.hidden = gradientType === "linear";
    };

    function render() {
      drawCurveCanvas(curveCanvas, nodes, activeNodeId);
      drawPreviewCanvas(previewCanvas, nodes, gradientType, headingDegrees, centerX, centerY, previewDragMode);
      renderNodeList(nodeList, nodes, activeNodeId, (id) => {
        activeNodeId = id;
        render();
      }, (id, colour) => {
        nodes = updateGradientNodeColour(nodes, id, colour);
        activeNodeId = id;
        activePresetId = null;
        render();
      }, (id) => {
        nodes = removeGradientNode(nodes, id);
        activeNodeId = activeNodeId === id ? nodes[0]?.id ?? null : activeNodeId;
        activePresetId = null;
        render();
      });
      renderPresetButtons(presetList, activePresetId, onPresetApply);
      applyIcons();
    }

    function applyConfig(config: GradientConfig, presetId: string | null = null) {
      gradientType = config.gradientType;
      nodes = config.nodes;
      headingDegrees = config.headingDegrees;
      centerX = clampNormalized(config.centerX);
      centerY = clampNormalized(config.centerY);
      activeNodeId = nodes[0]?.id ?? null;
      activePresetId = presetId;
      typeSelect.value = gradientType;
      centerXInput.value = formatNormalizedValue(centerX);
      centerYInput.value = formatNormalizedValue(centerY);
      radialHandle?.setValue(headingDegrees);
      syncTypeVisibility();
      render();
    }

    function onPresetApply(presetId: string) {
      const config = createGradientConfigFromPreset(presetId);
      if (!config) return;
      applyConfig(config, presetId);
    }

    const onTypeChange = () => {
      gradientType = typeSelect.value === "radial" ? "radial" : "linear";
      activePresetId = null;
      syncTypeVisibility();
      render();
    };

    const onCenterXChange = () => {
      centerX = clampNormalized(Number.parseFloat(centerXInput.value) || 0.5);
      centerXInput.value = formatNormalizedValue(centerX);
      activePresetId = null;
      render();
    };

    const onCenterYChange = () => {
      centerY = clampNormalized(Number.parseFloat(centerYInput.value) || 0.5);
      centerYInput.value = formatNormalizedValue(centerY);
      activePresetId = null;
      render();
    };

    const onTargetChange = () => {
      targetScope = targetSelect.value === "canvas" ? "canvas" : "selection";
    };

    const getCanvasNodePosition = (event: PointerEvent) => {
      const rect = curveCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
      const y = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
      return { x, y };
    };

    const findNodeAtEvent = (event: PointerEvent) => {
      const rect = curveCanvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      return nodes.find((node) => {
        const x = node.x * rect.width;
        const y = (1 - node.y) * rect.height;
        return Math.hypot(localX - x, localY - y) <= 10;
      }) ?? null;
    };

    const onPointerDown = (event: PointerEvent) => {
      const node = findNodeAtEvent(event);
      if (node) {
        activeNodeId = node.id;
      } else {
        const point = getCanvasNodePosition(event);
        const nextNodes = addGradientNodeAtPosition(nodes, point.x, point.y, getNextPaletteColour(deps.getGradientPaletteColours(), nodes));
        activeNodeId = getInsertedNodeId(nodes, nextNodes);
        nodes = nextNodes;
        activePresetId = null;
      }
      draggingPointerId = event.pointerId;
      curveCanvas.setPointerCapture(event.pointerId);
      render();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId || !activeNodeId) return;
      const point = getCanvasNodePosition(event);
      nodes = moveGradientNode(nodes, activeNodeId, point.x, point.y);
      activePresetId = null;
      render();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId) return;
      draggingPointerId = null;
      curveCanvas.releasePointerCapture(event.pointerId);
    };

    const onAddNode = () => {
      const nextNodes = addGradientNode(nodes, getNextPaletteColour(deps.getGradientPaletteColours(), nodes));
      activeNodeId = getInsertedNodeId(nodes, nextNodes);
      nodes = nextNodes;
      activePresetId = null;
      render();
    };

    const getPreviewPoint = (event: PointerEvent) => {
      const rect = previewCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return {
        x,
        y,
        width: rect.width,
        height: rect.height,
        normalizedX: clampNormalized(x / Math.max(rect.width, 1)),
        normalizedY: clampNormalized(y / Math.max(rect.height, 1)),
      };
    };

    const getPreviewDragModeAtEvent = (event: PointerEvent): PreviewDragMode | null => {
      const point = getPreviewPoint(event);
      if (gradientType === "radial") {
        const handleX = centerX * point.width;
        const handleY = centerY * point.height;
        return Math.hypot(point.x - handleX, point.y - handleY) <= 14 ? "radial-center" : null;
      }

      const handles = getLinearPreviewHandlePoints(point.width, point.height, headingDegrees);
      if (Math.hypot(point.x - handles.start.x, point.y - handles.start.y) <= 14) {
        return "linear-start";
      }
      if (Math.hypot(point.x - handles.end.x, point.y - handles.end.y) <= 14) {
        return "linear-end";
      }
      return null;
    };

    const onPreviewPointerDown = (event: PointerEvent) => {
      const nextMode = getPreviewDragModeAtEvent(event);
      if (!nextMode) return;
      previewDragMode = nextMode;
      previewDraggingPointerId = event.pointerId;
      previewCanvas.setPointerCapture(event.pointerId);
      render();
    };

    const onPreviewPointerMove = (event: PointerEvent) => {
      if (previewDraggingPointerId !== event.pointerId || !previewDragMode) return;
      const point = getPreviewPoint(event);
      activePresetId = null;

      if (previewDragMode === "radial-center") {
        centerX = point.normalizedX;
        centerY = point.normalizedY;
        centerXInput.value = formatNormalizedValue(centerX);
        centerYInput.value = formatNormalizedValue(centerY);
      } else {
        const centerPxX = point.width / 2;
        const centerPxY = point.height / 2;
        const deltaX = previewDragMode === "linear-start" ? centerPxX - point.x : point.x - centerPxX;
        const deltaY = previewDragMode === "linear-start" ? centerPxY - point.y : point.y - centerPxY;
        headingDegrees = ((Math.atan2(deltaY, deltaX) * 180) / Math.PI + 360) % 360;
        radialHandle?.setValue(headingDegrees);
      }

      render();
    };

    const onPreviewPointerUp = (event: PointerEvent) => {
      if (previewDraggingPointerId !== event.pointerId) return;
      previewDraggingPointerId = null;
      previewDragMode = null;
      previewCanvas.releasePointerCapture(event.pointerId);
      render();
    };

    const onReset = () => {
      const paletteColours = resolveGradientPaletteColours(deps.getGradientPaletteColours());
      applyConfig({
        gradientType: "linear",
        nodes: resetGradientNodes(paletteColours[0], paletteColours[1] ?? paletteColours[0]),
        headingDegrees: DEFAULT_GRADIENT_HEADING_DEGREES,
        centerX: 0.5,
        centerY: 0.5,
      });
      activePresetId = null;
      render();
    };

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      curveCanvas.removeEventListener("pointerdown", onPointerDown);
      curveCanvas.removeEventListener("pointermove", onPointerMove);
      curveCanvas.removeEventListener("pointerup", onPointerUp);
      previewCanvas.removeEventListener("pointerdown", onPreviewPointerDown);
      previewCanvas.removeEventListener("pointermove", onPreviewPointerMove);
      previewCanvas.removeEventListener("pointerup", onPreviewPointerUp);
      addButton.removeEventListener("click", onAddNode);
      resetButton.removeEventListener("click", onReset);
      applyButton.removeEventListener("click", onApply);
      targetSelect.removeEventListener("change", onTargetChange);
      typeSelect.removeEventListener("change", onTypeChange);
      centerXInput.removeEventListener("input", onCenterXChange);
      centerYInput.removeEventListener("input", onCenterYChange);
      radialHandle?.destroy();
      radialHandle = null;
    };

    const onApply = () => {
      const config: GradientConfig = { gradientType, nodes, headingDegrees, centerX, centerY };

      if (mode.type === "text-configure") {
        closeModal({ backdrop });
        finish();
        mode.onConfirm({ config });
        return;
      }

      const currentDoc = deps.getActiveDocument();
      if (!currentDoc) {
        deps.showToast("No document open", "error");
        return;
      }
      const currentLayer = deps.getActiveLayer(currentDoc);
      const targetError = getGradientToolTargetError(currentLayer);
      if (targetError) {
        deps.showToast(targetError, "error");
        return;
      }

      beginDocumentOperation(snapshotDocument(currentDoc));
      const result = applyGradientToSelection(currentDoc, currentLayer as RasterLayer, config, targetScope);
      if (!result.ok) {
        cancelDocumentOperation();
        deps.showToast(result.message, result.variant);
        return;
      }
      markDocumentOperationChanged();
      commitDocumentOperation(currentDoc, "Applied gradient");
      closeModal({ backdrop });
      finish();
      deps.renderEditorState();
      deps.showToast(result.message, "success");
    };

    syncTypeVisibility();
    curveCanvas.addEventListener("pointerdown", onPointerDown);
    curveCanvas.addEventListener("pointermove", onPointerMove);
    curveCanvas.addEventListener("pointerup", onPointerUp);
    previewCanvas.addEventListener("pointerdown", onPreviewPointerDown);
    previewCanvas.addEventListener("pointermove", onPreviewPointerMove);
    previewCanvas.addEventListener("pointerup", onPreviewPointerUp);
    addButton.addEventListener("click", onAddNode);
    resetButton.addEventListener("click", onReset);
    applyButton.addEventListener("click", onApply);
    targetSelect.addEventListener("change", onTargetChange);
    typeSelect.addEventListener("change", onTypeChange);
    centerXInput.addEventListener("input", onCenterXChange);
    centerYInput.addEventListener("input", onCenterYChange);
    radialHandle = bindRadial({
      el: headingControl,
      min: 0,
      max: 359,
      step: 1,
      value: headingDegrees,
      formatValue: (value) => `${value}deg`,
      onChange: (value) => {
        headingDegrees = value;
        activePresetId = null;
        render();
      },
    });

    render();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: finish,
    });
  }

  function openGradientToolModal() {
    openEditor({ type: "raster-apply" });
  }

  function openGradientEditorForText(
    currentFill: LinearGradientFill | RadialGradientFill,
    onConfirm: (result: GradientEditorResult) => void,
  ) {
    openEditor({ type: "text-configure", onConfirm }, currentFill);
  }

  return { openGradientToolModal, openGradientEditorForText };
}
