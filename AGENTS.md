# AGENTS.md

## Project Overview

Vision Goblin is a desktop image editor built with Tauri.

- Frontend: plain TypeScript + Vite, no React/Vue/Svelte
- Desktop shell: Tauri v2
- Native side: Rust
- UI system: `@goblin-systems/goblin-design-system`
- Tests: Vitest + jsdom

Primary entry points:

- Frontend bootstrap: `src/main.ts`
- HTML shell: `index.html`
- Tauri bootstrap: `src-tauri/src/main.rs`
- Tauri app wiring: `src-tauri/src/lib.rs`

## Application Architecture

The app is intentionally split into layers. Keep it that way.

### Frontend layers

- `src/main.ts`
  - Main orchestration layer
  - Owns global app/session state
  - Wires DOM events, commands, rendering, document switching, tool state, and capture flows
- `src/app/*`
  - DOM helpers, app bindings, and file IO through Tauri plugins
- `src/editor/*`
  - Core editor domain logic
  - Document model, rendering, tools, selection, transforms, adjustments, autosave, and command registry
- `src/styles.css`
  - App-specific styling on top of Goblin design system

### Native / Tauri layers

- `src-tauri/src/capture.rs`
  - Screen and window capture commands
- `src-tauri/src/debug_log.rs`
  - Debug logging integration
- `src-tauri/src/lib.rs`
  - Tauri plugin registration and command exposure

## Architecture Rules For Agents

- Do not dump new feature logic into `src/main.ts` unless it is truly orchestration glue
- Do not create spaghetti code by mixing DOM wiring, business logic, rendering logic, and persistence logic in one place
- Prefer adding focused modules under `src/editor/*` or `src/app/*` for new behavior
- Keep modules small, named by feature or responsibility, and easy to test
- Prefer pure functions for editor behavior where possible
- Keep state mutations close to the document/editor model instead of scattering them across UI handlers
- When adding actions reachable from menu, shortcut, or command palette, route them through `src/editor/commands.ts`
- If a feature grows beyond a few helper functions, extract it into its own module instead of extending `src/main.ts`

## Working Conventions

- `src/main.ts` is the central controller, but reusable logic should usually live elsewhere
- Document model types live in `src/editor/types.ts`
- Serialization, cloning, compositing, and import/export behavior live in `src/editor/documents.ts`
- Canvas rendering is in `src/editor/render.ts`
- Pointer interactions are in `src/editor/canvasPointer.ts`
- Settings persistence lives in `src/settings.ts`
- App-level file operations live in `src/app/io.ts`

## Backlog Source Of Truth

`plan.md` is the project backlog. Treat it as the authoritative roadmap.

### Backlog management rules

- If a feature is fully shipped at MVP level, move it into `Completed So Far`
- If a feature is only partially done, keep it in its roadmap section and add or update a `Status:` note
- When work changes scope, update the relevant section in `plan.md` in the same task whenever possible
- Do not leave shipped features listed as active roadmap items unless the remaining work is explicitly called out as follow-up or polish
- Preserve the distinction between shipped baseline, partial MVP, future polish, and net-new features
- If a feature is delivered, update any stale phase summary text too

### Practical rule for sessions

Before starting substantial work:

1. Read the relevant section in `plan.md`
2. Check whether the feature is marked shipped, partial, or active
3. After implementation, update `plan.md` so the backlog reflects reality

## Testing And Validation

Use the existing scripts from `package.json`:

- `bun run test` or `npm test`
- `bun run build` or `npm run build`
- `bun run tauri dev` or `npm run dev`

Testing expectations:

- Add or update tests for non-trivial feature work
- Prefer colocated tests in `src/**/*.test.ts`
- Cover document mutations, selection behavior, transforms, adjustments, serialization, and command behavior when relevant
- Avoid shipping significant editor logic without test coverage unless the code is purely UI glue

Relevant files:

- Vitest config: `vitest.config.ts`
- Test setup and canvas mocks: `src/test/setup.ts`

## Generated And Sensitive Areas

- Do not hand-edit generated schema files under `src-tauri/gen/schemas/*` unless regeneration is part of the task
- Be careful with Tauri capability and config changes in `src-tauri/capabilities/default.json` and `src-tauri/tauri.conf.json`
- Preserve existing user work in a dirty worktree; inspect before editing and do not overwrite unrelated in-progress changes

## Session Checklist For Agents

At the start of a coding session:

1. Read `plan.md`
2. Inspect current git status
3. Identify the touched area:
   - `src/main.ts` orchestration
   - `src/app/*` app bindings and IO
   - `src/editor/*` core editor logic
   - `src-tauri/*` native functionality
4. Follow existing patterns before introducing new abstractions
5. Keep feature code organized in separate modules
6. Add tests for meaningful logic changes
7. After feature completion, update `plan.md` backlog status

## Repo-Specific Guidance

- This project does not use a frontend framework; prefer small reusable functions over framework-style patterns
- `README.md` is currently minimal; use `plan.md` and the codebase as the main operational references
- Respect Goblin design system patterns already present in the UI
- Keep new code readable, modular, and easy to evolve
