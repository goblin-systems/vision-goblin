import { CURATED_LOCAL_FONT_FAMILIES, normalizeFontFamilyName } from "../fonts/curatedFontFamilies";

export interface FontFamilyPickerRefs {
  input: HTMLInputElement;
  optionsList: HTMLElement;
}

export interface FontFamilyPicker {
  setValue(value: string): void;
}

function normalizeFontFamily(value: string): string {
  return normalizeFontFamilyName(value);
}

function sortFontFamilyOptions(options: readonly string[]): string[] {
  return Array.from(new Set(options)).sort((left, right) => left.localeCompare(right));
}

export function createFontFamilyPicker(refs: FontFamilyPickerRefs, options: readonly string[] = CURATED_LOCAL_FONT_FAMILIES): FontFamilyPicker {
  const allOptions = sortFontFamilyOptions(options);
  let filteredOptions = allOptions.slice();
  let isOpen = false;
  let activeIndex = -1;
  let suppressInputOpen = false;

  const closeList = () => {
    isOpen = false;
    refs.input.setAttribute("aria-expanded", "false");
    refs.optionsList.hidden = true;
  };

  const renderOptions = () => {
    refs.optionsList.replaceChildren();
    if (filteredOptions.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "font-picker-option font-picker-option--empty";
      emptyState.textContent = "No matching fonts";
      refs.optionsList.appendChild(emptyState);
      refs.input.removeAttribute("aria-activedescendant");
      return;
    }

    filteredOptions.forEach((fontFamily, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `text-font-family-option-${index}`;
      option.className = "font-picker-option";
      option.role = "option";
      option.dataset.fontFamilyOption = fontFamily;
      option.ariaSelected = String(index === activeIndex);
      option.style.fontFamily = fontFamily;
      if (index === activeIndex) option.classList.add("is-active");
      option.textContent = fontFamily;
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      option.addEventListener("click", () => {
        commitSelection(fontFamily);
      });
      refs.optionsList.appendChild(option);
    });

    if (activeIndex >= 0) {
      refs.input.setAttribute("aria-activedescendant", `text-font-family-option-${activeIndex}`);
      return;
    }
    refs.input.removeAttribute("aria-activedescendant");
  };

  const openList = () => {
    isOpen = true;
    refs.input.setAttribute("aria-expanded", "true");
    refs.optionsList.hidden = false;
  };

  const commitSelection = (fontFamily: string) => {
    refs.input.value = fontFamily;
    filterOptions(fontFamily);
    closeList();
    suppressInputOpen = true;
    refs.input.dispatchEvent(new Event("input", { bubbles: true }));
    refs.input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  function filterOptions(value: string) {
    const normalizedValue = normalizeFontFamily(value);
    filteredOptions = allOptions.filter((option) => normalizeFontFamily(option).includes(normalizedValue));
    activeIndex = filteredOptions.findIndex((option) => normalizeFontFamily(option) === normalizedValue);
    if (activeIndex < 0 && filteredOptions.length > 0) activeIndex = 0;
    renderOptions();
  }

  const syncValue = (value: string) => {
    refs.input.value = value;
    filterOptions(value);
  };

  refs.input.setAttribute("role", "combobox");
  refs.input.setAttribute("aria-autocomplete", "list");
  refs.input.setAttribute("aria-controls", refs.optionsList.id);
  refs.input.setAttribute("aria-expanded", "false");
  refs.optionsList.setAttribute("role", "listbox");
  refs.optionsList.hidden = true;

  refs.input.addEventListener("focus", () => {
    filterOptions(refs.input.value);
    openList();
  });

  refs.input.addEventListener("input", () => {
    filterOptions(refs.input.value);
    if (suppressInputOpen) {
      suppressInputOpen = false;
      return;
    }
    openList();
  });

  refs.input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!isOpen) {
        filterOptions(refs.input.value);
        openList();
      }
      if (filteredOptions.length > 0) {
        activeIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
        renderOptions();
      }
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      if (!isOpen) {
        filterOptions(refs.input.value);
        openList();
      }
      if (filteredOptions.length > 0) {
        activeIndex = Math.max(activeIndex - 1, 0);
        renderOptions();
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0 && filteredOptions[activeIndex]) {
      commitSelection(filteredOptions[activeIndex]);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      closeList();
      event.preventDefault();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (refs.input.contains(target) || refs.optionsList.contains(target)) return;
    closeList();
  });

  syncValue(refs.input.value);

  return {
    setValue(value: string) {
      syncValue(value);
    },
  };
}

export { CURATED_LOCAL_FONT_FAMILIES as DEFAULT_FONT_FAMILY_OPTIONS };
