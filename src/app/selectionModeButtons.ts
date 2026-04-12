import type { SelectionMode } from "../editor/selection";

const SELECTION_MODE_META: Record<SelectionMode, { actionLabel: string; buttonLabel: string; shortcut: string | null }> = {
  replace: { actionLabel: "Replace", buttonLabel: "Set", shortcut: null },
  add: { actionLabel: "Add", buttonLabel: "Add", shortcut: "Shift" },
  subtract: { actionLabel: "Remove", buttonLabel: "Remove", shortcut: "Ctrl" },
  intersect: { actionLabel: "Intersect", buttonLabel: "Intersect", shortcut: "Alt" },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getSelectionModeActionLabel(mode: SelectionMode): string {
  return SELECTION_MODE_META[mode].actionLabel;
}

export function getSelectionModeButtonLabel(mode: SelectionMode): string {
  return SELECTION_MODE_META[mode].buttonLabel;
}

export function getSelectionModeShortcut(mode: SelectionMode): string | null {
  return SELECTION_MODE_META[mode].shortcut;
}

export function renderSelectionModeIcon(mode: SelectionMode): string {
  const commonAttrs = 'class="selection-mode-btn__icon-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"';
  switch (mode) {
    case "replace":
      return '<i data-lucide="replace"></i>';
    case "add":
      return '<i data-lucide="plus"></i>';
    case "subtract":
      return '<i data-lucide="minus"></i>';
    case "intersect":
      return `<svg ${commonAttrs}><rect class="selection-mode-btn__shape" x="3.5" y="3.5" width="8" height="8" rx="1.25"></rect><rect class="selection-mode-btn__shape" x="8.5" y="8.5" width="8" height="8" rx="1.25"></rect><rect class="selection-mode-btn__overlap" x="8.5" y="8.5" width="3" height="3" rx="0.75"></rect></svg>`;
  }
}

export function renderSelectionModeButtonInner(
  mode: SelectionMode,
  options: { includeLabel?: boolean; includeShortcut?: boolean; label?: string } = {},
): string {
  const label = escapeHtml(options.label ?? getSelectionModeButtonLabel(mode));
  const shortcut = options.includeShortcut ? getSelectionModeShortcut(mode) : null;
  const parts = [
    `<span class="selection-mode-btn__icon">${renderSelectionModeIcon(mode)}</span>`,
  ];

  if (options.includeLabel) {
    parts.push(`<span class="selection-mode-btn__label">${label}</span>`);
  }
  if (shortcut) {
    parts.push(`<span class="selection-mode-btn__shortcut">${escapeHtml(shortcut)}</span>`);
  }

  return parts.join("");
}

export function decorateSelectionModeButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-selection-mode]").forEach((button) => {
    const mode = button.dataset.selectionMode as SelectionMode | undefined;
    if (!mode || !(mode in SELECTION_MODE_META)) {
      return;
    }

    const actionLabel = getSelectionModeActionLabel(mode);
    const shortcut = getSelectionModeShortcut(mode);
    button.innerHTML = renderSelectionModeButtonInner(mode, {
      includeLabel: true,
      includeShortcut: true,
    });
    button.setAttribute("aria-label", shortcut ? `${actionLabel} (${shortcut})` : actionLabel);
    button.setAttribute("title", shortcut ? `${actionLabel} (${shortcut})` : actionLabel);
  });
}
