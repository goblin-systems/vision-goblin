# Text Capabilities Overhaul

- Canonical IDs: `F4.6`
- Status: follow-up — Phase 1 shipped, gradient unification refactor shipped, Phase 2 shipped, Phase 3 deferred
- Summary or outcome: upgrade the text layer system so it can express gradient fills, glyph-level strokes, and richer styling — making both manual text work and AI raster→text conversion meaningfully more faithful.

## Motivation

The AI Replace Raster Text feature (`F4.2`) can OCR raster text, inpaint the original, and create editable text layers. But the current text layer system is too basic — only solid fill, single font/size per block, bold/italic, alignment, kerning/line-height, and post-rasterization layer effects. When raster text has gradient fills, outlines, or decorative shadows, the replacement layer looks nothing like the original. Richer text properties also improve manual text creation for titles, captions, watermarks, and social graphics.

## Phase 1 — Core Visual Expressiveness (current)

### 1A. Gradient Fill for Text
- Extend `TextLayerData.fillColor` from `string` to a `TextFill` union type: solid color, linear gradient, or radial gradient.
- Backward-compatible deserialization: old `string` fillColor wraps to `{ type: "solid", color }`.
- Render via `CanvasGradient` as `fillStyle` when drawing text glyphs, scoped to the full text block.
- Inspector: fill type selector (solid / linear gradient / radial gradient) with "Edit gradient..." button opening the shared gradient editor modal.
- **Done**: Phase 1 shipped initial inline gradient editor; gradient unification refactor (Phases 1-5) merged both raster and text gradient editing into a single shared modal with curve remapping, radial support, and linear/radial type switching.

### 1B. Text Glyph Stroke
- Add `TextLayerData.stroke: { color: string, width: number } | null`.
- Render via `ctx.strokeText()` behind fill.
- Inspector: stroke color and width fields.

### 1C. AI Replacement — Gradient and Stroke Detection
- Extend `inferReplacementTextStyleHints` to detect gradient direction and approximate stops from pixel analysis.
- Detect outline from consistent edge color differing from interior.
- Set `TextFill` gradient or stroke on the replacement layer when detected.

### Phase 1 Acceptance Criteria
- User can set a linear or radial gradient fill on text and see it rendered on canvas.
- User can add a stroke to text glyphs with configurable color and width.
- Gradient fill and stroke survive save, reopen, and undo/redo.
- Old documents with string fillColor load and display correctly.
- AI text replacement on gradient-filled raster text produces a text layer with approximate gradient fill.
- AI text replacement on outlined raster text produces a text layer with approximate stroke.

## Phase 2 — 80% Use Case Coverage (complete)

### 2A. Text Decoration
- `TextLayerData.underline` and `TextLayerData.strikethrough` booleans, rendered in `renderTextLayer`, inspector checkboxes, backward-compat defaults.
- **Done**: 8 new tests.

### 2B. Blend Modes Per Layer
- `LayerBase.blendMode` (optional `GlobalCompositeOperation`), applied in `compositeDocumentOnto` fast and slow paths, inspector dropdown with 16 blend modes, serialization/deserialization/cloneLayer.
- **Done**: 6 new tests.

### 2C. Custom Font Loading from Disk
- `src/app/customFontRegistry.ts` module, `DocumentState.customFonts` for portable serialization as base64 data URLs, FontFace API registration, inspector "Load font…" button and font picker refresh.
- **Done**: 16 new tests.

### 2D. AI Layer Effects Detection
- `detectDropShadowFromTextPixels` and `detectOutlineEffectFromTextPixels` in `layers.ts`, `effects: LayerEffect[]` on `ReplacementTextStyleHints`, auto-application in `replaceRasterTextWithEditableLayer`.
- **Done**: 6 new tests.

### 2E. Text Transform Persistence For AI Fidelity
- Persist `TextLayerData.skewXDeg` and `TextLayerData.skewYDeg` through render, transform commit, save, reopen, and AI-driven reconstruction apply.
- **Done**: structured AI reconstruction path can now apply rotation, scale, and skew coherently to editable text layers.

## Phase 3 — Advanced / Creative (deferred)

- Per-character/per-run rich text styling.
- Text warping (arc, wave).
- Text on path, pattern fill, text as clipping mask.

## Non-Goals

- Full word processor / DTP layout.
- RTL / bidirectional text.
- Vertical text layout.
- Exact font identification from AI.
- SVG text import/export.
- Live text effects (emboss, bevel, 3D extrusion).
- Text animation.

## Related

- AI text cleanup dependency: `backlog/epic-f420-ai-text-cleanup-and-ocr-replace.md`
- Core editing polish: `backlog/epic-p002-core-editing-polish.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Follow-up index: `backlog/index-follow-up.md`
