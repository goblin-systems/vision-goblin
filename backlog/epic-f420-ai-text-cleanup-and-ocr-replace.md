# AI Text Cleanup + OCR Replace

- Canonical IDs: `F4.2`
- Status: follow-up
- Summary or outcome: let users clean up baked-in text from screenshots, scans, and flattened graphics, then replace it with editable text layers without rebuilding the layout by hand.

## Scope

- Detect text blocks in a selected area or whole image, extract OCR text, and let the user review or edit the recognized copy before apply.
- Remove the original rasterized text treatment from the chosen text block so replacement text does not sit on top of visible remnants.
- Recreate the replacement as normal editable text layers with best-effort preservation of block position, line breaks, alignment, approximate sizing, curated local font-family choice, and bounded spacing when confidence is sufficient.
- Support multi-piece selections within one cleanup pass by segmenting distinct removed-text islands, OCRing each piece separately, reviewing them together, and creating one editable text layer per detected piece with per-piece style inference.
- Support a structured AI reconstruction path that returns schema-compliant JSON blocks for grouped editable text replacement, with validation, normalization, review, and fail-closed apply behavior.
- Support practical cleanup-and-replace cases for horizontal text in screenshots, UI captures, posters, memes, and scanned print layouts.
- Keep MVP intentionally narrow: do not promise handwriting, curved text, complex table reconstruction, or exact font matching for highly stylized typography.

## Current shipped baseline

- Selected raster text can now be cleaned in one pass and replaced as either a single editable text layer or multiple editable text layers when the selected region contains distinct text pieces.
- Each detected piece is OCRed independently with the existing single-block captioning prompt and can be reviewed or edited before apply.
- Replacement styling is inferred per piece from local removed-text bounds so distinct colours and layout hints are not averaged into one combined layer.
- Primary reconstruction now uses a dedicated structured AI contract and strict JSON schema validation so grouping, text blocks, styles, effects, and transforms come from the model response rather than heuristic segmentation.
- Invalid structured responses now fail closed without mutating the document, and supported transforms include rotation, scale, and persisted skew for text layers.
- The feature can be invoked against a selected region or the full document; when no mask is painted the entire active raster layer is used as the target region.
- The mask session, guide hints, and review modals clearly communicate unsupported cases including handwriting, curved baselines, and highly decorative display fonts.
- The structured reconstruction schema supports optional per-block confidence and notes fields, surfaced in the review modal so users see AI self-assessment before committing.
- The text reconstruction prompt includes additional rules for punctuation fidelity, dense layout separation, tight bounding boxes, and empty-text handling.
- The text reconstruction prompt now uses a proper JSON Schema-style definition (v2) instead of a sample JSON object, with explicit type discriminators for fill (solid, linear-gradient, radial-gradient), effects, stroke, and transform fields. The parser accepts both v1 and v2 schema versions and tolerates `position` as an alias for `offset` in gradient stops.
- The text replacement feature uses a two-stage AI flow: Stage 1 sends image + mask to the `inpainting` family for text removal and background reconstruction; Stage 2 sends the original image + mask to the `text-replacement` family (text-only response) for structured JSON text reconstruction. This separation is more reliable than a single combined request because Gemini models consistently return the expected modality when each request asks for only one output type. Each stage creates one visible job in the queue; users can retry either stage independently via the standard retry button.
- The dead `text-reconstruction` task family has been fully removed — types, provider handlers, model hints, config routing, task builders, and the old flow function are all deleted. Only the unified `text-replacement` family remains. The `AiJsonArtifact` role `"text-reconstruction"` is retained as a data discriminator for structured text JSON artifacts.
- Model discovery now classifies Gemini `generateContent` models as capable of `text-replacement`, so the full list of discovered models appears in the settings model dropdown for this task family.
- The default model preference for text-replacement is now empty rather than hard-coded, so the settings dropdown correctly shows "Auto (default)" on fresh installs and the provider's internal fallback selects the model when no explicit preference is set.
- The user's text-replacement model/provider routing is now honoured for both stages of the two-stage flow. Previously Stage 1 (inpainting) always used inpainting routing rather than the text-replacement settings. The runtime now supports request-level `plannedProviderId`/`plannedModel` overrides, and `replaceRasterText` injects the user's text-replacement routing into both stages.
- The input scope setting from the mask session is now respected. Previously `replaceRasterText` was hardcoded to `"visible-content"` regardless of the session choice.
- When the input scope is "selected-layers", the text replacement flow now sends just the active layer's pixel content at its natural dimensions instead of a full document-sized canvas with the layer composited at its offset. The mask is translated from document-space to layer-space, selection bounds are computed in layer-space, the cleaned image is used at layer dimensions without extraction, and text block coordinates are offset by the layer position to convert back to document-space. This prevents the AI from seeing a huge image with content in a small region surrounded by empty space.

## Remaining follow-up scope

- Expand beyond current block-level reconstruction into richer paragraph semantics and richer typography inference as the text capabilities overhaul matures.
- Consider provider-specific prompt variants if reliability issues recur in production.
- Per-block confidence is now available in the schema; future work could show per-piece indicators inline in the multi-block review UI rather than only in the header message.
- Evaluate runtime tuning of the text reconstruction prompt if quality issues surface — coordinate system precision, bounding-box fidelity, and style inference accuracy may benefit from prompt iteration.
- Not all `generateContent` models can produce images (e.g., `gemini-1.5-pro`). Currently all such models are shown as `text-replacement` capable. A future refinement could filter by image generation capability or surface a warning when a non-image model is selected for this family.

## Acceptance Criteria

- A user can invoke the feature against a selected region or the full document and review the recognized text before committing.
- Applying the feature removes the original baked-in text for the targeted block well enough that replacement text does not show obvious duplicate artifacts at normal zoom.
- Replacement content lands as editable Vision Goblin text layers rather than a flattened bitmap-only result.
- The feature preserves approximate text layout closely enough that common screenshot or flyer corrections require minimal manual repositioning.
- The product clearly communicates unsupported cases such as handwriting, curved baselines, or highly decorative display fonts.

## Related

- Text capabilities overhaul: `backlog/epic-f460-text-capabilities-overhaul.md` — richer text fills and strokes improve AI replacement fidelity
- Foundation dependency: `backlog/done/epic-d006-ai-provider-foundations.md`
- Editing baseline: `backlog/done/epic-d002-editing-and-layers.md`
- Repair and generation baseline: `backlog/done/epic-d008-ai-repair-and-generation.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Future index: `backlog/index-future.md`
