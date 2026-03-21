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

export interface RasterLayer {
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

export interface DocumentState {
  id: string;
  name: string;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  dirty: boolean;
  layers: RasterLayer[];
  activeLayerId: string;
  history: string[];
  sourcePath: string | null;
  projectPath: string | null;
  background: "transparent" | "white";
  undoStack: string[];
  redoStack: string[];
  cropRect: Rect | null;
  selectionRect: Rect | null;
  selectionInverted: boolean;
  guides: Guide[];
}

export interface SerializedLayer {
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
}

export interface SerializedDocument {
  name: string;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  activeLayerId: string;
  history: string[];
  sourcePath: string | null;
  background: "transparent" | "white";
  selectionRect: Rect | null;
  selectionInverted: boolean;
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
  mode: "none" | "move-layer" | "paint" | "pan" | "crop" | "marquee" | "pivot-drag";
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
  startRotateDeg: number;
  startSkewXDeg: number;
  startSkewYDeg: number;
}
