import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoblinPersonalityController } from "./personalityController";
import { GOBLIN_SLOGANS } from "./content";
import type { GoblinToastPresenter } from "./toastPresenter";

function createFixture() {
  document.body.innerHTML = `
    <div class="window-title-wrap"><p class="window-subtitle">placeholder</p></div>
    <button id="checkerboard-nav" type="button">checkerboard</button>
    <button id="grid-nav" type="button">grid</button>
    <div id="canvas-stage"><canvas id="editor-canvas"></canvas></div>
    <div id="goblin-toast"></div>
  `;

  const subtitleElement = document.querySelector<HTMLElement>(".window-subtitle");
  const canvasStage = document.querySelector<HTMLElement>("#canvas-stage");
  const editorCanvas = document.querySelector<HTMLCanvasElement>("#editor-canvas");
  const toastRoot = document.querySelector<HTMLElement>("#goblin-toast");

  if (!subtitleElement || !canvasStage || !editorCanvas || !toastRoot) {
    throw new Error("Missing goblin test fixture");
  }

  const presenter: GoblinToastPresenter = {
    showToast: vi.fn(),
    destroy: vi.fn(),
  };

  let activeTool: "move" | "eyedropper" = "move";

  const controller = createGoblinPersonalityController({
    subtitleElement,
    canvasStage,
    editorCanvas,
    toastRoot,
    presenter,
    random: () => 0,
    getActiveTool: () => activeTool,
  });

  return {
    controller,
    presenter,
    subtitleElement,
    canvasStage,
    editorCanvas,
    setActiveTool: (tool: "move" | "eyedropper") => {
      activeTool = tool;
    },
  };
}

describe("goblin personality controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("sets one approved subtitle for the session", () => {
    const { controller, subtitleElement } = createFixture();

    controller.init();
    controller.signal({ type: "activity" });

    expect(GOBLIN_SLOGANS).toContain(subtitleElement.textContent);
    expect(subtitleElement.textContent).toBe(GOBLIN_SLOGANS[0]);
    controller.destroy();
  });

  it("fires layer chaos only once per session", () => {
    const { controller, presenter } = createFixture();
    controller.init();

    for (let index = 0; index < 5; index += 1) {
      controller.signal({ type: "layer-created" });
    }

    for (let index = 0; index < 5; index += 1) {
      controller.signal({ type: "layer-created" });
    }

    expect(presenter.showToast).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("fires colour picker hesitation from repeated successful samples", () => {
    const { controller, presenter } = createFixture();
    controller.init();

    for (let index = 0; index < 4; index += 1) {
      controller.signal({ type: "eyedropper-sampled" });
      vi.advanceTimersByTime(1_000);
    }

    expect(presenter.showToast).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("fires hidden ui discovery from bound targets only once", () => {
    const { controller, presenter } = createFixture();
    controller.init();

    document.querySelector<HTMLButtonElement>("#checkerboard-nav")?.click();
    document.querySelector<HTMLButtonElement>("#grid-nav")?.click();

    expect(presenter.showToast).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("fires ambient commentary only while the user remains active", () => {
    const { controller, presenter, canvasStage } = createFixture();
    controller.init();

    canvasStage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(5_000);
    canvasStage.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(5_000);
    canvasStage.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(5_000);
    canvasStage.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(5_000);

    expect(presenter.showToast).toHaveBeenCalledTimes(1);
    expect(presenter.showToast).toHaveBeenLastCalledWith(expect.objectContaining({ subtle: true, icon: "sparkles" }));
    controller.destroy();
  });

  it("fires colour picker hesitation from an eyedropper hold", () => {
    const { controller, presenter, editorCanvas, setActiveTool } = createFixture();
    controller.init();
    setActiveTool("eyedropper");

    editorCanvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(800);

    expect(presenter.showToast).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
});
