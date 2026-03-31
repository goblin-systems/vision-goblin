# Freeform AI

- Canonical IDs: `D17` (legacy: `P7`)
- Status: shipped
- Summary or outcome: a freeform AI input where the user types any instruction. Vision Goblin sends the user's prompt along with the current document composite to the AI generation family and applies the resulting image. This is the most open-ended AI feature — the user types whatever they want ("make it look vintage", "add a sunset", "turn it into a cartoon") and the AI interprets it.

## Scope

- Add `freeformAi()` method to the AI editing controller.
- Text prompt modal, reusing the existing `aiPromptText` pattern.
- Build generation task with user prompt, document dimensions, and composite as reference.
- Add result as a new layer with provenance.
- Add sidebar button, nav menu item, and command palette entry.
- Add test coverage for the freeform task builder.

## Acceptance Criteria

- User can trigger "AI: Freeform" from menu, command palette, or sidebar button.
- Free text input accepts any instruction.
- Current document composite is sent as reference.
- Result added as new layer with provenance.
- Command palette and nav menu entries exist.
- Test exists for the freeform task builder.

## Related

- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Generation baseline: `backlog/done/epic-d008-ai-repair-and-generation.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
