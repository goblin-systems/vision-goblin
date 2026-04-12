# Unified AI Mask Session

- Canonical IDs: `D28`
- Status: shipped
- Summary or outcome: two separate AI mask workflows were unified into a single `aiMaskSession` system with session-aware selection routing, configurable tool pickers, and self-contained single-channel sessions for inpaint, remove-object, and replace-text tools.

## Shipped scope

- Renamed `shadowGuideSession` module and all related types, CSS classes, DOM ids, and internal identifiers from `shadowGuide*`/`shadowSession*` to `aiMask*` across the entire codebase.
- Added session-aware selection routing so marquee, lasso, polygon lasso, and magic wand tools write results to the active session channel canvas instead of `doc.selectionMask` when an AI mask session is active, supporting all selection modes.
- Sessions can be configured with `allowedTools`; when more than two tools are allowed a tool picker row and selection mode buttons render in the panel, kept in sync via `syncToolState()`.
- Three AI tools (`inpaintSelection`, `removeObject`, `replaceRasterText`) now open their own single-channel AI mask sessions with new `AiGuideMode` values (`"inpaint"`, `"remove-object"`, `"replace-text"`).
- Added 13 tests covering session-target redirection in `selectionController` and tool picker / selection mode UI behavior in `aiMaskSession`.

## Acceptance Criteria

- All `shadowGuide*` identifiers are fully replaced by `aiMask*` equivalents with no regressions.
- Selection tools route to the session channel canvas during an active AI mask session and revert to normal behavior otherwise.
- Tool picker and selection mode UI appear only when sessions are configured with the relevant tools.
- Single-channel sessions let users paint or select a mask area inline before the AI operation proceeds.
- All new behavior is covered by tests.

## Related

- Shared guide-session baseline: `backlog/done/epic-d022-ai-add-shadow.md`
- Done index: `backlog/index-done.md`
