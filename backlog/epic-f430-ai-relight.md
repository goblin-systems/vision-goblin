# AI Relight

- Canonical IDs: `F4.3`
- Status: future
- Summary or outcome: let users change the perceived lighting on a photo or subject so an image can look brighter, moodier, or directionally relit without rebuilding the scene manually.

## Scope

- Offer a relight flow for portraits, products, and simple scenes where the user wants a clearer lighting pass rather than a full generative rewrite.
- Support a small set of decision-ready controls such as relight intent or direction, strength, and preserve-original-color bias.
- Generate a preview-before-commit result that fits the normal apply, cancel, undo, and provenance model.
- Preserve subject identity, composition, and major geometry while changing light balance, highlight placement, and shadow feel.
- Keep MVP bounded away from background replacement, object insertion, or cinematic scene reconstruction.

## Acceptance Criteria

- A user can trigger relight, adjust at least one lighting-oriented control, and preview the result before applying it.
- The output changes lighting in a visible way without reading as a broad style-transfer or scene-rewrite feature.
- Applying the result creates a normal undoable edit with provenance.
- Common portrait and product cases preserve subject structure and remain credible at normal viewing size.
- The UI makes it clear when an image is a weak fit, such as busy multi-light scenes or severe backlighting that the model cannot reliably reconstruct.

## Related

- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Enhancement baseline: `backlog/done/epic-d009-ai-enhancement-and-style.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Future index: `backlog/index-future.md`
