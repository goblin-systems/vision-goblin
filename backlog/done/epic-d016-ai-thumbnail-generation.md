# AI Thumbnail Generation

- Canonical IDs: `D16` (legacy: `P6`)
- Status: shipped
- Summary or outcome: generate an AI thumbnail from the current document. User triggers "AI: Generate Thumbnail", picks a target size (128×128, 256×256, 512×512, or YouTube 1280×720), and the AI generates a thumbnail-optimized version using the generation task family with the current composite as a reference image. The result is added as a new document or new layer.

## Scope

- Add `generateThumbnail()` method to the AI editing controller.
- Prompt modal with size selector (presets) and optional description prompt.
- Build generation task with document composite as reference, user prompt, and target dimensions.
- Add result as a new layer or new document.
- Add sidebar button, nav menu item, and command palette entry.
- Add test coverage for the thumbnail generation task builder.

## Acceptance Criteria

- User can trigger "AI: Generate Thumbnail" from menu, command palette, or sidebar button.
- Size selection with presets is available.
- Optional custom prompt for style or content direction.
- Result added as new layer with provenance.
- Command palette and nav menu entries exist.
- Test exists for the thumbnail generation task builder.

## Related

- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Generation baseline: `backlog/done/epic-d008-ai-repair-and-generation.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
