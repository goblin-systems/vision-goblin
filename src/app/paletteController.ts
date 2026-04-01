import { openModal, applyIcons } from "@goblin-systems/goblin-design-system";
import { byId } from "./dom";
import type { ColourPalette, VisionSettings } from "../settings";
import { DEFAULT_PALETTES } from "../settings";

export interface PaletteControllerDeps {
  getSettings: () => VisionSettings;
  persistSettings: (next: VisionSettings, message?: string) => Promise<void>;
  setActiveColour: (colour: string) => void;
  getActiveColour: () => string;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

export interface PaletteController {
  bind: () => void;
  renderSwatchStrip: () => void;
  renderPaletteSelect: () => void;
  openManageModal: () => void;
  swapPrimarySecondary: () => void;
}

function getPrimary(p: ColourPalette): string { return p.colours[0] ?? "#808080"; }
function getSecondary(p: ColourPalette): string { return p.colours[1] ?? "#808080"; }

export function createPaletteController(deps: PaletteControllerDeps): PaletteController {
  let selectingFor: "primary" | "secondary" = "primary";

  function getActivePalette(): ColourPalette {
    const s = deps.getSettings();
    return s.palettes.find((p) => p.id === s.activePaletteId) ?? s.palettes[0] ?? DEFAULT_PALETTES[0];
  }

  function persistAndSync() {
    void deps.persistSettings({ ...deps.getSettings() }).then(() => {
      renderPaletteSelect();
      renderSwatchStrip();
      syncSwatchUI();
    });
  }

  function renderSwatchStrip() {
    const strip = byId<HTMLElement>("palette-swatch-strip");
    const palette = getActivePalette();
    strip.innerHTML = "";
    for (const colour of palette.colours) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "swatch-chip";
      chip.style.background = colour;
      chip.title = colour;
      chip.setAttribute("aria-label", colour);
      chip.addEventListener("click", () => {
        applyColourFromSwatch(colour);
      });
      strip.appendChild(chip);
    }
  }

  function renderPaletteSelect() {
    const select = byId<HTMLSelectElement>("palette-select");
    const settings = deps.getSettings();
    select.innerHTML = "";
    for (const p of settings.palettes) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === settings.activePaletteId) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function applyColourFromSwatch(colour: string) {
    const palette = getActivePalette();
    if (selectingFor === "primary" && palette.colours.length > 0) {
      palette.colours[0] = colour;
    } else if (selectingFor === "secondary" && palette.colours.length > 1) {
      palette.colours[1] = colour;
    }
    deps.setActiveColour(colour);
    syncSwatchUI();
    void deps.persistSettings({ ...deps.getSettings() });
  }

  function syncSwatchUI() {
    const palette = getActivePalette();
    const primaryEl = byId<HTMLElement>("palette-primary-swatch");
    const secondaryEl = byId<HTMLElement>("palette-secondary-swatch");
    primaryEl.style.background = getPrimary(palette);
    secondaryEl.style.background = getSecondary(palette);
    primaryEl.classList.toggle("is-active", selectingFor === "primary");
    secondaryEl.classList.toggle("is-active", selectingFor === "secondary");
    byId<HTMLElement>("brush-colour-value").textContent = selectingFor === "primary" ? getPrimary(palette) : getSecondary(palette);
  }

  function swapPrimarySecondary() {
    const palette = getActivePalette();
    if (palette.colours.length >= 2) {
      const tmp = palette.colours[0];
      palette.colours[0] = palette.colours[1];
      palette.colours[1] = tmp;
    }
    deps.setActiveColour(selectingFor === "primary" ? getPrimary(palette) : getSecondary(palette));
    syncSwatchUI();
    renderSwatchStrip();
    void deps.persistSettings({ ...deps.getSettings() });
  }

  function switchActivePalette(paletteId: string) {
    const settings = deps.getSettings();
    const next = settings.palettes.find((p) => p.id === paletteId);
    if (!next) return;
    settings.activePaletteId = paletteId;
    deps.setActiveColour(getPrimary(next));
    selectingFor = "primary";
    syncSwatchUI();
    renderSwatchStrip();
    void deps.persistSettings({ ...settings });
  }

  function openManageModal() {
    const backdrop = byId<HTMLElement>("palette-modal");
    renderModalList();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onAccept: () => {},
    });
  }

  function clonePalette(source: ColourPalette) {
    const settings = deps.getSettings();
    if (settings.palettes.length >= 20) {
      deps.showToast("Maximum of 20 palettes reached", "error");
      return;
    }
    const id = `custom-${Date.now()}`;
    const clone: ColourPalette = {
      id,
      name: `${source.name} (copy)`,
      colours: [...source.colours],
    };
    settings.palettes.push(clone);
    settings.activePaletteId = id;
    deps.showToast(`Cloned "${source.name}" — edit your copy`, "success");
    void deps.persistSettings({ ...settings }).then(() => {
      renderModalList();
      persistAndSync();
    });
  }

  function renderModalList() {
    const list = byId<HTMLElement>("palette-modal-list");
    const settings = deps.getSettings();
    list.innerHTML = "";

    for (const palette of settings.palettes) {
      const card = document.createElement("div");
      card.className = "palette-modal-card";
      const isDefault = DEFAULT_PALETTES.some((d) => d.id === palette.id);

      // ── Header row: name + actions ──
      const header = document.createElement("div");
      header.className = "palette-modal-card-header";

      const nameEl = document.createElement("span");
      nameEl.className = "palette-modal-row-name";
      nameEl.textContent = palette.name;
      header.appendChild(nameEl);

      if (isDefault) {
        const cloneBtn = document.createElement("button");
        cloneBtn.type = "button";
        cloneBtn.className = "icon-btn";
        cloneBtn.title = "Clone to custom palette";
        cloneBtn.innerHTML = `<i data-lucide="copy-plus"></i>`;
        cloneBtn.addEventListener("click", () => clonePalette(palette));
        header.appendChild(cloneBtn);
      } else {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "icon-btn";
        deleteBtn.title = "Delete palette";
        deleteBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
        deleteBtn.addEventListener("click", () => {
          settings.palettes = settings.palettes.filter((p) => p.id !== palette.id);
          if (settings.activePaletteId === palette.id) {
            settings.activePaletteId = settings.palettes[0]?.id ?? DEFAULT_PALETTES[0].id;
          }
          deps.showToast(`Deleted palette "${palette.name}"`, "info");
          void deps.persistSettings({ ...settings }).then(() => {
            renderModalList();
            persistAndSync();
          });
        });
        header.appendChild(deleteBtn);
      }
      card.appendChild(header);

      // ── Colour chips ──
      const chipsRow = document.createElement("div");
      chipsRow.className = "palette-modal-chips";

      if (isDefault) {
        // Read-only preview
        for (const c of palette.colours) {
          const dot = document.createElement("span");
          dot.className = "palette-modal-chip-preview";
          dot.style.background = c;
          dot.title = c;
          chipsRow.appendChild(dot);
        }
      } else {
        // Editable chips
        const renderChips = () => {
          chipsRow.innerHTML = "";
          palette.colours.forEach((colour, i) => {
            const chipWrap = document.createElement("div");
            chipWrap.className = "palette-modal-chip-wrap";

            const colourInput = document.createElement("input");
            colourInput.type = "color";
            colourInput.value = colour;
            colourInput.className = "palette-modal-chip-input";
            colourInput.title = `Edit ${colour}`;
            colourInput.addEventListener("input", () => {
              palette.colours[i] = colourInput.value;
              persistAndSync();
            });
            chipWrap.appendChild(colourInput);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "palette-modal-chip-remove";
            removeBtn.title = "Remove colour";
            removeBtn.innerHTML = `<i data-lucide="x"></i>`;
            removeBtn.addEventListener("click", () => {
              palette.colours.splice(i, 1);
              renderChips();
              persistAndSync();
            });
            chipWrap.appendChild(removeBtn);

            chipsRow.appendChild(chipWrap);
          });

          if (palette.colours.length < 10) {
            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "palette-modal-chip-add";
            addBtn.title = "Add colour";
            addBtn.innerHTML = `<i data-lucide="plus"></i>`;
            addBtn.addEventListener("click", () => {
              if (palette.colours.length < 10) {
                palette.colours.push("#808080");
                renderChips();
                persistAndSync();
              }
            });
            chipsRow.appendChild(addBtn);
          }

          applyIcons();
        };
        renderChips();
      }

      card.appendChild(chipsRow);
      list.appendChild(card);
    }
    applyIcons();
  }

  function createPalette(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `custom-${Date.now()}`;
    const newPalette: ColourPalette = {
      id,
      name: trimmed,
      colours: ["#6C63FF", "#1A1A2E"],
    };
    const settings = deps.getSettings();
    if (settings.palettes.length >= 20) {
      deps.showToast("Maximum of 20 palettes reached", "error");
      return;
    }
    settings.palettes.push(newPalette);
    settings.activePaletteId = id;
    void deps.persistSettings({ ...settings }).then(() => {
      renderModalList();
      persistAndSync();
    });
    byId<HTMLInputElement>("palette-new-name").value = "";
    deps.showToast(`Created palette "${trimmed}"`, "success");
  }

  function bind() {
    byId<HTMLElement>("palette-primary-swatch").addEventListener("click", () => {
      selectingFor = "primary";
      deps.setActiveColour(getPrimary(getActivePalette()));
      syncSwatchUI();
    });

    byId<HTMLElement>("palette-secondary-swatch").addEventListener("click", () => {
      selectingFor = "secondary";
      deps.setActiveColour(getSecondary(getActivePalette()));
      syncSwatchUI();
    });

    byId<HTMLElement>("palette-swap-btn").addEventListener("click", swapPrimarySecondary);

    byId<HTMLSelectElement>("palette-select").addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      switchActivePalette(target.value);
    });

    byId<HTMLElement>("manage-palettes-btn").addEventListener("click", openManageModal);

    byId<HTMLElement>("palette-new-btn").addEventListener("click", () => {
      createPalette(byId<HTMLInputElement>("palette-new-name").value);
    });

    byId<HTMLInputElement>("palette-new-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createPalette(byId<HTMLInputElement>("palette-new-name").value);
      }
    });

    // Initialize
    renderPaletteSelect();
    renderSwatchStrip();
    syncSwatchUI();
  }

  return {
    bind,
    renderSwatchStrip,
    renderPaletteSelect,
    openManageModal,
    swapPrimarySecondary,
  };
}
