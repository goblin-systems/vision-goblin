import { applyIcons } from "@goblin-systems/goblin-design-system";

export interface GoblinToastDescriptor {
  message: string;
  icon: string;
  subtle?: boolean;
  durationMs?: number;
}

export interface GoblinToastPresenter {
  showToast: (toast: GoblinToastDescriptor) => void;
  destroy: () => void;
}

export function createGoblinToastPresenter(root: HTMLElement): GoblinToastPresenter {
  let hideTimer: number | null = null;

  function clearHideTimer() {
    if (hideTimer === null) {
      return;
    }

    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function hideToast() {
    root.classList.remove("is-visible");
  }

  return {
    showToast: ({ message, icon, subtle = false, durationMs = subtle ? 2_600 : 3_200 }) => {
      clearHideTimer();

      const card = document.createElement("div");
      card.className = `goblin-toast-card${subtle ? " goblin-toast-card--subtle" : ""}`;

      const iconWrap = document.createElement("span");
      iconWrap.className = "goblin-toast-icon";
      const iconPlaceholder = document.createElement("i");
      iconPlaceholder.setAttribute("data-lucide", icon);
      iconWrap.appendChild(iconPlaceholder);

      const messageWrap = document.createElement("span");
      messageWrap.className = "goblin-toast-message";
      messageWrap.textContent = message;

      card.append(iconWrap, messageWrap);
      root.replaceChildren(card);
      applyIcons();
      root.classList.add("is-visible");

      hideTimer = window.setTimeout(() => {
        hideToast();
        hideTimer = null;
      }, durationMs);
    },
    destroy: () => {
      clearHideTimer();
      hideToast();
      root.replaceChildren();
    },
  };
}
