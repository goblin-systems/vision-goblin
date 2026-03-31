# AI Photo Repair & Restoration

- Canonical IDs: `D15` (legacy: `P5`)
- Status: shipped
- Summary or outcome: one-click AI-powered photo repair and restoration flow. User opens a damaged or old photo, triggers "AI: Restore Photo", and Vision Goblin sends the image to the enhancement provider with the "restore" operation. The AI returns a cleaned-up image that replaces the layer or lands as a new layer. Includes options for restore intensity and a preview-before-commit UX like the existing auto-enhance and denoise modals.

## Scope

- Add `restorePhoto()` method to the AI editing controller.
- Open a preview modal with intensity slider, reusing the existing pattern from auto-enhance and denoise.
- Build enhancement task with operation "restore".
- Add sidebar button, nav menu item, and command palette entry.
- Add test coverage for the restore task builder.

## Acceptance Criteria

- User can trigger "AI: Restore Photo" from menu, command palette, or sidebar button.
- Shows a preview modal with intensity control.
- Preview generates and displays before committing.
- Applying creates an undo entry and provenance record.
- Enhancement task uses operation "restore".
- Test exists for the restore task builder.

## Related

- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Enhancement baseline: `backlog/done/epic-d009-ai-enhancement-and-style.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
