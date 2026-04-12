import type { ToolName } from "../settings";

export type ActiveTool = ToolName;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// ---------------------------------------------------------------------------
// Layer types — discriminated union
// ---------------------------------------------------------------------------

export interface LayerBase {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  sourceCanvas?: HTMLCanvasElement;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  blendMode?: GlobalCompositeOperation;
  locked: boolean;
  isBackground?: boolean;
  fillColor?: string;
  effects?: LayerEffect[];
  /** Optional grayscale mask canvas (white = reveal, black = hide). */
  mask?: HTMLCanvasElement;
  aiProvenance?: AiProvenanceRecord;
}

export interface AiProvenanceRecord {
  providerId: string;
  model?: string;
  taskId: string;
  family: string;
  operation: string;
  prompt?: string;
  warnings: string[];
  createdAt: string;
}

export interface RasterLayer extends LayerBase {
  type: "raster";
}

// ---------------------------------------------------------------------------
// Text fill and stroke types
// ---------------------------------------------------------------------------

export interface GradientStop {
  offset: number; // 0–1
  color: string;
}

export interface SolidFill {
  type: "solid";
  color: string;
}

export interface LinearGradientFill {
  type: "linear-gradient";
  angle: number; // degrees, 0 = left-to-right, 90 = top-to-bottom
  stops: GradientStop[];
}

export interface RadialGradientFill {
  type: "radial-gradient";
  stops: GradientStop[];
  centerX?: number;
  centerY?: number;
}

export type GradientType = "linear" | "radial";

export type TextFill = SolidFill | LinearGradientFill | RadialGradientFill;

export interface TextStroke {
  color: string;
  width: number;
}

/**
 * Extract a representative CSS color string from a TextFill.
 * Returns the solid color for SolidFill, or the first gradient stop color.
 * Useful for UI code that needs a single color (inspector, canvas editing overlay).
 */
export function getTextFillColor(fill: TextFill): string {
  if (fill.type === "solid") return fill.color;
  return fill.stops[0]?.color ?? "#ffffff";
}

export interface TextLayerData {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  kerning: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  alignment: "left" | "center" | "right";
  fill: TextFill;
  stroke: TextStroke | null;
  /**
   * @deprecated Use `fill` instead. Kept for backward compatibility with code
   * that hasn't been migrated yet (inspector, AI, text editing controller).
   * Always reflects `getTextFillColor(fill)` after rendering.
   */
  fillColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  boxWidth: number | null;
  boxHeight: number | null;
}

export interface TextLayer extends LayerBase {
  type: "text";
  textData: TextLayerData;
}

export type ShapeKind = "rectangle" | "ellipse" | "line";

export interface ShapeLayerData {
  kind: ShapeKind;
  width: number;
  height: number;
  rotationDeg: number;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth: number;
  cornerRadius: number;
}

export interface ShapeLayer extends LayerBase {
  type: "shape";
  shapeData: ShapeLayerData;
}

// ---------------------------------------------------------------------------
// Adjustment layer — non-destructive tonal/colour corrections
// ---------------------------------------------------------------------------

export type AdjustmentKind =
  | "brightness-contrast"
  | "hue-saturation"
  | "levels"
  | "curves"
  | "color-balance"
  | "gradient-map";

export interface AdjustmentLayerData {
  kind: AdjustmentKind;
  params: Record<string, unknown>;
}

export interface AdjustmentLayer extends LayerBase {
  type: "adjustment";
  adjustmentData: AdjustmentLayerData;
}

// ---------------------------------------------------------------------------
// Smart object layer — non-destructive embedded asset
// ---------------------------------------------------------------------------

export interface SmartObjectLayerData {
  /** Original image encoded as a data URL (persisted). */
  sourceDataUrl: string;
  /** Original pixel width before any transform. */
  sourceWidth: number;
  /** Original pixel height before any transform. */
  sourceHeight: number;
  /** Accumulated non-destructive scale X (default 1). */
  scaleX: number;
  /** Accumulated non-destructive scale Y (default 1). */
  scaleY: number;
  /** Accumulated non-destructive rotation in degrees (default 0). */
  rotateDeg: number;
  /** Runtime-only loaded source canvas (NOT serialized). */
  sourceCanvas?: HTMLCanvasElement;
}

export interface SmartObjectLayer extends LayerBase {
  type: "smart-object";
  smartObjectData: SmartObjectLayerData;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustmentLayer | SmartObjectLayer;

// ---------------------------------------------------------------------------
// Layer effects / layer styles
// ---------------------------------------------------------------------------

export interface DropShadowEffect {
  type: "drop-shadow";
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
  enabled: boolean;
}

export interface InnerShadowEffect {
  type: "inner-shadow";
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
  enabled: boolean;
}

export interface OuterGlowEffect {
  type: "outer-glow";
  color: string;
  blur: number;
  spread: number;
  opacity: number;
  enabled: boolean;
}

export interface OutlineEffect {
  type: "outline";
  color: string;
  width: number;
  opacity: number;
  enabled: boolean;
}

export interface ColorOverlayEffect {
  type: "color-overlay";
  color: string;
  opacity: number;
  enabled: boolean;
}

export type EffectType = "drop-shadow" | "inner-shadow" | "outer-glow" | "outline" | "color-overlay";
export type LayerEffect = DropShadowEffect | InnerShadowEffect | OuterGlowEffect | OutlineEffect | ColorOverlayEffect;

export interface StylePreset {
  name: string;
  effects: LayerEffect[];
  builtIn?: boolean;
}

export type TransformHandle = "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w";

export type TransformIntent = "layer" | "text-layout";

export interface ShapeTransformMemberSnapshot {
  layerId: string;
  centerX: number;
  centerY: number;
}

export interface TransformDraft {
  layerId: string;
  intent: TransformIntent;
  sourceCanvas: HTMLCanvasElement;
  frameBounds?: Rect;
  previewLayerIds?: string[];
  groupMembers?: ShapeTransformMemberSnapshot[];
  centerX: number;
  centerY: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  textBoxWidth?: number | null;
  textBoxHeight?: number | null;
  previewOverride?: {
    canvas: HTMLCanvasElement;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  snapshot: string;
}

export interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
}

export interface BrushState {
  brushSize: number;
  brushOpacity: number;
  activeColour: string;
  healingSampleSpread: number;
  healingBlend: number;
}

export interface SelectionPath {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
}

export interface DocumentState {
  id: string;
  name: string;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  dirty: boolean;
  layers: Layer[];
  activeLayerId: string;
  /** IDs of layers included in a multi-selection (always includes activeLayerId when non-empty). */
  selectedLayerIds: string[];
  history: string[];
  historyIndex: number;
  sourcePath: string | null;
  projectPath: string | null;
  background: "transparent" | "white";
  undoStack: string[];
  redoStack: string[];
  cropRect: Rect | null;
  selectionRect: Rect | null;
  selectionShape: "rect" | "ellipse";
  selectionInverted: boolean;
  selectionPath: SelectionPath | null;
  selectionMask: HTMLCanvasElement | null;
  guides: Guide[];
  customFonts: Array<{ family: string; dataUrl: string; fileName: string }>;
}

/**
 * Serialized text data — accepts both new format (fill + stroke) and legacy
 * format (fillColor only, no fill). Deserialization migrates legacy format.
 */
export interface SerializedTextLayerData {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  kerning: number;
  scaleX?: number;
  scaleY?: number;
  rotationDeg: number;
  skewXDeg?: number;
  skewYDeg?: number;
  alignment: "left" | "center" | "right";
  /** New fill field (present in current format). */
  fill?: TextFill;
  /** New stroke field (present in current format). */
  stroke?: TextStroke | null;
  /** @deprecated Legacy fill color (present in old saves). */
  fillColor?: string;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  boxWidth: number | null;
  boxHeight?: number | null;
}

export interface SerializedLayer {
  type?: "raster" | "text" | "shape" | "adjustment" | "smart-object";
  id: string;
  name: string;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  blendMode?: string;
  locked: boolean;
  isBackground?: boolean;
  fillColor?: string;
  dataUrl: string;
  effects?: LayerEffect[];
  textData?: SerializedTextLayerData;
  shapeData?: ShapeLayerData;
  adjustmentData?: AdjustmentLayerData;
  smartObjectData?: {
    sourceDataUrl: string;
    sourceWidth: number;
    sourceHeight: number;
    scaleX: number;
    scaleY: number;
    rotateDeg: number;
  };
  maskDataUrl?: string;
  aiProvenance?: AiProvenanceRecord;
}

export interface SerializedDocument {
  name: string;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  activeLayerId: string;
  selectedLayerIds?: string[];
  history: string[];
  sourcePath: string | null;
  background: "transparent" | "white";
  selectionRect: Rect | null;
  selectionShape?: "rect" | "ellipse";
  selectionInverted: boolean;
  selectionPath?: SelectionPath | null;
  selectionMaskDataUrl?: string | null;
  guides?: Guide[];
  customFonts?: Array<{ family: string; dataUrl: string; fileName: string }>;
  layers: SerializedLayer[];
}

export interface CanvasBounds {
  originX: number;
  originY: number;
  width: number;
  height: number;
  scale: number;
}

export interface PointerState {
  mode: "none" | "move-layer" | "paint" | "pan" | "crop" | "marquee" | "pivot-drag" | "lasso" | "create-layer";
  lastDocX: number;
  lastDocY: number;
  startDocX: number;
  startDocY: number;
  startClientX: number;
  startClientY: number;
  startLayerX: number;
  startLayerY: number;
  startPanX: number;
  startPanY: number;
  startSelectionRect: Rect | null;
  startSelectionInverted: boolean;
  transformHandle: TransformHandle | null;
  startLayerWidth: number;
  startLayerHeight: number;
  startScaleX: number;
  startScaleY: number;
  startCenterX: number;
  startCenterY: number;
  startPivotX: number;
  startPivotY: number;
  startRotateDeg: number;
  startSkewXDeg: number;
  startSkewYDeg: number;
  startTextBoxWidth: number;
  startTextBoxHeight: number;
  cloneOffsetX: number;
  cloneOffsetY: number;
  creationLayerId: string | null;
}
