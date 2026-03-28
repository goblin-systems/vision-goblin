# Vision Goblin - Detailed Product Backlog

## Purpose

This document expands `plan.md` into a much more actionable backlog. Each feature is described in terms of user-visible behavior, implementation intent, dependencies, and a concrete definition of done so it can be planned and executed independently.

The goal is not to prescribe exact code structure. The goal is to define a large, development-ready backlog for a serious image editor that starts as a strong non-AI product and later adds optional AI tooling and workflow automation.

## Planning Rules

- Every feature should be independently executable and shippable behind a feature flag if needed.
- AI is an optional acceleration layer, not a prerequisite for core editing.
- Non-destructive editing is preferred whenever a feature can reasonably support it.
- Cross-platform behavior should be considered from the start for editor, clipboard, file import/export, hotkeys, and global utilities.
- Performance work is part of feature delivery, not a separate cleanup phase.
- A feature is not done until it has UI behavior, state persistence expectations, error handling, and acceptance criteria.

## Delivery Structure

- Completed foundation: shell, document model, rendering baseline, tabs, file/project IO baseline, raster layers, history, crop/brush/eraser/move, and Goblin-based desktop UI.
- Current phase: raise performance headroom for larger files, polish re-editing workflows, prepare the AI integration layer, and keep modularizing the app controller so `src/main.ts` shrinks toward a bootstrap-only role.
- Modularization progress so far: capture workflow, destructive raster adjustment modal orchestration, selection-tools modal/session orchestration (color range, refine edge, quick mask), distort modal/session orchestration (warp, liquify), right-rail inspector orchestration, document/file lifecycle with autosave/recovery orchestration, workspace shell/chrome presentation, canvas workspace rendering/snapping/guide bindings, global editor interaction bindings, and layer/history panel orchestration now live in dedicated app-layer controllers instead of `src/main.ts`.
- Next phase after that: polish re-editing workflows and remaining desktop differentiators.
- Later phases: optional AI tools, workflow automation, and extensibility.

---

## Completed So Far

These items are no longer in the active backlog because the current app already delivers them at MVP level.

- Application shell and persistent workspace layout
- Document state model baseline
- Rendering pipeline baseline with zoom, pan, checkerboard, and overlays
- Multi-tab documents with dirty indicators and close prompts
- File open, project save/save as, drag-drop, clipboard image paste, and export baseline
- New blank canvas flow
- Raster layer baseline: add, delete, duplicate, reorder, rename, lock, visibility
- History baseline with undo/redo and visible history panel
- Move tool baseline
- Crop baseline
- Brush baseline
- Eraser baseline
- Smooth zoom and pan baseline
- Goblin design system migration and desktop menu structure
- Selection engine baseline: rect storage, add/subtract/intersect modes, marching ants, invert/deselect/select all, paint clipping, undo/redo preservation
- Transform tool baseline: free transform bounding box, scale with aspect ratio, rotate, skew, commit/cancel flow, live preview
- Transform enhancements: configurable pivot point with drag repositioning, constrained rotation (Shift for 15-degree snapping), visual pivot indicator
- Rulers, guides, and snapping: canvas-rendered rulers, drag-to-create guides, snap layers to canvas edges/guides/grid, toggle snap behavior
- Grid system: configurable grid size, canvas-aligned grid rendering, snap-to-grid, grid size persistence
- New document creation flow: web/social/print/icon presets, background choice, create-from-clipboard option
- Image adjustments: brightness/contrast, hue/saturation, Gaussian blur with live preview and undo support
- Elliptical marquee selection: rect/ellipse shape toggle, elliptical marching ants, elliptical paint clipping, elliptical delete
- Pixel-level editing mode: nearest-neighbor rendering at high zoom (>=400%), pixel grid overlay at >=800% zoom, crisp pixel boundaries
- Sharpen filter: unsharp mask sharpening with amount/radius controls, live preview, undo support
- Color balance adjustment: shadow/midtone/highlight tonal range shifting across cyan-red, magenta-green, yellow-blue axes with live preview
- Motion blur filter: directional blur with angle and distance controls, live preview, undo support
- Noise tools: add noise (monochrome/color with amount control), reduce noise (edge-preserving selective averaging with strength control), both with live preview
- Levels adjustment: input black/gamma/white controls with histogram display, live preview, undo support
- Curves adjustment: interactive tone curve editor with click-to-add/drag-to-move/right-click-to-remove control points, monotone cubic interpolation, live preview
- Gradient maps: luminance-to-gradient color mapping with 6 built-in presets (B&W, Sepia, Cool/Warm Duotone, Sunset, Infrared), preset selector, live preview
- Smudge tool: pixel-pushing tool with circular brush, edge feathering, strength control (via brush opacity), selection clipping support, undo/redo
- Clone stamp tool: Alt-click to set sample source, aligned sampling with offset, circular brush with feathering, selection clipping, undo/redo
- LUT support: .cube file import, 3D LUT with trilinear interpolation, intensity slider, live preview, undo support
- Command, action, and shortcut system: central command registry, keyboard dispatch, shortcut conflict detection, menu routing through commands
- Autosave and crash recovery: periodic autosave to Tauri store, recovery prompt on launch, configurable interval
- Recent files: persistent recent file list via Tauri store, top-nav submenu, clear recent, graceful handling of missing files
- Lasso and polygonal lasso selection: freehand path capture, polygon vertex placement, double-click/Enter to close, Escape to cancel, marching ants rendering, selection clipping
- Magic wand selection: flood-fill contiguous mode, full-scan non-contiguous mode, tolerance slider, contour tracing to polygon path
- Healing brush: baseline defect repair with selection-aware blending, edge-preserving cleanup tuning, undo/redo support
- Text tool: editable text layers, point text and box text, toolbar-based formatting controls, save/reopen persistence, transform participation baseline
- Shape tools: editable rectangle/ellipse/line layers, click/drag creation, fill/stroke/radius controls, save/reopen persistence
- Basic effects: non-destructive drop shadow and outline for supported layers, canvas/export rendering
- Expanded transform/pivot workflow: right-drag pivot repositioning, left-drag transform move, improved selected-layer targeting
- Layer deletion preference: optional delete confirmation, disabled by default
- Adjustment layers: non-destructive brightness/contrast, hue/saturation, levels, curves, color balance, and gradient map as stackable, reorderable, toggleable layers with dedicated inspector controls and compositing pipeline integration
- Smart objects: embedded source assets with non-destructive transform accumulation, rasterize/replace source, paint guards, serialization round-trip
- Layer styles system: unified style framework with drop shadow, inner shadow, outer glow, outline, color overlay effects; multi-effect stacking, enable/disable per effect, copy/paste styles, effect normalization
- Edge refinement: feather/smooth/expand controls on selection masks with float32 pipeline, preview backgrounds, output to selection/mask/layer
- Select by color range: CIE Lab perceptual color distance, fuzziness with soft falloff, composite sampling, modal preview UI
- Quick mask mode: paint-to-select with red overlay, tool switching, mask-to-selection conversion on exit
- Alignment and distribution tools: multi-layer selection (Ctrl/Shift+click), align left/right/top/bottom/center, distribute H/V, align to canvas or selection
- Command palette foundation: Ctrl+K fuzzy-search palette over all registered commands, keyboard navigation (ArrowUp/Down/Enter/Escape), recent commands, shortcut display, category badges
- Distort and warp tools: interactive mesh-based warp with configurable grid density, perspective distort helper, bilinear-sampled triangle rasterization, commit/cancel with undo, live preview overlay
- Liquify lite: displacement-map brush with push/pull/smooth modes, configurable brush size and strength, bilinear sampling, dedicated modal session UI with live preview, commit with undo

---

## Active Roadmap

## PHASE 1A - Finish the Core Editor

Status: shipped. Command routing, autosave/recovery, recent files, lasso selection, and magic wand are already delivered and reflected in `Completed So Far`.

---

## PHASE 1B - Desktop Reliability and Differentiators

### F1.31 Global screen snipping (SHIPPED)

Status:
- Shipped.

What it does:
Captures screen regions, windows, or full displays into new editor documents.

Why it exists:
It is one of the most compelling native-desktop differentiators for the app.

Dependencies:
- F0.4, F1.2.

Execution scope:
- Keep the existing region, window, and full-screen capture entry points.
- Create a new document from captured pixels, add capture to the active document as a new layer, or copy to clipboard.
- Replace primary-monitor-only assumptions with correct monitor targeting / virtual desktop coverage.
- Preserve monitor scaling behavior correctly across single-monitor, multi-monitor, and mixed-DPI setups.
- Move shortcuts into the normal command/keybinding system and resolve conflicts centrally.
- Persist screen-capture preferences such as destination, delay, and hide-window behavior.
- Add explicit permission-denied and capture-failed UX.

Definition of done:
- Snips land in the editor quickly and predictably.
- Capture behaves correctly across common display setups.

Delivered baseline:
- Tool menu actions for region, window, and full-screen capture.
- Capture shortcuts routed through the shared command/keybinding settings model, with global shortcut registration derived from the same bindings.
- Overlay-based region selection with crop-to-selection flow.
- Countdown window and optional hide-window-before-capture flow.
- Delivery destinations: new canvas, add to active canvas as a layer, copy to clipboard.
- Persisted capture preferences for destination, delay, and hide-window behavior.
- Baseline capture error handling and recovery to restore the app window after failed capture attempts.
- Capture IPC optimised: Rust commands return raw binary via `tauri::ipc::Response` instead of JSON-serialised `Vec<u8>`, and PNG encoding uses fast compression (`CompressionType::Fast` / `FilterType::Sub`). JS side receives `ArrayBuffer` directly.
- Capture overlay now renders the screenshot at 1:1 pixel mapping, filling the entire screen. Toolbar floats on top with fixed positioning instead of consuming layout space. Feels like cutting the screen itself rather than viewing a scaled-down screenshot.

### F1.32 Global color picker (SHIPPED)

Status:
- Shipped.

What it does:
Lets the user sample any pixel on screen, not just inside the editor canvas.

Why it exists:
This is another strong native utility that complements editing workflows.

Dependencies:
- F0.4.

Execution scope:
- Keep the existing overlay-driven global pick mode with magnified preview and coordinate readout.
- Return picked color to the active paint swatch and picker UI.
- Share capture infrastructure with global screen snipping where possible.
- Support correct sampling on multi-monitor and mixed-DPI setups.
- Handle cancel/escape and permission failures cleanly.
- Decide whether to keep screenshot-based sampling as the shipped behavior or add live desktop sampling later as an upgrade.

Definition of done:
- User can sample off-canvas colors reliably.
- Picked color immediately becomes usable inside the editor.

Delivered baseline:
- Tool menu action and shared keybinding/global shortcut baseline for pick-from-screen.
- Overlay magnifier, color chip, and sampled color readout.
- Click-to-apply sampled color to the active swatch.

### F1.34 Large image handling baseline

What it does:
Improves responsiveness and memory behavior for larger assets.

Why it exists:
The editor is already usable, but it needs better headroom before more advanced tools land.

Dependencies:
- F0.3.

Execution scope:
- Measure representative file sizes and hotspot operations.
- Reduce unnecessary full-canvas work during pan/zoom and history changes.
- Add guardrails for memory-heavy operations.

Definition of done:
- Large test files remain interactive enough for normal work.
- Memory spikes are understood and mitigated where practical.

---

## PHASE 1C - Expanded Raster Editing

Status: mostly complete at MVP level. The baseline tools below are implemented; remaining work is refinement, polish, and deeper re-editing UX.

### F1.19 Healing brush

Status:
- Done at baseline level.
- Follow-up work should focus on stronger retouch quality, better sampling controls, and harder edge cases.

What it does:
Repairs local defects by blending sampled or inferred texture into surrounding tone and lighting.

Why it exists:
Users need a smarter retouching tool than raw cloning.

Dependencies:
- F1.18.

Execution scope:
- Baseline healing implementation for small defects.
- Local blending tuned for skin, dust, and surface cleanup.
- Respect active selection and layer targeting.

Definition of done:
- Common blemish and dust cleanup cases look plausibly blended.

### F1.28 Text tool

Status:
- Mostly done at MVP level.
- Editable text layers, point/box text, toolbar controls, persistence, and transform baseline are in place.
- Remaining work is direct on-canvas re-editing, stronger text-specific transform behavior, and richer typography controls.

What it does:
Creates editable text layers with font, size, line spacing, kerning, alignment, fill, and transform controls.

Why it exists:
Text is necessary for banners, product graphics, social posts, and annotation.

Dependencies:
- F1.14, F1.5.

Execution scope:
- Point text and box text.
- Basic formatting controls.
- Multi-line editing.
- Text layer selection and re-editing.

Definition of done:
- Text remains editable after save/reopen in native format.
- Common formatting changes are reflected immediately.

### F1.29 Shape tools

Status:
- Done at baseline level.
- Remaining work is polish: multi-shape selection, better on-canvas handles, and more geometric controls.

What it does:
Creates rectangles, ellipses, and lines as editable vector-like shape layers or rasterized shapes depending on chosen implementation.

Why it exists:
Shapes are basic layout and annotation tools.

Dependencies:
- F1.28.

Execution scope:
- Rectangle, ellipse, line.
- Fill and stroke controls.
- Radius control for rounded rectangles if feasible.
- Transform and duplicate behavior.

Definition of done:
- Shapes can be created, restyled, and moved predictably.

### F1.30 Basic effects - shadow and outline

Status:
- Done at baseline level.
- Remaining work is effect stacking, presets, and better per-layer style management.

What it does:
Adds simple layer-level visual effects for text and shapes.

Why it exists:
These effects cover many practical design needs without a full style engine.

Dependencies:
- F1.28, F1.29.

Execution scope:
- Drop shadow.
- Outer stroke or outline.
- Basic parameter UI.
- Non-destructive storage in document format.

Definition of done:
- Effects render consistently in-canvas and in exported files.

---

## PHASE 2 - Advanced Non-AI Editing

Status: all shipped. Adjustment layers, smart objects, layer styles, edge refinement, color range selection, quick mask, alignment/distribution, distort/warp, and liquify are all complete.

This phase is now historical reference for shipped non-AI editor work. Remaining non-AI work is mostly captured as Phase 1B reliability and Phase 1C polish rather than net-new foundational editing systems.

### F2.1 Adjustment layers (SHIPPED)

What it does:
Turns tonal and color adjustments into stackable, editable non-destructive layers.

Why it exists:
This is a major step toward professional workflow parity.

Dependencies:
- F1.21 through F1.27, F1.6, F1.7.

Execution scope:
- Convert supported adjustments into layer-based variants.
- Re-edit adjustment settings after creation.
- Allow masks on adjustment layers.
- Support clipping to lower layer if architecture allows.

Definition of done:
- Adjustment layers can be reordered and toggled without permanently changing source pixels.

Shipped scope:
- Brightness/contrast, hue/saturation, levels, curves, color balance, gradient map as adjustment layer types.
- Re-editable via inspector. Compositing pipeline applies adjustments non-destructively.
- Layer masks on adjustment layers: add/delete/invert/reset mask, paint reveal/hide with brush/eraser, per-pixel blending in compositing pipeline, serialization round-trip, mask badge in layer list.
- Clipping to lower layer deferred to future iteration.

### F2.2 Smart objects - lightweight embedded assets

**SHIPPED.**

What it does:
Allows layers to reference embedded or linked source content that can be transformed without immediately rasterizing destructive loss.

Why it exists:
This enables reusable assets and safer repeated transforms.

Dependencies:
- F1.14, F1.5.

Execution scope:
- Convert layer to embedded smart object equivalent.
- Edit source content in isolated workflow.
- Update instances when source changes.
- Handle unsupported operations with explicit rasterize prompts.

Delivered:
- SmartObjectLayer type with sourceDataUrl, sourceWidth/Height, scaleX/Y, rotateDeg, runtime sourceCanvas.
- Core module (smartObject.ts): create, render (matrix-based from source), convert raster->smart, rasterize smart->raster, replace source.
- Non-destructive transform commit: scale and rotation accumulate into smartObjectData without degrading source pixels.
- Paint guards: brush, eraser, smudge, clone-stamp, healing-brush all blocked on smart objects with toast suggesting rasterize.
- Inspector panel: source dimensions display, live scale/rotation editing, rasterize and replace source buttons.
- Nav commands: Convert to Smart Object (enabled on raster layers), Rasterize Smart Object (enabled on smart object layers).
- Layer list badge: "smart" with beta styling.
- Full serialization/deserialization round-trip including source image data URL.
- Clone support with independent sourceCanvas.
- refreshLayerCanvas dispatches to renderSmartObjectLayer.
- 18 tests covering create, render, convert, rasterize, replace, clone, refresh, serialize.

Definition of done:
- Repeated transforms do not degrade source content unnecessarily.

### F2.3 Layer styles system

What it does:
Adds reusable, editable style stacks for layers beyond basic shadow and outline.

Why it exists:
Common design workflows depend on repeatable styling.

Dependencies:
- F1.30.

Execution scope:
- Refactor basic effects into unified layer style framework.
- Add multiple effects per layer.
- Save and reuse style presets.

Definition of done:
- Layer styles remain editable and export correctly.

### F2.4 Edge refinement (SHIPPED)

What it does:
Improves existing selections with feathering, smoothing, contrast, and edge cleanup controls.

Why it exists:
Selection quality separates hobby tools from serious tools.

Dependencies:
- F1.9 through F1.12.

Execution scope:
- Refine selection dialog or panel.
- Edge preview on contrasting backgrounds.
- Output to selection, mask, or new layer with mask.

Definition of done:
- Hair, product, and soft-edge selection cases visibly improve with refinement controls.

Delivered:
- Extracted `edgeRefinement.ts` module with pure functions: `readMaskAlpha`, `morphExpand`, `boxBlurSmooth`, `gaussianFeather`, `alphaToMaskCanvas`, `refineMask`.
- Float32 alpha buffer pipeline: morphological expand/contract with circular structuring element, separable box blur smoothing, separable Gaussian blur feathering.
- Three output modes: selection, layer mask, new layer with mask.
- Preview backgrounds: marching ants, black, white, checkerboard.
- Modal UI with feather/smooth/expand sliders and live preview.
- 15 unit tests covering all pure functions and integration.

### F2.5 Select by color range (SHIPPED)

What it does:
Selects pixels across the image based on sampled color families rather than only local adjacency.

Why it exists:
Useful for sky, backdrop, and product isolation tasks.

Dependencies:
- F1.9.

Execution scope:
- Sample one or more colors.
- Fuzziness/tolerance control.
- Preview selection coverage.

Definition of done:
- User can isolate repeated colors across non-contiguous regions with acceptable accuracy.

Delivered:
- `colorRange.ts` module with CIE Lab color space conversion for perceptual accuracy.
- `rgbToLab`, `labDistance`, `buildColorRangeMask` (returns Uint8ClampedArray), `alphaToMaskImageData`, `samplePixel`.
- Soft falloff in outer 30% of fuzziness threshold for natural edges.
- Modal UI with fuzziness slider, click-to-sample on preview, live mask preview.
- Uses `compositeDocumentOnto` for accurate pixel sampling across all layers.
- 15 unit tests.

### F2.6 Quick mask mode (SHIPPED)

What it does:
Temporarily converts the selection into a paintable overlay so users can refine it with brush-like controls.

Why it exists:
Quick mask is a practical bridge between selection tools and painting.

Dependencies:
- F1.9, F1.16.

Execution scope:
- Toggle into quick mask.
- Paint add/remove selection regions.
- Customizable overlay color and opacity.

Definition of done:
- Entering and leaving quick mask preserves intended selection state.

Delivered:
- Toggle via Q key or menu. Entering saves current tool, creates mask canvas (copies existing selection if any), switches to brush.
- Paint interception in `canvasPointer.ts` via `getQuickMaskCanvas` — brush strokes go to mask canvas, not layer.
- Semi-transparent red overlay rendered in `render.ts` using `destination-out` compositing to show unselected areas.
- Exiting converts painted mask back to `selectionMask` / `selectionRect` with undo support.
- Non-destructive: empty mask on exit makes no selection change.
- Red border CSS indicator and floating chip instructions while active.

### F2.10 Distort and warp tools (SHIPPED)

What it does:
Allows local geometric deformation beyond simple free transform.

Why it exists:
Needed for compositing, mockups, perspective correction, and stylization.

Dependencies:
- F1.14.

Execution scope:
- Mesh or anchor-based warp baseline.
- Perspective correction helpers if feasible.
- Commit/cancel workflow.

Definition of done:
- Local shape changes preview smoothly and commit accurately.

**SHIPPED.** Delivered: `warp.ts` module with `WarpMesh` type, configurable grid density (1x1 to 5x5), interactive control point dragging with live preview, `applyPerspectiveDistort` helper for four-corner mapping with bilinear interior interpolation, triangle-rasterized `renderWarp` with bilinear sampling, mesh overlay drawing, modal UI with grid size selector, reset, and commit/cancel with undo. 13 tests. Registered as `warp` command, nav item with raster-layer guard.

What it does:
Provides a restrained liquify feature for push, pull, and subtle reshape operations.

Why it exists:
It is a common expectation for retouching and stylization.

Dependencies:
- F2.10.

Execution scope:
- Push tool baseline.
- Brush size and strength.
- Dedicated liquify session UI.

Definition of done:
- User can make localized shape adjustments without obvious artifacting in common cases.

**SHIPPED.** Delivered: inline displacement-map engine in `openLiquifyModal` with Float32Array dispX/dispY buffers, three brush modes (push/pull/smooth), configurable brush size (5-200px) and strength (1-100%), Gaussian-weighted brush kernel, bilinear sampling for sub-pixel displacement, modal session UI with sliders and live preview, commit/cancel with undo. Registered as `liquify` command, nav item with raster-layer guard.

### F2.14 Alignment and distribution tools (SHIPPED)

What it does:
Aligns multiple selected layers or objects relative to each other or the canvas.

Why it exists:
Manual alignment is too slow for design work.

Dependencies:
- F1.5, F1.29.

Execution scope:
- Align left, right, top, bottom, center.
- Distribute spacing horizontally and vertically.
- Align to canvas or selection.

Definition of done:
- Multiple objects reposition exactly as requested.

Delivered:
- Multi-layer selection system: `selectedLayerIds: string[]` on DocumentState, `toggleLayerMultiSelect` (Ctrl+click), `rangeSelectLayers` (Shift+click), `getSelectedLayerIds`.
- Layer list UI with `is-selected` CSS class for multi-selected rows.
- `alignment.ts` with 8 functions: `alignLeft/Right/Top/Bottom`, `alignCenterH/V`, `distributeH/V`.
- `AlignTarget` type: `"selection" | "canvas"` — toggle via menu command.
- 12 alignment/distribution nav menu items in Layer dropdown.
- 9 registered commands + `toggle-align-target`.
- 18 unit tests.

---

## PHASE 3 - AI as Optional Features

### F3.1 AI provider abstraction layer

What it does:
Creates a common interface for invoking multiple AI providers or local models for generation, vision, enhancement, and editing tasks.

Why it exists:
The product should not be tightly coupled to a single AI backend.

Dependencies:
- F0.4.

Execution scope:
- Define task categories such as segmentation, inpainting, enhancement, generation, captioning.
- Map tasks to provider capabilities.
- Standardize request/response format.
- Add provider health and timeout handling.

Definition of done:
- At least two provider implementations can satisfy the same task contract or one provider plus one stub/local adapter.

### F3.2 User-configurable AI settings

What it does:
Lets users choose which provider or model to use per task category and set credentials or local endpoints.

Why it exists:
This enables bring-your-own-AI behavior and future cost control.

Dependencies:
- F3.1.

Execution scope:
- Settings UI for provider and model selection.
- Secure storage approach for keys or local endpoint config.
- Validation and connection test flow.

Definition of done:
- User can assign a chosen provider/model for at least one AI task family.

### F3.3 Background removal

What it does:
Performs one-click subject isolation and outputs a transparent background result.

Why it exists:
This is one of the highest-value practical AI editing tools.

Dependencies:
- F3.1, F1.7, F1.9.

Execution scope:
- Run segmentation on active layer or flattened selection.
- Output as mask, new transparent layer, or replace background workflow.
- Preview before commit.

Definition of done:
- Common portrait and product images can have their backgrounds removed with useful results and editable mask output.

### F3.4 Object removal

What it does:
Lets user brush or select an unwanted object and fills the region using AI inpainting.

Why it exists:
It solves a frequent cleanup task faster than manual retouching.

Dependencies:
- F3.1, F1.9.

Execution scope:
- Mark removal region by brush or selection.
- Optional prompt guidance.
- Preview variations if provider supports it.

Definition of done:
- User can remove common distractions with a result that is good enough for first-pass cleanup.

### F3.5 Auto enhance

What it does:
Applies AI-driven correction for exposure, contrast, color, and overall clarity.

Why it exists:
Provides a fast improvement path for casual users.

Dependencies:
- F3.1.

Execution scope:
- One-click enhance action.
- Optional intensity slider.
- Show before/after preview.

Definition of done:
- Typical underexposed or dull images show a visible but not destructive improvement.

### F3.6 Upscale

What it does:
Increases image resolution using AI super-resolution or equivalent enhancement.

Why it exists:
Useful for old assets, ecommerce, and social reuse.

Dependencies:
- F3.1.

Execution scope:
- Scale presets such as 2x and 4x.
- Warn on time/cost implications.
- Preserve alpha if supported.

Definition of done:
- Upscaled output is generated and re-imported into the editor with clear provenance.

### F3.7 Denoise

What it does:
Uses AI to reduce low-light or sensor noise while preserving detail.

Why it exists:
Improves image rescue workflows beyond basic filters.

Dependencies:
- F3.1.

Execution scope:
- One-click denoise plus strength control if supported.
- Before/after comparison.

Definition of done:
- Noisy images can be improved without user confusion around output handling.

### F3.8 AI select subject

What it does:
Automatically creates a selection for the main subject in the active image.

Why it exists:
It accelerates many other edit flows without replacing manual control.

Dependencies:
- F3.1, F1.9.

Execution scope:
- Run subject detection.
- Output to selection.
- Allow refine edge as follow-up.

Definition of done:
- Main subject is selected accurately enough for common portraits and product shots.

### F3.9 AI select background

What it does:
Automatically selects background regions instead of the subject.

Why it exists:
Useful for replacement, cleanup, and backdrop corrections.

Dependencies:
- F3.8.

Execution scope:
- Invert subject result when applicable or run dedicated background segmentation.

Definition of done:
- Background selection is available as a distinct user action with predictable output.

### F3.10 AI select object by prompt

What it does:
Lets the user describe an object and attempts to create a selection matching that prompt.

Why it exists:
This is a practical bridge from AI language understanding into classical editing operations.

Dependencies:
- F3.1, F1.9.

Execution scope:
- Prompt field in selection UI.
- Selection output with optional confidence messaging.

Definition of done:
- User can request a prompt-based object selection and receive an editable selection or clear failure state.

### F3.11 Inpainting

What it does:
Fills a selected or masked area with AI-generated content that matches the surrounding scene.

Why it exists:
This is the main generative editing primitive for replace/remove workflows.

Dependencies:
- F3.1, F1.9.

Execution scope:
- Selection-driven inpainting.
- Optional prompt to describe desired replacement.
- Variation regeneration.

Definition of done:
- User can replace selected content with generated content inside the existing image bounds.

### F3.12 Outpainting

What it does:
Extends the image beyond its current canvas using AI-generated continuation.

Why it exists:
Useful for aspect conversion and background extension.

Dependencies:
- F3.11, F1.15.

Execution scope:
- Expand canvas.
- Mark generated extension zones.
- Generate fill beyond original image edges.

Definition of done:
- User can increase canvas area and populate new regions with generated continuation.

### F3.13 Style transfer

What it does:
Applies a stylistic transformation to an existing image while attempting to preserve subject structure.

Why it exists:
Adds creative exploration without requiring full image generation.

Dependencies:
- F3.1.

Execution scope:
- Prompt-driven style selection or reference-based mode.
- Strength/intensity control.

Definition of done:
- User can apply and compare at least one style-transfer workflow meaningfully.

### F3.14 AI job management

What it does:
Tracks pending, running, failed, retried, and completed AI tasks in the UI.

Why it exists:
AI features often have latency and failure modes that need explicit handling.

Dependencies:
- F3.1.

Execution scope:
- Job queue panel or compact status area.
- Cancellation where provider allows it.
- Retry with same inputs.
- Error details and quota/cost messaging if available.

Definition of done:
- User can see what AI jobs are doing and what happened when they fail.

### F3.15 Cost and fallback handling

What it does:
Adds logic for fallback providers, degraded modes, and optional cost-awareness per AI action.

Why it exists:
This makes BYO AI practical rather than theoretical.

Dependencies:
- F3.1, F3.2.

Execution scope:
- Fallback routing when primary provider is unavailable.
- Optional estimated cost display before expensive tasks.
- Clear degraded-mode messaging.

Definition of done:
- Provider failure does not always mean feature failure if an alternate route is configured.

---

## PHASE 4 - AI Workflows and Agent Layer

### F4.1 Command palette foundation (SHIPPED)

What it does:
Adds a searchable command palette for tools, actions, workflows, and future natural-language commands.

Why it exists:
This becomes the main gateway for power users and workflow orchestration.

Dependencies:
- F0.4.

Execution scope:
- Searchable command list.
- Keyboard-first interaction.
- Command history and recent actions.

Definition of done:
- User can launch core commands faster than navigating menus.

**SHIPPED.** Delivered: `commandPalette.ts` module with `scoreMatch` fuzzy scoring, `filterCommands` search/sort, `openPalette`/`closePalette`/`togglePalette`/`isPaletteOpen`, `getRecentCommandIds`/`pushRecent` for command history, full DOM rendering with keyboard navigation (ArrowUp/Down to navigate, Enter to execute, Escape to close), category badges, shortcut display, empty-state message. Registered as `command-palette` command with `Ctrl+K` shortcut. 16 tests. Palette-aware keydown handling blocks other shortcuts while open.

### F4.2 Natural-language command execution

What it does:
Accepts user instructions such as "remove background and add shadow" and routes them into a structured action plan.

Why it exists:
This is where AI becomes workflow glue rather than just isolated tools.

Dependencies:
- F4.1, F3.1, F0.4.

Execution scope:
- Parse intent from a short natural-language request.
- Map request to supported commands and parameters.
- Show proposed plan before execution for trust and editability.

Definition of done:
- At least a constrained set of compound commands can be interpreted and executed reliably.

### F4.3 Multi-step automation engine

What it does:
Runs sequences of editor and AI actions as one workflow.

Why it exists:
Compound image preparation is a major productivity opportunity.

Dependencies:
- F4.2.

Execution scope:
- Define workflow step format.
- Execute steps in order with retries and checkpointing.
- Allow user confirmation before destructive steps.

Definition of done:
- A multi-step workflow can run from one trigger and expose per-step status.

### F4.4 Preset workflow - prepare for marketplace listing

What it does:
Automates a common ecommerce flow such as crop, remove background, enhance, place on white background, and export.

Why it exists:
This is a concrete high-value automation scenario.

Dependencies:
- F4.3, relevant editor and AI steps.

Execution scope:
- Define fixed workflow recipe.
- Offer editable parameters such as target size, margin, and output format.

Definition of done:
- User can run the preset on a suitable image and receive a clean export with minimal manual intervention.

### F4.5 Preset workflow - social-ready image prep

What it does:
Prepares an image for selected social platform outputs using crop rules, enhancement, and export presets.

Why it exists:
Social publishing is a common creator workflow.

Dependencies:
- F4.3, F5.3.

Execution scope:
- Platform presets.
- Optional composition suggestions.
- Export naming conventions.

Definition of done:
- User can choose a platform and get output that matches target dimensions and format expectations.

### F4.6 Batch workflow execution

What it does:
Runs a workflow across a folder, selection of files, or multiple layers.

Why it exists:
Automation becomes significantly more valuable at batch scale.

Dependencies:
- F4.3, F3.14.

Execution scope:
- File/folder input selection.
- Queue management.
- Pause, resume, cancel.
- Per-item success/failure reporting.

Definition of done:
- Batch jobs process multiple inputs with clear progress and recoverable failures.

### F4.7 Smart suggestions system

What it does:
Offers contextual, non-intrusive suggestions such as low contrast, dark image, or likely background-removal candidate.

Why it exists:
Useful suggestions can improve discoverability without turning the app into a nagging assistant.

Dependencies:
- F3.x feature coverage for suggestions being surfaced.

Execution scope:
- Heuristics or model-driven suggestion triggers.
- Suggestion card UI.
- Dismiss and snooze behavior.

Definition of done:
- Suggestions appear when relevant and can be easily ignored or disabled.

### F4.8 Editable AI step review

What it does:
Shows which steps an AI workflow executed and allows the user to tweak or rerun individual steps.

Why it exists:
Trust and controllability are crucial for complex AI-assisted edits.

Dependencies:
- F4.3.

Execution scope:
- Step timeline.
- Per-step parameters and output previews.
- Rerun single step from checkpoint.

Definition of done:
- User can inspect a workflow after execution and selectively rerun parts of it.

### F4.9 Reusable custom workflows

What it does:
Lets users save their own action chains as named reusable workflows.

Why it exists:
Custom automation greatly expands long-term product value.

Dependencies:
- F4.3.

Execution scope:
- Save workflow recipe.
- Edit and rename workflow.
- Share or export workflow definition if desired later.

Definition of done:
- User can create and rerun a saved custom workflow without rebuilding it manually each time.

---

### F4.10 - AI & Documentation
Add documentation section as tab. 
Document all functionality and add ask AI option

## PHASE 5 - Differentiators and Long-Term Power Features

### F5.1 Hybrid manual and AI editing continuity

What it does:
Makes manual tools and AI outputs feel like part of one coherent editing flow rather than separate modes.

Why it exists:
This is a product experience differentiator, not just a technical feature.

Dependencies:
- Broad support across Phases 1 to 4.

Execution scope:
- AI outputs land as editable layers, masks, or adjustments wherever possible.
- Manual edits can refine AI results without destructive lock-in.
- Preserve provenance metadata for AI-generated changes.

Definition of done:
- AI-generated results can be refined using ordinary editor tools with minimal friction.

### F5.2 Style memory

What it does:
Allows users to save and reapply visual treatments such as color grade, effects, layer styles, and possibly composition heuristics.

Why it exists:
Consistent brand or creator output is a meaningful product advantage.

Dependencies:
- F2.1, F2.3, F4.9.

Execution scope:
- Save named look/style preset from current document.
- Reapply to another document.
- Allow partial application such as color only or effects only.

Definition of done:
- User can capture a look from one project and reuse it on another with editable results.

### F5.3 Context-aware export

What it does:
Optimizes output for intended destination such as LinkedIn, Etsy, YouTube, web listing, or print-like contexts.

Why it exists:
Users often know the destination, not the technical export settings.

Dependencies:
- F1.3, F4.3.

Execution scope:
- Intent-based export presets.
- Resize, compression, metadata, background handling, and naming rules per destination.
- Warn when source composition may not fit target aspect well.

Definition of done:
- User can export by destination intent and receive a file tuned to that channel.

### F5.4 Plugin system foundation

What it does:
Creates an extension model for third-party or internal add-ons such as filters, AI adapters, exporters, and workflows.

Why it exists:
This future-proofs the product and reduces pressure to build every feature in-house.

Dependencies:
- F0.4, F3.1, F4.3 depending on extension target.

Execution scope:
- Define plugin manifest and capability permissions.
- Sandboxed execution strategy where possible.
- Register plugin commands and UI contributions.

Definition of done:
- A sample plugin can add at least one new command or processing step safely.

### F5.5 Workflow marketplace or internal library

What it does:
Provides a browsable collection of built-in and eventually shareable workflows, presets, and style packs.

Why it exists:
It amplifies the value of workflows and presets over time.

Dependencies:
- F4.9, F5.2, F5.4.

Execution scope:
- Browse built-in workflow catalog.
- Install/enable/disable items.
- Preview expected inputs and outputs.

Definition of done:
- User can discover and enable reusable workflow assets without manual file editing.

---

## Cross-Cutting Backlog Themes

These are not single features. They should be attached to every relevant feature as acceptance work.

### X1 Performance and responsiveness

- Every tool should define acceptable latency for input, preview, and commit.
- Heavy operations should use progress UI and cancellation where practical.
- Large images should not force full rerender paths unless required.

### X2 Document fidelity and recoverability

- Native file format should preserve all editable constructs introduced by shipped features.
- Export paths should warn clearly about flattening or unsupported features.
- Autosave and recovery should continue to work as new feature types are added.

### X3 Error handling and user trust

- File import failures should be explainable.
- AI failures should show whether the cause is network, model, quota, timeout, or unsupported input.
- Destructive operations should have obvious confirmation or undo coverage.

### X4 Discoverability and onboarding

- New high-value tools should include tooltips, empty states, or first-run hints.
- Advanced features should remain discoverable through command palette and search.

### X5 Test strategy expectations

- Core document-state mutations need unit coverage.
- Rendering-critical paths need regression fixtures or screenshot comparison where realistic.
- Import/export should maintain a golden-file test set.
- AI integration should have contract tests plus provider-mocked fallback tests.

### X6 Accessibility and usability baseline

- Keyboard access should exist for major commands.
- Panels, dialogs, and command palette should be navigable without relying exclusively on pointer input.
- Contrast, focus states, and readable labeling should be maintained in the desktop UI.

### X7 Telemetry and diagnostics hooks

- Add optional instrumentation points for command usage, crash diagnostics, performance timing, and AI task success/failure.
- Keep telemetry optional and privacy-conscious if product direction later requires it.

---

## Suggested Delivery Milestones

### Milestone A - Usable editor baseline

- F0.1 through F0.5
- F1.1 through F1.5
- F1.8, F1.9, F1.10, F1.13, F1.14, F1.15
- F1.16, F1.17
- F1.21, F1.24
- F1.33, F1.34

Outcome:
The product can already function as a lightweight but real image editor.

### Milestone B - Serious non-AI editor

- Remaining Phase 1 items
- F2.1, F2.4, F2.7 through F2.15

Outcome:
The product becomes credible for deeper editing and design workflows.

### Milestone C - Practical AI tools

- F3.1 through F3.15

Outcome:
AI adds real acceleration without becoming mandatory.

### Milestone D - Workflow automation

- F4.1 through F4.9

Outcome:
The product moves from tool collection to workflow engine.

### Milestone E - Differentiation and ecosystem

- F5.1 through F5.5

Outcome:
The product develops a unique long-term moat around hybrid editing and extensibility.

---

## Priority Labels for Future Backlog Management

When this plan is later imported into an issue tracker, each feature should receive:

- Product priority: critical, high, medium, low.
- Technical risk: low, medium, high.
- User visibility: foundational, workflow, differentiator.
- Dependency status: blocked, ready, parallelizable.
- Release posture: experimental, beta, stable.

This document is intentionally broad and deep enough to function as a master backlog for a long development program.
