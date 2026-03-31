import type { ToolName } from "../../settings";
import {
  GOBLIN_AMBIENT_COMMENTARY,
  GOBLIN_AMBIENT_ICON,
  GOBLIN_EASTER_EGG_MESSAGES,
  GOBLIN_HIDDEN_UI_TARGETS,
  GOBLIN_TRIGGER_RULES,
  pickRandomItem,
  type GoblinEasterEggFamily,
} from "./content";
import { recordRollingWindowEvent, isEditableEventTarget } from "./events";
import { createGoblinSessionState } from "./sessionState";
import { createGoblinActivityTracker } from "./activityTracker";
import { createGoblinToastPresenter, type GoblinToastPresenter } from "./toastPresenter";

export type GoblinSignal =
  | { type: "activity" }
  | { type: "layer-created" }
  | { type: "undo-succeeded" }
  | { type: "eyedropper-sampled" };

export interface GoblinPersonalityController {
  init: () => void;
  signal: (signal: GoblinSignal) => void;
  destroy: () => void;
}

export interface GoblinPersonalityControllerDeps {
  subtitleElement: HTMLElement;
  toastRoot: HTMLElement;
  canvasStage: HTMLElement;
  editorCanvas: HTMLCanvasElement;
  getActiveTool: () => ToolName;
  random?: () => number;
  now?: () => number;
  setTimeoutFn?: (handler: () => void, timeout?: number) => number;
  clearTimeoutFn?: (timerId: number) => void;
  presenter?: GoblinToastPresenter;
}

export function createGoblinPersonalityController(deps: GoblinPersonalityControllerDeps): GoblinPersonalityController {
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const setTimeoutFn = deps.setTimeoutFn ?? ((handler, timeout) => window.setTimeout(handler, timeout));
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((timerId) => window.clearTimeout(timerId));
  const presenter = deps.presenter ?? createGoblinToastPresenter(deps.toastRoot);
  const sessionState = createGoblinSessionState(random);
  const activityTracker = createGoblinActivityTracker({
    ...GOBLIN_TRIGGER_RULES.ambient,
    now,
    random,
    setTimeoutFn,
    clearTimeoutFn,
    onCommentaryEligible: () => {
      presenter.showToast({
        message: pickRandomItem(GOBLIN_AMBIENT_COMMENTARY, random),
        icon: GOBLIN_AMBIENT_ICON,
        subtle: true,
      });
    },
  });

  let initialized = false;
  let layerCreatedTimestamps: number[] = [];
  let undoTimestamps: number[] = [];
  let eyedropperSampleTimestamps: number[] = [];
  let eyedropperHoldTimer: number | null = null;
  const cleanupCallbacks: Array<() => void> = [];

  function cancelEyedropperHold() {
    if (eyedropperHoldTimer === null) {
      return;
    }

    clearTimeoutFn(eyedropperHoldTimer);
    eyedropperHoldTimer = null;
  }

  function showEasterEgg(family: GoblinEasterEggFamily) {
    if (!sessionState.markEasterEggSeen(family)) {
      return;
    }

    const toast = pickRandomItem(GOBLIN_EASTER_EGG_MESSAGES[family], random);
    presenter.showToast(toast);
  }

  function maybeTriggerThreshold(family: GoblinEasterEggFamily, timestamps: readonly number[], windowMs: number, threshold: number) {
    if (sessionState.hasSeenEasterEgg(family)) {
      return [...timestamps];
    }

    const result = recordRollingWindowEvent(timestamps, now(), windowMs, threshold);
    if (result.matched) {
      showEasterEgg(family);
    }

    return result.timestamps;
  }

  function onCanvasActivity(event: Event) {
    if (event.type === "pointermove") {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.buttons === 0) {
        return;
      }
    }

    activityTracker.recordActivity();
  }

  function onGlobalKeydown(event: KeyboardEvent) {
    if (isEditableEventTarget(event.target)) {
      return;
    }

    activityTracker.recordActivity();
  }

  function onUiClick(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("[data-tool], [data-nav-id], #undo-btn, #redo-btn, #add-layer-btn, #document-tabs button")) {
      activityTracker.recordActivity();
    }
  }

  function onEditorCanvasPointerDown() {
    activityTracker.recordActivity();

    if (deps.getActiveTool() !== "eyedropper" || sessionState.hasSeenEasterEgg("colour-picker-hesitation")) {
      return;
    }

    cancelEyedropperHold();
    eyedropperHoldTimer = setTimeoutFn(() => {
      eyedropperHoldTimer = null;
      showEasterEgg("colour-picker-hesitation");
    }, GOBLIN_TRIGGER_RULES.colourPickerHoldMs);
  }

  function onEditorCanvasPointerEnd() {
    cancelEyedropperHold();
  }

  function bindEventListener(target: EventTarget, eventName: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
    target.addEventListener(eventName, listener, options);
    cleanupCallbacks.push(() => target.removeEventListener(eventName, listener, options));
  }

  function bindHiddenUiDiscovery() {
    for (const hiddenTarget of GOBLIN_HIDDEN_UI_TARGETS) {
      const element = document.querySelector<HTMLElement>(hiddenTarget.selector);
      if (!element) {
        continue;
      }

      bindEventListener(element, "click", (event) => {
        if (hiddenTarget.id === "canvas-stage") {
          const target = event.target;
          if (target instanceof Element && target.closest("#editor-canvas")) {
            return;
          }
        }

        showEasterEgg("hidden-ui-discovery");
      });
    }
  }

  return {
    init: () => {
      if (initialized) {
        return;
      }

      initialized = true;
      deps.subtitleElement.textContent = sessionState.getSlogan();

      bindHiddenUiDiscovery();
      bindEventListener(deps.canvasStage, "pointerdown", onCanvasActivity);
      bindEventListener(deps.canvasStage, "pointermove", onCanvasActivity);
      bindEventListener(deps.canvasStage, "wheel", onCanvasActivity, { passive: true });
      bindEventListener(window, "keydown", ((event: Event) => onGlobalKeydown(event as KeyboardEvent)) as EventListener);
      bindEventListener(document, "click", onUiClick);
      bindEventListener(deps.editorCanvas, "pointerdown", onEditorCanvasPointerDown);
      bindEventListener(deps.editorCanvas, "pointerup", onEditorCanvasPointerEnd);
      bindEventListener(deps.editorCanvas, "pointercancel", onEditorCanvasPointerEnd);
      bindEventListener(deps.editorCanvas, "pointerleave", onEditorCanvasPointerEnd);
    },
    signal: (signal) => {
      switch (signal.type) {
        case "activity": {
          activityTracker.recordActivity();
          return;
        }
        case "layer-created": {
          activityTracker.recordActivity();
          layerCreatedTimestamps = maybeTriggerThreshold(
            "layer-chaos",
            layerCreatedTimestamps,
            GOBLIN_TRIGGER_RULES.layerChaos.windowMs,
            GOBLIN_TRIGGER_RULES.layerChaos.threshold,
          );
          return;
        }
        case "undo-succeeded": {
          activityTracker.recordActivity();
          undoTimestamps = maybeTriggerThreshold(
            "undo-spam",
            undoTimestamps,
            GOBLIN_TRIGGER_RULES.undoSpam.windowMs,
            GOBLIN_TRIGGER_RULES.undoSpam.threshold,
          );
          return;
        }
        case "eyedropper-sampled": {
          activityTracker.recordActivity();
          eyedropperSampleTimestamps = maybeTriggerThreshold(
            "colour-picker-hesitation",
            eyedropperSampleTimestamps,
            GOBLIN_TRIGGER_RULES.colourPickerSampleBurst.windowMs,
            GOBLIN_TRIGGER_RULES.colourPickerSampleBurst.threshold,
          );
          return;
        }
      }
    },
    destroy: () => {
      cancelEyedropperHold();
      activityTracker.destroy();
      presenter.destroy();
      while (cleanupCallbacks.length > 0) {
        cleanupCallbacks.pop()?.();
      }
      initialized = false;
    },
  };
}
