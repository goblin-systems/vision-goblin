export type UiTheme = "goblin" | "dark" | "light";

export const THEME_LABELS: Record<UiTheme, string> = {
  goblin: "Goblin",
  dark: "Dark",
  light: "Light",
};

export function applyTheme(theme: UiTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "goblin" || value === "dark" || value === "light";
}
