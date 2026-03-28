/**
 * Command Palette — searchable overlay for invoking any registered command.
 *
 * Opens via Ctrl+K. Keyboard-first interaction with fuzzy-ish filtering,
 * category grouping, shortcut display, and recent command tracking.
 */

import { getAllCommands, executeCommand, type CommandDefinition } from "./commands";

// ---------------------------------------------------------------------------
// Recent command tracking (in-memory, max 10)
// ---------------------------------------------------------------------------

const MAX_RECENT = 10;
let recentCommandIds: string[] = [];

export function getRecentCommandIds(): readonly string[] {
  return recentCommandIds;
}

function pushRecent(id: string) {
  recentCommandIds = [id, ...recentCommandIds.filter((r) => r !== id)].slice(0, MAX_RECENT);
}

// ---------------------------------------------------------------------------
// Fuzzy-ish scoring: substring + word-boundary bonus
// ---------------------------------------------------------------------------

/** Returns a score >= 0 if query matches text. Higher = better. -1 = no match. */
export function scoreMatch(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 1; // empty query matches everything

  // Exact substring match
  const idx = lower.indexOf(q);
  if (idx === -1) {
    // Try matching each query word independently
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return -1;
    let total = 0;
    for (const word of words) {
      const wIdx = lower.indexOf(word);
      if (wIdx === -1) return -1;
      total += wIdx === 0 ? 3 : 1;
    }
    return total;
  }

  // Bonus for start-of-string or word boundary
  let score = 10 - Math.min(idx, 9);
  if (idx === 0) score += 5;
  else if (lower[idx - 1] === " " || lower[idx - 1] === "/") score += 3;
  if (q.length === lower.length) score += 5; // exact match
  return score;
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

export interface PaletteItem {
  command: CommandDefinition;
  score: number;
  isRecent: boolean;
}

export function filterCommands(query: string): PaletteItem[] {
  const all = getAllCommands();
  const results: PaletteItem[] = [];

  for (const cmd of all) {
    // Skip duplicate redo-alt
    if (cmd.id === "redo-alt") continue;

    const labelScore = scoreMatch(cmd.label, query);
    const catScore = scoreMatch(cmd.category, query);
    const idScore = scoreMatch(cmd.id, query);
    const best = Math.max(labelScore, catScore, idScore);
    if (best < 0) continue;

    const isRecent = recentCommandIds.includes(cmd.id);
    results.push({ command: cmd, score: best + (isRecent ? 20 : 0), isRecent });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// Category display names & icons
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  file: "File",
  edit: "Edit",
  canvas: "Canvas",
  select: "Select",
  adjust: "Adjust",
  layer: "Layer",
  window: "Window",
  tool: "Tool",
};

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat;
}

// ---------------------------------------------------------------------------
// DOM rendering
// ---------------------------------------------------------------------------

let paletteEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let activeIndex = 0;
let currentItems: PaletteItem[] = [];
let isOpen = false;

export function isPaletteOpen(): boolean {
  return isOpen;
}

function getOrCreateDOM(): { palette: HTMLElement; input: HTMLInputElement; list: HTMLElement } {
  if (paletteEl && inputEl && listEl) return { palette: paletteEl, input: inputEl, list: listEl };

  paletteEl = document.createElement("div");
  paletteEl.className = "command-palette-backdrop";
  paletteEl.setAttribute("hidden", "");

  const card = document.createElement("div");
  card.className = "command-palette-card";

  inputEl = document.createElement("input");
  inputEl.className = "command-palette-input";
  inputEl.type = "text";
  inputEl.placeholder = "Type a command…";
  inputEl.setAttribute("autocomplete", "off");
  inputEl.setAttribute("spellcheck", "false");

  listEl = document.createElement("div");
  listEl.className = "command-palette-list";
  listEl.setAttribute("role", "listbox");

  card.appendChild(inputEl);
  card.appendChild(listEl);
  paletteEl.appendChild(card);
  document.body.appendChild(paletteEl);

  // Input events
  inputEl.addEventListener("input", () => {
    updateList(inputEl!.value);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  });

  // Click backdrop to close
  paletteEl.addEventListener("mousedown", (e) => {
    if (e.target === paletteEl) {
      e.preventDefault();
      closePalette();
    }
  });

  return { palette: paletteEl, input: inputEl, list: listEl };
}

function renderItems() {
  if (!listEl) return;
  listEl.innerHTML = "";

  if (currentItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "command-palette-empty";
    empty.textContent = "No matching commands";
    listEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < currentItems.length; i++) {
    const item = currentItems[i];
    const row = document.createElement("button");
    row.className = "command-palette-item";
    row.setAttribute("role", "option");
    if (i === activeIndex) row.classList.add("is-active");
    if (!item.command.enabled()) row.classList.add("is-disabled");

    const labelSpan = document.createElement("span");
    labelSpan.className = "command-palette-item-label";
    labelSpan.textContent = item.command.label;

    const catSpan = document.createElement("span");
    catSpan.className = "command-palette-item-category";
    catSpan.textContent = categoryLabel(item.command.category);

    row.appendChild(labelSpan);

    if (item.command.shortcut) {
      const shortcutSpan = document.createElement("span");
      shortcutSpan.className = "command-palette-item-shortcut";
      shortcutSpan.textContent = item.command.shortcut;
      row.appendChild(shortcutSpan);
    }

    row.appendChild(catSpan);

    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      activeIndex = i;
      executeActive();
    });

    row.addEventListener("mouseenter", () => {
      activeIndex = i;
      highlightActive();
    });

    listEl!.appendChild(row);
  }
}

function highlightActive() {
  if (!listEl) return;
  const items = listEl.querySelectorAll(".command-palette-item");
  items.forEach((el, i) => {
    el.classList.toggle("is-active", i === activeIndex);
  });
  // Scroll active into view
  const active = items[activeIndex] as HTMLElement | undefined;
  if (active) active.scrollIntoView({ block: "nearest" });
}

function setActiveIndex(idx: number) {
  if (currentItems.length === 0) return;
  activeIndex = ((idx % currentItems.length) + currentItems.length) % currentItems.length;
  highlightActive();
}

function updateList(query: string) {
  currentItems = filterCommands(query);
  activeIndex = 0;
  renderItems();
}

function executeActive() {
  const item = currentItems[activeIndex];
  if (!item) return;
  if (!item.command.enabled()) return;
  pushRecent(item.command.id);
  closePalette();
  executeCommand(item.command.id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openPalette() {
  const { palette, input } = getOrCreateDOM();
  isOpen = true;
  palette.removeAttribute("hidden");
  input.value = "";
  updateList("");
  // Use requestAnimationFrame to ensure the element is visible before focusing
  requestAnimationFrame(() => input.focus());
}

export function closePalette() {
  if (!paletteEl) return;
  isOpen = false;
  paletteEl.setAttribute("hidden", "");
}

export function togglePalette() {
  if (isOpen) closePalette();
  else openPalette();
}
