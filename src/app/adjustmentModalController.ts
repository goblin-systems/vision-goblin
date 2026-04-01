import { closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { pushHistory } from "../editor/history";
import type { DocumentState, Layer } from "../editor/types";
import { cloneCanvas, snapshotDocument, syncLayerSource } from "../editor/documents";
import { normalizeSelectionToMask, invertMask } from "../editor/selection";
import {
  applyAddNoise,
  applyBrightnessContrast,
  applyColorBalance,
  applyCurves,
  applyGaussianBlur,
  applyGradientMap,
  applyHueSaturation,
  applyLevels,
  applyLUT,
  applyMotionBlur,
  applyReduceNoise,
  applySharpen,
  buildCurveLUT,
  computeHistogram,
  GRADIENT_PRESETS,
  parseCubeLUT,
  type AddNoiseParams,
  type BrightnessContrastParams,
  type ColorBalanceParams,
  type CurvePoint,
  type GaussianBlurParams,
  type GradientStop,
  type HueSaturationParams,
  type LUT3D,
  type LevelsParams,
  type MotionBlurParams,
  type ReduceNoiseParams,
  type SharpenParams,
} from "../editor/adjustments";
import { clamp } from "../editor/utils";
import { byId } from "./dom";

export interface AdjustmentModalControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  renderCanvas: () => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

export interface AdjustmentModalController {
  openBrightnessContrastModal(): void;
  openHueSaturationModal(): void;
  openGaussianBlurModal(): void;
  openSharpenModal(): void;
  openColorBalanceModal(): void;
  openLUTModal(): void;
  openGradientMapModal(): void;
  openCurvesModal(): void;
  openLevelsModal(): void;
  openMotionBlurModal(): void;
  openAddNoiseModal(): void;
  openReduceNoiseModal(): void;
}

interface AdjustmentSessionTarget {
  doc: DocumentState;
  layer: Layer;
  sourceCanvas: HTMLCanvasElement;
  selectionMask?: HTMLCanvasElement | null;
}

interface CommitDestructiveAdjustmentOptions {
  target: AdjustmentSessionTarget;
  applyPreview: (source: ImageData) => ImageData;
  historyLabel: string;
  successMessage: string;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

interface SliderSpec<P> {
  rangeId: string;
  outputId: string;
  key: keyof P;
}

interface SliderModalOptions<P> {
  modalId: string;
  applyBtnId: string;
  sliders: SliderSpec<P>[];
  defaultParams: P;
  applyFn: (source: ImageData, params: P) => ImageData;
  historyLabel: string;
}

export function getAdjustmentSessionError(doc: DocumentState | null, layer: Layer | null): string | null {
  if (!doc) return "No document open";
  if (!layer) return "No active layer";
  if (layer.locked) return "Layer is locked";
  return null;
}

export function restoreDestructiveAdjustmentPreview(target: AdjustmentSessionTarget, renderCanvas: () => void) {
  const layerCtx = target.layer.canvas.getContext("2d");
  if (layerCtx) {
    layerCtx.clearRect(0, 0, target.layer.canvas.width, target.layer.canvas.height);
    layerCtx.drawImage(target.sourceCanvas, 0, 0);
  }
  renderCanvas();
}

export function commitDestructiveAdjustment(options: CommitDestructiveAdjustmentOptions) {
  const { target, applyPreview, historyLabel, successMessage, renderEditorState, showToast } = options;
  target.doc.undoStack.push(snapshotDocument(target.doc));
  target.doc.redoStack = [];
  const ctx = target.sourceCanvas.getContext("2d");
  if (ctx) {
    const src = ctx.getImageData(0, 0, target.sourceCanvas.width, target.sourceCanvas.height);
    const result = applyPreview(src);
    applyAdjustedResultToLayer(target, result);
  }
  syncLayerSource(target.layer);
  target.doc.dirty = true;
  pushHistory(target.doc, historyLabel);
  renderEditorState();
  showToast(successMessage, "success");
}

function applyAdjustedResultToLayer(target: AdjustmentSessionTarget, result: ImageData): void {
  const selectionMask = target.selectionMask ?? null;
  const layerCtx = target.layer.canvas.getContext("2d");
  if (!layerCtx) return;

  if (selectionMask === null) {
    // No active selection — replace the full layer content directly.
    layerCtx.clearRect(0, 0, target.layer.canvas.width, target.layer.canvas.height);
    layerCtx.putImageData(result, 0, 0);
    return;
  }

  // Selection-scoped composite:
  // 1. Paint the adjusted result onto a temp canvas.
  // 2. Clip it through the selection mask so only the selected area remains.
  // 3. Restore the original pixels, then draw the masked adjusted region on top.
  const tmp = document.createElement("canvas");
  tmp.width = target.layer.canvas.width;
  tmp.height = target.layer.canvas.height;
  const tmpCtx = tmp.getContext("2d");
  if (!tmpCtx) return;

  tmpCtx.putImageData(result, 0, 0);
  tmpCtx.globalCompositeOperation = "destination-in";
  tmpCtx.drawImage(selectionMask, -target.layer.x, -target.layer.y);
  tmpCtx.globalCompositeOperation = "source-over";

  layerCtx.clearRect(0, 0, target.layer.canvas.width, target.layer.canvas.height);
  layerCtx.drawImage(target.sourceCanvas, 0, 0);
  layerCtx.drawImage(tmp, 0, 0);
}

function renderPreview(target: AdjustmentSessionTarget, renderCanvas: () => void, applyPreview: (source: ImageData) => ImageData) {
  const ctx = target.sourceCanvas.getContext("2d");
  if (!ctx) return;
  const src = ctx.getImageData(0, 0, target.sourceCanvas.width, target.sourceCanvas.height);
  const result = applyPreview(src);
  applyAdjustedResultToLayer(target, result);
  renderCanvas();
}

function resolveAdjustmentSessionTarget(deps: Pick<AdjustmentModalControllerDeps, "getActiveDocument" | "getActiveLayer" | "showToast">): AdjustmentSessionTarget | null {
  const maybeDoc = deps.getActiveDocument();
  const maybeLayer = maybeDoc ? deps.getActiveLayer(maybeDoc) : null;
  const error = getAdjustmentSessionError(maybeDoc, maybeLayer);
  if (error) {
    deps.showToast(error, "error");
    return null;
  }
  const doc = maybeDoc as DocumentState;
  const layer = maybeLayer as Layer;

  let selectionMask = normalizeSelectionToMask(
    doc.width,
    doc.height,
    doc.selectionRect,
    doc.selectionShape,
    doc.selectionPath,
    doc.selectionMask,
  );
  if (selectionMask !== null && doc.selectionInverted === true) {
    invertMask(selectionMask);
  }

  return {
    doc,
    layer,
    sourceCanvas: cloneCanvas(layer.canvas),
    selectionMask,
  };
}

function createSession(target: AdjustmentSessionTarget, deps: Pick<AdjustmentModalControllerDeps, "renderCanvas" | "renderEditorState" | "showToast">) {
  let previewRaf = 0;
  let settled = false;
  const cleanupFns: Array<() => void> = [];

  return {
    schedulePreview(applyPreview: (source: ImageData) => ImageData) {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(() => renderPreview(target, deps.renderCanvas, applyPreview));
    },
    addCleanup(fn: () => void) {
      cleanupFns.push(fn);
    },
    finish(applied: boolean) {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(previewRaf);
      for (const cleanup of cleanupFns) cleanup();
      if (!applied) {
        restoreDestructiveAdjustmentPreview(target, deps.renderCanvas);
      }
    },
    commit(backdrop: HTMLElement, historyLabel: string, successMessage: string, applyPreview: (source: ImageData) => ImageData) {
      closeModal({ backdrop });
      commitDestructiveAdjustment({
        target,
        applyPreview,
        historyLabel,
        successMessage,
        renderEditorState: deps.renderEditorState,
        showToast: deps.showToast,
      });
      this.finish(true);
    },
  };
}

function drawGradientPreview(previewCtx: CanvasRenderingContext2D, stops: GradientStop[]) {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const grad = previewCtx.createLinearGradient(0, 0, 256, 0);
  for (const stop of sorted) {
    grad.addColorStop(stop.position, `rgb(${stop.r},${stop.g},${stop.b})`);
  }
  previewCtx.fillStyle = grad;
  previewCtx.fillRect(0, 0, 256, 24);
}

function createCurveUiRenderer(curveCtx: CanvasRenderingContext2D, points: CurvePoint[], pointRadius: number) {
  return () => {
    curveCtx.clearRect(0, 0, 256, 256);
    curveCtx.strokeStyle = "#333";
    curveCtx.lineWidth = 1;
    for (let grid = 64; grid < 256; grid += 64) {
      curveCtx.beginPath();
      curveCtx.moveTo(grid, 0);
      curveCtx.lineTo(grid, 256);
      curveCtx.moveTo(0, grid);
      curveCtx.lineTo(256, grid);
      curveCtx.stroke();
    }
    curveCtx.strokeStyle = "#555";
    curveCtx.beginPath();
    curveCtx.moveTo(0, 255);
    curveCtx.lineTo(255, 0);
    curveCtx.stroke();

    const lut = buildCurveLUT(points);
    curveCtx.strokeStyle = "#fff";
    curveCtx.lineWidth = 2;
    curveCtx.beginPath();
    for (let x = 0; x < 256; x += 1) {
      const y = 255 - lut[x];
      if (x === 0) curveCtx.moveTo(x, y);
      else curveCtx.lineTo(x, y);
    }
    curveCtx.stroke();

    curveCtx.fillStyle = "#fff";
    for (const point of points) {
      curveCtx.beginPath();
      curveCtx.arc(point.x, 255 - point.y, pointRadius, 0, Math.PI * 2);
      curveCtx.fill();
    }
  };
}

export function createAdjustmentModalController(deps: AdjustmentModalControllerDeps): AdjustmentModalController {
  function openSliderModal<P extends object>(options: SliderModalOptions<P>) {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>(options.modalId);
    const applyBtn = byId<HTMLButtonElement>(options.applyBtnId);
    const params = { ...options.defaultParams };
    const session = createSession(target, deps);

    for (const slider of options.sliders) {
      const range = byId<HTMLInputElement>(slider.rangeId);
      const output = byId<HTMLElement>(slider.outputId);
      range.value = String(params[slider.key]);
      output.textContent = String(params[slider.key]);
    }

    const sliderHandlers = options.sliders.map((slider) => ({
      slider,
      handler: () => {
        const range = byId<HTMLInputElement>(slider.rangeId);
        const output = byId<HTMLElement>(slider.outputId);
        (params as Record<keyof P, number>)[slider.key] = Number(range.value);
        output.textContent = range.value;
        session.schedulePreview((source) => options.applyFn(source, params));
      },
    }));

    for (const { slider, handler } of sliderHandlers) {
      byId<HTMLInputElement>(slider.rangeId).addEventListener("input", handler);
      session.addCleanup(() => byId<HTMLInputElement>(slider.rangeId).removeEventListener("input", handler));
    }

    const onApply = () => {
      session.commit(backdrop, options.historyLabel, `${options.historyLabel} applied`, (source) => options.applyFn(source, params));
    };

    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openBrightnessContrastModal() {
    openSliderModal<BrightnessContrastParams>({
      modalId: "brightness-contrast-modal",
      applyBtnId: "bc-apply-btn",
      sliders: [
        { rangeId: "bc-brightness-range", outputId: "bc-brightness-value", key: "brightness" },
        { rangeId: "bc-contrast-range", outputId: "bc-contrast-value", key: "contrast" },
      ],
      defaultParams: { brightness: 0, contrast: 0 },
      applyFn: applyBrightnessContrast,
      historyLabel: "Brightness/Contrast",
    });
  }

  function openHueSaturationModal() {
    openSliderModal<HueSaturationParams>({
      modalId: "hue-saturation-modal",
      applyBtnId: "hs-apply-btn",
      sliders: [
        { rangeId: "hs-hue-range", outputId: "hs-hue-value", key: "hue" },
        { rangeId: "hs-saturation-range", outputId: "hs-saturation-value", key: "saturation" },
        { rangeId: "hs-lightness-range", outputId: "hs-lightness-value", key: "lightness" },
      ],
      defaultParams: { hue: 0, saturation: 0, lightness: 0 },
      applyFn: applyHueSaturation,
      historyLabel: "Hue/Saturation",
    });
  }

  function openGaussianBlurModal() {
    openSliderModal<GaussianBlurParams>({
      modalId: "gaussian-blur-modal",
      applyBtnId: "blur-apply-btn",
      sliders: [
        { rangeId: "blur-radius-range", outputId: "blur-radius-value", key: "radius" },
      ],
      defaultParams: { radius: 0 },
      applyFn: applyGaussianBlur,
      historyLabel: "Gaussian Blur",
    });
  }

  function openSharpenModal() {
    openSliderModal<SharpenParams>({
      modalId: "sharpen-modal",
      applyBtnId: "sharpen-apply-btn",
      sliders: [
        { rangeId: "sharpen-amount-range", outputId: "sharpen-amount-value", key: "amount" },
        { rangeId: "sharpen-radius-range", outputId: "sharpen-radius-value", key: "radius" },
      ],
      defaultParams: { amount: 0, radius: 1 },
      applyFn: applySharpen,
      historyLabel: "Sharpen",
    });
  }

  function openColorBalanceModal() {
    openSliderModal<ColorBalanceParams>({
      modalId: "color-balance-modal",
      applyBtnId: "cb-apply-btn",
      sliders: [
        { rangeId: "cb-sh-cr-range", outputId: "cb-sh-cr-value", key: "shadowsCyanRed" },
        { rangeId: "cb-sh-mg-range", outputId: "cb-sh-mg-value", key: "shadowsMagentaGreen" },
        { rangeId: "cb-sh-yb-range", outputId: "cb-sh-yb-value", key: "shadowsYellowBlue" },
        { rangeId: "cb-mt-cr-range", outputId: "cb-mt-cr-value", key: "midtonesCyanRed" },
        { rangeId: "cb-mt-mg-range", outputId: "cb-mt-mg-value", key: "midtonesMagentaGreen" },
        { rangeId: "cb-mt-yb-range", outputId: "cb-mt-yb-value", key: "midtonesYellowBlue" },
        { rangeId: "cb-hl-cr-range", outputId: "cb-hl-cr-value", key: "highlightsCyanRed" },
        { rangeId: "cb-hl-mg-range", outputId: "cb-hl-mg-value", key: "highlightsMagentaGreen" },
        { rangeId: "cb-hl-yb-range", outputId: "cb-hl-yb-value", key: "highlightsYellowBlue" },
      ],
      defaultParams: {
        shadowsCyanRed: 0,
        shadowsMagentaGreen: 0,
        shadowsYellowBlue: 0,
        midtonesCyanRed: 0,
        midtonesMagentaGreen: 0,
        midtonesYellowBlue: 0,
        highlightsCyanRed: 0,
        highlightsMagentaGreen: 0,
        highlightsYellowBlue: 0,
      },
      applyFn: applyColorBalance,
      historyLabel: "Color Balance",
    });
  }

  function openLUTModal() {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>("lut-modal");
    const applyBtn = byId<HTMLButtonElement>("lut-apply-btn");
    const fileInput = byId<HTMLInputElement>("lut-file-input");
    const statusEl = byId<HTMLElement>("lut-status");
    const intensityRange = byId<HTMLInputElement>("lut-intensity-range");
    const intensityOutput = byId<HTMLElement>("lut-intensity-value");
    const session = createSession(target, deps);

    fileInput.value = "";
    statusEl.textContent = "No LUT loaded.";
    intensityRange.value = "100";
    intensityOutput.textContent = "100";
    applyBtn.disabled = true;

    let currentLut: LUT3D | null = null;

    const onFileChange = () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const lut = parseCubeLUT(text);
        if (lut) {
          currentLut = lut;
          statusEl.textContent = `Loaded: ${file.name} (${lut.size}^3)`;
          applyBtn.disabled = false;
          const lutForPreview = currentLut;
          session.schedulePreview((source) => applyLUT(source, { lut: lutForPreview, intensity: Number(intensityRange.value) }));
        } else {
          currentLut = null;
          statusEl.textContent = "Failed to parse LUT file.";
          applyBtn.disabled = true;
        }
      };
      reader.readAsText(file);
    };

    const onIntensityInput = () => {
      intensityOutput.textContent = intensityRange.value;
      if (!currentLut) return;
      const lutForPreview = currentLut;
      session.schedulePreview((source) => applyLUT(source, { lut: lutForPreview, intensity: Number(intensityRange.value) }));
    };

    const onApply = () => {
      if (!currentLut) return;
      const lutForApply = currentLut;
      session.commit(backdrop, "Apply LUT", "LUT applied", (source) => applyLUT(source, { lut: lutForApply, intensity: Number(intensityRange.value) }));
    };

    fileInput.addEventListener("change", onFileChange);
    intensityRange.addEventListener("input", onIntensityInput);
    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => fileInput.removeEventListener("change", onFileChange));
    session.addCleanup(() => intensityRange.removeEventListener("input", onIntensityInput));
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openGradientMapModal() {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>("gradient-map-modal");
    const applyBtn = byId<HTMLButtonElement>("gradient-map-apply-btn");
    const presetSelect = byId<HTMLSelectElement>("gradient-map-preset");
    const previewCanvas = byId<HTMLCanvasElement>("gradient-map-preview");
    const previewCtx = previewCanvas.getContext("2d");
    if (!previewCtx) return;

    const session = createSession(target, deps);
    presetSelect.innerHTML = "";
    for (let i = 0; i < GRADIENT_PRESETS.length; i += 1) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = GRADIENT_PRESETS[i].name;
      presetSelect.appendChild(option);
    }
    presetSelect.value = "0";

    let currentStops: GradientStop[] = [...GRADIENT_PRESETS[0].stops];

    const onPresetChange = () => {
      currentStops = [...GRADIENT_PRESETS[Number(presetSelect.value)].stops];
      drawGradientPreview(previewCtx, currentStops);
      session.schedulePreview((source) => applyGradientMap(source, { stops: currentStops }));
    };

    const onApply = () => {
      session.commit(backdrop, "Gradient Map", "Gradient Map applied", (source) => applyGradientMap(source, { stops: currentStops }));
    };

    presetSelect.addEventListener("change", onPresetChange);
    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => presetSelect.removeEventListener("change", onPresetChange));
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    drawGradientPreview(previewCtx, currentStops);
    session.schedulePreview((source) => applyGradientMap(source, { stops: currentStops }));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openCurvesModal() {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>("curves-modal");
    const applyBtn = byId<HTMLButtonElement>("curves-apply-btn");
    const resetBtn = byId<HTMLButtonElement>("curves-reset-btn");
    const curveCanvas = byId<HTMLCanvasElement>("curves-canvas");
    const curveCtx = curveCanvas.getContext("2d");
    if (!curveCtx) return;

    let points: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    let draggingIndex = -1;
    const pointRadius = 6;
    const session = createSession(target, deps);
    const drawCurveUi = createCurveUiRenderer(curveCtx, points, pointRadius);

    function canvasPoint(event: MouseEvent): [number, number] {
      const rect = curveCanvas.getBoundingClientRect();
      const scaleX = 256 / rect.width;
      const scaleY = 256 / rect.height;
      return [
        clamp(Math.round((event.clientX - rect.left) * scaleX), 0, 255),
        clamp(Math.round((event.clientY - rect.top) * scaleY), 0, 255),
      ];
    }

    function findPointAt(x: number, y: number) {
      for (let i = 0; i < points.length; i += 1) {
        const dx = points[i].x - x;
        const dy = 255 - points[i].y - y;
        if (dx * dx + dy * dy <= pointRadius * pointRadius * 4) return i;
      }
      return -1;
    }

    const onMouseDown = (event: MouseEvent) => {
      const [x, y] = canvasPoint(event);
      if (event.button === 2) {
        const index = findPointAt(x, y);
        if (index >= 0 && points.length > 2) {
          points.splice(index, 1);
          drawCurveUi();
          session.schedulePreview((source) => applyCurves(source, { points }));
        }
        return;
      }

      const index = findPointAt(x, y);
      if (index >= 0) {
        draggingIndex = index;
        return;
      }

      const newPoint = { x, y: 255 - y };
      points.push(newPoint);
      points.sort((a, b) => a.x - b.x);
      draggingIndex = points.findIndex((point) => point.x === newPoint.x && point.y === newPoint.y);
      drawCurveUi();
      session.schedulePreview((source) => applyCurves(source, { points }));
    };

    const onMouseMove = (event: MouseEvent) => {
      if (draggingIndex < 0) return;
      const [x, y] = canvasPoint(event);
      points[draggingIndex].x = x;
      points[draggingIndex].y = 255 - y;
      drawCurveUi();
      session.schedulePreview((source) => applyCurves(source, { points }));
    };

    const onMouseUp = () => {
      if (draggingIndex < 0) return;
      draggingIndex = -1;
      points.sort((a, b) => a.x - b.x);
      drawCurveUi();
    };

    const onReset = () => {
      points = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
      drawCurveUi();
      session.schedulePreview((source) => applyCurves(source, { points }));
    };

    const onContextMenu = (event: Event) => event.preventDefault();
    const onApply = () => {
      session.commit(backdrop, "Curves", "Curves applied", (source) => applyCurves(source, { points }));
    };

    curveCanvas.addEventListener("mousedown", onMouseDown);
    curveCanvas.addEventListener("mousemove", onMouseMove);
    curveCanvas.addEventListener("mouseup", onMouseUp);
    curveCanvas.addEventListener("contextmenu", onContextMenu);
    resetBtn.addEventListener("click", onReset);
    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => curveCanvas.removeEventListener("mousedown", onMouseDown));
    session.addCleanup(() => curveCanvas.removeEventListener("mousemove", onMouseMove));
    session.addCleanup(() => curveCanvas.removeEventListener("mouseup", onMouseUp));
    session.addCleanup(() => curveCanvas.removeEventListener("contextmenu", onContextMenu));
    session.addCleanup(() => resetBtn.removeEventListener("click", onReset));
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    drawCurveUi();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openLevelsModal() {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>("levels-modal");
    const applyBtn = byId<HTMLButtonElement>("levels-apply-btn");
    const blackRange = byId<HTMLInputElement>("levels-black-range");
    const gammaRange = byId<HTMLInputElement>("levels-gamma-range");
    const whiteRange = byId<HTMLInputElement>("levels-white-range");
    const blackOutput = byId<HTMLElement>("levels-black-value");
    const gammaOutput = byId<HTMLElement>("levels-gamma-value");
    const whiteOutput = byId<HTMLElement>("levels-white-value");
    const histogramCanvas = byId<HTMLCanvasElement>("levels-histogram");
    const sourceCtx = target.sourceCanvas.getContext("2d");
    const histogramCtx = histogramCanvas.getContext("2d");
    if (!sourceCtx || !histogramCtx) return;

    const params: LevelsParams = { inputBlack: 0, gamma: 1, inputWhite: 255 };
    const session = createSession(target, deps);

    blackRange.value = "0";
    blackOutput.textContent = "0";
    gammaRange.value = "1";
    gammaOutput.textContent = "1.0";
    whiteRange.value = "255";
    whiteOutput.textContent = "255";

    const histogram = computeHistogram(sourceCtx.getImageData(0, 0, target.sourceCanvas.width, target.sourceCanvas.height));
    histogramCtx.clearRect(0, 0, 256, 100);
    const maxValue = Math.max(...histogram);
    if (maxValue > 0) {
      histogramCtx.fillStyle = "#aaa";
      for (let x = 0; x < 256; x += 1) {
        const height = histogram[x] / maxValue * 100;
        histogramCtx.fillRect(x, 100 - height, 1, height);
      }
    }

    const onBlackInput = () => {
      params.inputBlack = Number(blackRange.value);
      blackOutput.textContent = blackRange.value;
      session.schedulePreview((source) => applyLevels(source, params));
    };
    const onGammaInput = () => {
      params.gamma = Number(gammaRange.value);
      gammaOutput.textContent = Number(gammaRange.value).toFixed(2);
      session.schedulePreview((source) => applyLevels(source, params));
    };
    const onWhiteInput = () => {
      params.inputWhite = Number(whiteRange.value);
      whiteOutput.textContent = whiteRange.value;
      session.schedulePreview((source) => applyLevels(source, params));
    };
    const onApply = () => {
      session.commit(backdrop, "Levels", "Levels applied", (source) => applyLevels(source, params));
    };

    blackRange.addEventListener("input", onBlackInput);
    gammaRange.addEventListener("input", onGammaInput);
    whiteRange.addEventListener("input", onWhiteInput);
    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => blackRange.removeEventListener("input", onBlackInput));
    session.addCleanup(() => gammaRange.removeEventListener("input", onGammaInput));
    session.addCleanup(() => whiteRange.removeEventListener("input", onWhiteInput));
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openMotionBlurModal() {
    openSliderModal<MotionBlurParams>({
      modalId: "motion-blur-modal",
      applyBtnId: "mb-apply-btn",
      sliders: [
        { rangeId: "mb-angle-range", outputId: "mb-angle-value", key: "angle" },
        { rangeId: "mb-distance-range", outputId: "mb-distance-value", key: "distance" },
      ],
      defaultParams: { angle: 0, distance: 1 },
      applyFn: applyMotionBlur,
      historyLabel: "Motion Blur",
    });
  }

  function openAddNoiseModal() {
    const target = resolveAdjustmentSessionTarget(deps);
    if (!target) return;

    const backdrop = byId<HTMLElement>("add-noise-modal");
    const applyBtn = byId<HTMLButtonElement>("noise-apply-btn");
    const amountRange = byId<HTMLInputElement>("noise-amount-range");
    const amountOutput = byId<HTMLElement>("noise-amount-value");
    const monochromeCheck = byId<HTMLInputElement>("noise-mono-check");
    const params: AddNoiseParams = { amount: 0, monochrome: true };
    const session = createSession(target, deps);

    amountRange.value = "0";
    amountOutput.textContent = "0";
    monochromeCheck.checked = true;

    const onAmountInput = () => {
      params.amount = Number(amountRange.value);
      amountOutput.textContent = amountRange.value;
      session.schedulePreview((source) => applyAddNoise(source, params));
    };
    const onMonochromeChange = () => {
      params.monochrome = monochromeCheck.checked;
      session.schedulePreview((source) => applyAddNoise(source, params));
    };
    const onApply = () => {
      session.commit(backdrop, "Add Noise", "Add Noise applied", (source) => applyAddNoise(source, params));
    };

    amountRange.addEventListener("input", onAmountInput);
    monochromeCheck.addEventListener("change", onMonochromeChange);
    applyBtn.addEventListener("click", onApply);
    session.addCleanup(() => amountRange.removeEventListener("input", onAmountInput));
    session.addCleanup(() => monochromeCheck.removeEventListener("change", onMonochromeChange));
    session.addCleanup(() => applyBtn.removeEventListener("click", onApply));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => session.finish(false),
    });
  }

  function openReduceNoiseModal() {
    openSliderModal<ReduceNoiseParams>({
      modalId: "reduce-noise-modal",
      applyBtnId: "denoise-apply-btn",
      sliders: [
        { rangeId: "denoise-strength-range", outputId: "denoise-strength-value", key: "strength" },
      ],
      defaultParams: { strength: 0 },
      applyFn: applyReduceNoise,
      historyLabel: "Reduce Noise",
    });
  }

  return {
    openBrightnessContrastModal,
    openHueSaturationModal,
    openGaussianBlurModal,
    openSharpenModal,
    openColorBalanceModal,
    openLUTModal,
    openGradientMapModal,
    openCurvesModal,
    openLevelsModal,
    openMotionBlurModal,
    openAddNoiseModal,
    openReduceNoiseModal,
  };
}
