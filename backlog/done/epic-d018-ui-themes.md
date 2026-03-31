# Epic D018 — UI Themes

**Status:** Shipped  
**Priority:** Quality of life

## Goal

Allow users to switch between three UI colour themes from the View top-level menu. No changes to icons, corner radius, spacing, or any structural elements — colour tokens only.

## Themes Delivered

| Theme | Inspiration | Description |
|---|---|---|
| **Goblin** | Original | Indigo/blue dark — the existing default |
| **Dark** | VSCode Dark+ | Neutral dark greys (#1e1e1e base), no blue tint, blue accent |
| **Light** | VSCode Light+ | White/light-grey surfaces, dark text, blue accent |

## Implementation

- `src/app/theme.ts` — new module: `UiTheme` type, `applyTheme()`, `isUiTheme()`, `THEME_LABELS`
- `src/settings.ts` — `uiTheme: UiTheme` field added; persisted via Tauri plugin-store
- `src/styles.css` — fully tokenised theme architecture: `:root` extended with 13 app-specific tokens (`--canvas-stage-bg`, `--floating-chip-*`, `--overlay-toolbar-bg`, `--checker-color`, `--scrollbar-thumb-color`, `--scrollbar-track-color`, DS-override tokens); base rules (`.canvas-stage`, `.canvas-floating-chip`, `.capture-overlay-toolbar`, `.canvas-backdrop` checkerboard, `.layer-thumb`) reference tokens instead of hardcoded colours; theme element overrides collapsed from duplicated `[data-theme="dark"] .foo, [data-theme="light"] .foo` pairs into single `[data-theme] .foo` rules — adding a new theme requires only one `[data-theme="foo"] { }` block
- `index.html` — View > Theme submenu (Goblin / Dark / Light) with divider
- `src/app/workspaceShellController.ts` — `syncThemeMenuIcons()` keeps `circle-dot`/`circle` icons in sync with active theme; `setTheme` dep added
- `src/app/registerEditorCommands.ts` — `set-theme-goblin`, `set-theme-dark`, `set-theme-light` commands with category `"view"`
- `src/editor/commands.ts` — `"view"` added to command category union
- `src/main.ts` — `applyTheme()` called on boot; `setTheme()` wired through deps

## Mechanism

Theme is applied by setting `data-theme="goblin|dark|light"` on `<html>`. CSS overrides on `[data-theme]` supersede the design system's `:root` defaults. No JS reads back computed styles.

## Follow-ups (Minor)

- `.marquee-sides-label` has an inline style `color:rgba(255,255,255,0.7)` that doesn't respond to theme — could be moved to a CSS class using `var(--text-muted)`
- The Goblin theme does not define `--bg-hover` in `styles.css`; it relies on the design system package default. Worth verifying the command palette hover state visually on Goblin theme.
