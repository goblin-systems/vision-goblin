# AI Navigation Menu and Modal Replacements

- Canonical IDs: `D11`, `P5`
- Status: done
- Summary or outcome: promoted AI tools from the buried Tools tab to a top-level "AI" nav menu, replaced all 9 native `window.prompt()`/`window.confirm()` calls with Goblin Design System modals, and registered all 13 AI actions in the command palette with "AI: " prefix labels and a dedicated `"ai"` category.

## What shipped

- P5.1: Added "AI" nav-item to the top-level nav bar in `index.html` (between "Tools" and "View") with all 13 commands grouped logically (Selection, Editing, Enhancement, Platform).
- P5.2: Removed the "AI Edit Studio" section from the Tools tab.
- P5.3: Created `src/app/ai/aiPromptModal.ts` with 4 reusable modal helpers: `aiPromptText()`, `aiPromptSelect()`, `aiPromptConfirm()`, `aiPromptOutpaint()`. Each returns a Promise. Includes XSS escaping and automatic DOM cleanup.
- P5.4–P5.6: Replaced all 9 `window.prompt()`/`window.confirm()` calls in `src/app/ai/editingController.ts` with the new modal helpers.
- P5.7: Updated all 13 AI commands to use `category: "ai"` and "AI: " prefix labels. Added `"ai"` to the `CommandDefinition` category union and the command palette category labels.

## Key files

- `src/app/ai/aiPromptModal.ts` — new modal helper module (242 lines)
- `src/app/ai/aiPromptModal.test.ts` — 14 tests covering all helpers
- `src/app/ai/editingController.ts` — 9 native prompt/confirm calls replaced
- `src/editor/commands.ts` — `"ai"` added to category union
- `src/editor/commandPalette.ts` — `"AI"` added to category labels
- `src/app/registerEditorCommands.ts` — 13 commands updated (labels + category)
- `src/app/registerEditorCommands.test.ts` — 2 new tests for AI category/label conventions
- `src/editor/commandPalette.test.ts` — AI category label test added
- `index.html` — AI nav dropdown added, AI Edit Studio section removed

## Validation

- 44 test files, 384 tests, all passing
- `npm run build` succeeds
- Zero `window.prompt` or `window.confirm` in AI code
- All acceptance criteria from the original epic met

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
