import { byId } from "@goblin-systems/goblin-design-system";

export { byId };

export interface AppDom {
  editorCanvas: HTMLCanvasElement;
  canvasStage: HTMLElement;
  canvasWrap: HTMLElement;
  fileOpenInput: HTMLInputElement;
  toast: HTMLElement;
}

export function createAppDom(): AppDom {
  return {
    editorCanvas: byId<HTMLCanvasElement>("editor-canvas"),
    canvasStage: byId<HTMLElement>("canvas-stage"),
    canvasWrap: document.querySelector(".canvas-editor-wrap") as HTMLElement,
    fileOpenInput: byId<HTMLInputElement>("file-open-input"),
    toast: byId<HTMLElement>("app-toast"),
  };
}
