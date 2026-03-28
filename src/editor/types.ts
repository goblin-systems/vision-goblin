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
  locked: boolean;
  isBackground?: boolean;
  fillColor?: string;
  effects?: LayerEffect[];
  /** Optional grayscale mask canvas (white = reveal, black = hide). */
  mask?: HTMLCanvasElement;
}

export interface RasterLayer extends LayerBase {
  type: "raster";
}

export interface TextLayerData {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  kerning: number;
  rotationDeg: number;
  alignment: "left" | "center" | "right";
  fillColor: string;
  bold: boolean;
  italic: boolean;
  boxWidth: number | null;
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

export interface TransformDraft {
  layerId: string;
  sourceCanvas: HTMLCanvasElement;
  centerX: number;
  centerY: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  snapshot: string;
}

export interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
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
}

export interface SerializedLayer {
  type?: "raster" | "text" | "shape" | "adjustment" | "smart-object";
  id: string;
  name: string;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  locked: boolean;
  isBackground?: boolean;
  fillColor?: string;
  dataUrl: string;
  effects?: LayerEffect[];
  textData?: TextLayerData;
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
  cloneOffsetX: number;
  cloneOffsetY: number;
  creationLayerId: string | null;
}
