# AI Enhancement And Style

- Canonical IDs: `F3.5`, `F3.6`, `F3.7`, `F3.13`
- Status: done
- Summary or outcome: shipped previewable AI enhancement, upscale, denoise, and style transfer flows that preserve the normal apply, cancel, undo, and provenance model.

## Delivered Scope

- `F3.5` Auto enhance with optional intensity.
- `F3.6` Upscale with provenance and cost or time warnings.
- `F3.7` Denoise with before and after clarity.
- `F3.13` Style transfer using prompt-driven or reference-based inputs.

## Follow-up polish shipped

- Clarified enhancement prompt structure so workflow and output constraints live in system/tool instruction text while user-entered style direction stays in the user request section.
- Strengthened style-transfer prompt wording to explicitly transfer reference visual style onto the source image while preserving the source subject, content, composition, and framing.
- Improved style-transfer modal copy so users are clearly asked for style direction and optional reference images as style guidance.

## Acceptance Criteria

- Enhancement features are easy to preview, commit, and undo without confusing output handling.

## Related

- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
