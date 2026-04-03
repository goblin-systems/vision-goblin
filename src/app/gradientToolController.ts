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
  updateGradientNodeColour,
  type GradientCurveNode,
  type GradientTargetScope,
} from "../editor/gradient";
import { resolveEffectiveSelectionMask } from "../editor/fill";
import { beginDocumentOperation, cancelDocumentOperation, commitDocumentOperation, markDocumentOperationChanged } from "../editor/history";
import { snapshotDocument } from "../editor/documents";
import type { DocumentState, Layer, RasterLayer } from "../editor/types";

type ToastVariant = "success" | "error" | "info";

export interface GradientToolControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getGradientPaletteColours: () => string[];
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}

export interface GradientToolController {
  openGradientToolModal: () => void;
}

export function getGradientToolTargetError(layer: Layer | null) {
  if (!layer) return "Select a raster layer to apply a gradient";
  if (layer.locked) return "Unlock the active layer before applying a gradient";
  if (layer.type !== "raster") return "Select a raster layer to apply a gradient";
  return null;
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

  for (const node of nodes) {
    const x = node.x * canvas.width;
    const y = (1 - node.y) * canvas.height;
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = activeNodeId === node.id ? 3 : 2;
    ctx.strokeStyle = activeNodeId === node.id ? "#FFFFFF" : "rgba(7,11,21,0.9)";
    ctx.stroke();
  }
}

function drawPreviewCanvas(canvas: HTMLCanvasElement, nodes: GradientCurveNode[], headingDegrees: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sampler = createGradientSampler(nodes);
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

function renderNodeList(root: HTMLElement, nodes: GradientCurveNode[], onColourChange: (id: string, colour: string) => void, onRemove: (id: string) => void) {
  root.innerHTML = "";
  nodes.forEach((node, index) => {
    const row = document.createElement("div");
    row.className = "gradient-node-row";

    const label = document.createElement("div");
    label.className = "gradient-node-meta";
    label.textContent = index === 0 ? "Start" : index === nodes.length - 1 ? "End" : `Node ${index}`;

    const position = document.createElement("div");
    position.className = "gradient-node-position";
    position.textContent = `${Math.round(node.x * 100)}% / ${Math.round(node.y * 100)}%`;

    const input = document.createElement("input");
    input.type = "color";
    input.value = node.color;
    input.addEventListener("input", () => onColourChange(node.id, input.value));

    row.append(label, position, input);
    if (index > 0 && index < nodes.length - 1) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "secondary-btn slim-btn";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => onRemove(node.id));
      row.append(removeButton);
    }
    root.append(row);
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
  function openGradientToolModal() {
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

    const backdrop = byId<HTMLElement>("gradient-tool-modal");
    const curveCanvas = byId<HTMLCanvasElement>("gradient-curve-canvas");
    const previewCanvas = byId<HTMLCanvasElement>("gradient-preview-canvas");
    const nodeList = byId<HTMLElement>("gradient-node-list");
    const addButton = byId<HTMLButtonElement>("gradient-add-node-btn");
    const resetButton = byId<HTMLButtonElement>("gradient-reset-btn");
    const applyButton = byId<HTMLButtonElement>("gradient-apply-btn");
    const targetSelect = byId<HTMLSelectElement>("gradient-target-select");
    const headingControl = byId<HTMLElement>("gradient-heading-control");

    const hasEffectiveSelection = resolveEffectiveSelectionMask(doc) !== null;

    let nodes = createPaletteGradientNodes(deps.getGradientPaletteColours());
    let activeNodeId: string | null = null;
    let draggingPointerId: number | null = null;
    let targetScope: GradientTargetScope = hasEffectiveSelection ? "selection" : "canvas";
    let headingDegrees = DEFAULT_GRADIENT_HEADING_DEGREES;
    let radialHandle: RadialHandle | null = null;

    targetSelect.disabled = !hasEffectiveSelection;
    targetSelect.value = targetScope;

    const onTargetChange = () => {
      targetScope = targetSelect.value === "canvas" ? "canvas" : "selection";
    };

    const render = () => {
      drawCurveCanvas(curveCanvas, nodes, activeNodeId);
      drawPreviewCanvas(previewCanvas, nodes, headingDegrees);
      renderNodeList(nodeList, nodes, (id, colour) => {
        nodes = updateGradientNodeColour(nodes, id, colour);
        render();
      }, (id) => {
        nodes = removeGradientNode(nodes, id);
        activeNodeId = activeNodeId === id ? null : activeNodeId;
        render();
      });
      applyIcons();
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
      }
      draggingPointerId = event.pointerId;
      curveCanvas.setPointerCapture(event.pointerId);
      render();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (draggingPointerId !== event.pointerId || !activeNodeId) return;
      const point = getCanvasNodePosition(event);
      nodes = moveGradientNode(nodes, activeNodeId, point.x, point.y);
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
      render();
    };

    const onReset = () => {
      const paletteColours = resolveGradientPaletteColours(deps.getGradientPaletteColours());
      nodes = resetGradientNodes(paletteColours[0], paletteColours[1] ?? paletteColours[0]);
      activeNodeId = null;
      headingDegrees = DEFAULT_GRADIENT_HEADING_DEGREES;
      radialHandle?.setValue(headingDegrees);
      render();
    };

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      curveCanvas.removeEventListener("pointerdown", onPointerDown);
      curveCanvas.removeEventListener("pointermove", onPointerMove);
      curveCanvas.removeEventListener("pointerup", onPointerUp);
      addButton.removeEventListener("click", onAddNode);
      resetButton.removeEventListener("click", onReset);
      applyButton.removeEventListener("click", onApply);
      targetSelect.removeEventListener("change", onTargetChange);
      radialHandle?.destroy();
      radialHandle = null;
    };

    const onApply = () => {
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
      const result = applyGradientToSelection(currentDoc, currentLayer as RasterLayer, nodes, targetScope, headingDegrees);
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

    curveCanvas.addEventListener("pointerdown", onPointerDown);
    curveCanvas.addEventListener("pointermove", onPointerMove);
    curveCanvas.addEventListener("pointerup", onPointerUp);
    addButton.addEventListener("click", onAddNode);
    resetButton.addEventListener("click", onReset);
    applyButton.addEventListener("click", onApply);
    targetSelect.addEventListener("change", onTargetChange);
    radialHandle = bindRadial({
      el: headingControl,
      min: 0,
      max: 359,
      step: 1,
      value: headingDegrees,
      formatValue: (value) => `${value}deg`,
      onChange: (value) => {
        headingDegrees = value;
        drawPreviewCanvas(previewCanvas, nodes, headingDegrees);
      },
    });

    render();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: finish,
    });
  }

  return { openGradientToolModal };
}
