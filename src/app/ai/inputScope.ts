import type { AiInputScope } from "./types";

export const AI_INPUT_SCOPE_OPTIONS: ReadonlyArray<{ value: AiInputScope; label: string }> = [
  { value: "selected-layers", label: "selected layers" },
  { value: "visible-content", label: "visible content" },
];

export const DEFAULT_AI_INPUT_SCOPE: AiInputScope = "selected-layers";

export function resolveAiInputScope(value: string | null | undefined): AiInputScope {
  return value === "visible-content"
    ? "visible-content"
    : "selected-layers";
}

export function renderAiInputScopeOptions(defaultValue: AiInputScope = DEFAULT_AI_INPUT_SCOPE): string {
  return AI_INPUT_SCOPE_OPTIONS
    .map((option) => `<option value="${option.value}"${option.value === defaultValue ? " selected" : ""}>${option.label}</option>`)
    .join("");
}
