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
- Current phase: finish the missing editor core so the app becomes a trustworthy image editor, not just a strong shell.
- Next phase after that: persistence and native desktop utilities.
- Later phases: advanced non-AI editing, optional AI tools, automation, and extensibility.

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

---

## Active Roadmap

## PHASE 1A - Finish the Core Editor

### F0.4 Command, action, and shortcut system

What it does:
Creates a central command registry so menus, buttons, keyboard shortcuts, and future command palette entries all invoke one shared action layer.

Why it exists:
The app already has multiple entry points for the same behaviors. The next phase should unify them before more tools are added.

Dependencies:
- F0.1.

Execution scope:
- Define command ids, labels, shortcuts, context, enable/disable rules, and handlers.
- Route top navigation menus and keyboard shortcuts through the same command registry.
- Make command availability derive from current document/tool/selection state.
- Prepare for command palette and automation later.

Definition of done:
- Common actions execute through one code path.
- Disabled commands never fire.
- Shortcut conflicts can be detected in one place.

### F0.5 Autosave and crash recovery

What it does:
Periodically snapshots recoverable document state and offers restore after unexpected shutdown.

Why it exists:
The editor now has enough destructive capability that unsaved work protection is a priority.

Dependencies:
- F0.2.

Execution scope:
- Autosave dirty documents on interval and important state transitions.
- Restore unsaved sessions on next launch.
- Show recovery UI with per-document choices.
- Clean up stale recovery entries on intentional successful close.

Definition of done:
- Forced crash during editing produces a recoverable session.
- Restore/discard works per document.
- Recovery never silently overwrites a user-saved file.

### F1.2 File open, import, save, save as, and recent files

What it does:
Completes the file workflow with recent-file recall and better missing-file handling.

Why it exists:
Core file IO exists, but daily desktop use still needs a reliable recent-files layer.

Dependencies:
- F0.2, F0.5.

Execution scope:
- Keep current image open, project save, save as, and drag-drop behavior.
- Add recent files/projects list with persistence.
- Mark or remove stale entries cleanly.
- Add a top-nav entry point for recent files.

Definition of done:
- User can reopen recent work quickly.
- Invalid recent entries fail gracefully.

### F1.4 New document creation flow

What it does:
Upgrades the current blank-canvas modal into a real new-document flow.

Why it exists:
The editor can create blank canvases, but common presets and background choices are still missing.

Dependencies:
- F0.2.

Execution scope:
- Keep custom dimensions.
- Add presets for common web, social, and print outputs.
- Add transparent or solid background choice.
- Add create-from-clipboard as part of the same flow where available.

Definition of done:
- New canvas creation is fast for common use cases.
- Blank, preset, and clipboard-start flows all feel intentional.

### F1.10 Marquee tool - rectangular and elliptical

What it does:
Allows geometric selections with modifier keys for constrain-from-center and aspect behavior.

Why it exists:
Fast, precise geometric selections are everyday editing actions.

Dependencies:
- F1.9.

Execution scope:
- Rectangular marquee.
- Elliptical marquee.
- Feather value support placeholder or basic implementation.
- Modifier behaviors for add/subtract/constrain.

Definition of done:
- User can make and modify geometric selections accurately.

### F1.11 Lasso and polygonal lasso

What it does:
Allows freehand and point-by-point irregular selections.

Why it exists:
Many practical selections are not rectangular.

Dependencies:
- F1.9.

Execution scope:
- Freehand lasso path capture.
- Polygonal lasso with click-to-place vertices.
- Close path behavior and escape/cancel behavior.

Definition of done:
- User can create irregular selections with predictable edge behavior.

### F1.12 Magic wand selection

What it does:
Selects connected or global pixels by color similarity.

Why it exists:
It is a fast baseline selection tool for simple isolation tasks.

Dependencies:
- F1.9.

Execution scope:
- Tolerance control.
- Contiguous and non-contiguous modes.
- Anti-alias handling.
- Sample current layer versus composite.

Definition of done:
- Clicking visually similar areas creates expected selections on common test images.

### F1.14 Transform tool - remaining enhancements

What it does:
Adds perspective transforms, configurable pivot point, and constrained rotation to the existing transform tool.

Why it exists:
The baseline transform (scale, rotate, skew, commit/cancel) is complete. These enhancements close the gap to professional parity.

Dependencies:
- Existing transform tool baseline.

Execution scope:
- Configurable pivot point with visual indicator and drag repositioning.
- Constrained rotation snapping (Shift for 15-degree increments).
- Visual pivot indicator rendered on the transform bounding box.

Definition of done:
- Pivot point can be moved and rotation snaps to angles when Shift is held.
- Pivot indicator is visible and intuitive.

---

## PHASE 1B - Desktop Reliability and Differentiators

### F1.31 Global screen snipping

What it does:
Captures screen regions, windows, or full displays into new editor documents.

Why it exists:
It is one of the most compelling native-desktop differentiators for the app.

Dependencies:
- F0.4, F1.2.

Execution scope:
- Region, window, and full-screen capture.
- Create a new document from captured pixels.
- Preserve monitor scaling behavior correctly.
- Add reliable shortcuts and permission handling.

Definition of done:
- Snips land in the editor quickly and predictably.
- Capture behaves correctly across common display setups.

### F1.32 Global color picker

What it does:
Lets the user sample any pixel on screen, not just inside the editor canvas.

Why it exists:
This is another strong native utility that complements editing workflows.

Dependencies:
- F0.4.

Execution scope:
- Global pick mode with magnified preview if feasible.
- Return picked color to the active paint swatch and picker UI.
- Handle cancel/escape cleanly.

Definition of done:
- User can sample off-canvas colors reliably.
- Picked color immediately becomes usable inside the editor.

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

### F1.18 Clone stamp

What it does:
Copies sampled pixels from one area to another for repair and duplication.

Why it exists:
It is a foundational retouching tool for blemish removal and texture rebuilding.

Dependencies:
- F1.16, F1.9.

Execution scope:
- Alt/option-click sample point.
- Aligned and non-aligned sampling modes.
- Current layer or composite sampling.
- Sample preview indicator.

Definition of done:
- Sampled content follows cursor accurately and predictably.

### F1.19 Healing brush

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

### F1.20 Smudge tool

What it does:
Pushes and blends nearby pixels to create smear or painterly transitions.

Why it exists:
Useful for quick blending, painterly workflows, and light retouching.

Dependencies:
- F1.16.

Execution scope:
- Strength control.
- Sample accumulation along stroke.
- Respect active selection.

Definition of done:
- Tool visibly drags color in a controllable way without instability.

### F1.21 Basic adjustments - brightness and contrast

What it does:
Adjusts overall tonal intensity and contrast of the active layer or selection.

Why it exists:
Fast tonal correction is a universal entry-level need.

Dependencies:
- F1.5, F1.9.

Execution scope:
- Preview before apply.
- Numeric sliders and reset.
- Apply to selection or whole target.

Definition of done:
- Visible adjustment matches slider changes and is undoable.

### F1.22 Levels

What it does:
Adjusts black point, white point, and midtone response with histogram guidance.

Why it exists:
Levels is a core serious correction tool.

Dependencies:
- F1.21.

Execution scope:
- Show histogram.
- Input black, gamma, white controls.
- Output range controls if feasible.
- Live preview.

Definition of done:
- Histogram-driven edits apply correctly and preview accurately.

### F1.23 Curves

What it does:
Provides fine-grained tone remapping through editable curve points.

Why it exists:
Curves is essential for advanced tonal control.

Dependencies:
- F1.22.

Execution scope:
- Composite curve editing baseline.
- Point add/move/delete.
- Reset and preset support.
- Live preview.

Definition of done:
- Curve edits visibly and accurately affect tone mapping.

### F1.24 Hue and saturation

What it does:
Adjusts overall or targeted color intensity and hue shift.

Why it exists:
Basic color correction and stylization require this control.

Dependencies:
- F1.21.

Execution scope:
- Hue shift.
- Saturation control.
- Lightness/value control if included.
- Preview and reset.

Definition of done:
- Color adjustments produce predictable changes on representative images.

### F1.25 Color balance

What it does:
Shifts shadows, midtones, and highlights toward chosen color ranges.

Why it exists:
It provides intuitive correction for warmth/coolness and cast removal.

Dependencies:
- F1.24.

Execution scope:
- Tonal range targeting.
- Preserve luminosity option if supported.
- Live preview.

Definition of done:
- Different tonal ranges can be shifted without obvious UI ambiguity.

### F1.26 Gradient maps

What it does:
Maps luminance to custom gradient colors for stylization and grading.

Why it exists:
Useful for looks, duotones, and creative effects even before AI features.

Dependencies:
- F1.24.

Execution scope:
- Gradient editor baseline.
- Preset gradients.
- Preview and apply.

Definition of done:
- Gradient map output matches the configured gradient stops.

### F1.27 LUT support

What it does:
Applies lookup-table based color transforms from supported LUT formats.

Why it exists:
It improves compatibility with existing creator and photo workflows.

Dependencies:
- F1.24.

Execution scope:
- Import supported LUT file formats.
- Preview LUT effect.
- Intensity slider if feasible.

Definition of done:
- User can apply a LUT and get a stable, repeatable result.

### F1.28 Text tool

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

### F2.1 Adjustment layers

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

### F2.2 Smart objects - lightweight embedded assets

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

### F2.4 Edge refinement

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

### F2.5 Select by color range

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

### F2.6 Quick mask mode

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

### F2.7 Blur filter suite

What it does:
Adds Gaussian blur and motion blur as baseline blur effects.

Why it exists:
Blur is needed for depth, softening, masks, and graphic effects.

Dependencies:
- F1.5.

Execution scope:
- Gaussian blur.
- Motion blur with angle and distance.
- Preview and apply.

Definition of done:
- Blur effects render correctly on whole layers or selections.

### F2.8 Sharpen filter suite

What it does:
Adds baseline sharpening for detail recovery and local crispness.

Why it exists:
Sharpening is a standard corrective tool.

Dependencies:
- F2.7.

Execution scope:
- Basic sharpen.
- Strength control.
- Preview and apply.

Definition of done:
- Sharpen visibly increases edge contrast without UI ambiguity.

### F2.9 Noise add and reduce

What it does:
Adds or removes image noise for creative and corrective workflows.

Why it exists:
Noise handling is important for low-light images and stylized textures.

Dependencies:
- F2.7.

Execution scope:
- Add monochrome or color noise.
- Basic noise reduction.
- Preview and apply.

Definition of done:
- User can intentionally add grain or reduce visible noise with understandable controls.

### F2.10 Distort and warp tools

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

### F2.11 Liquify lite

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

### F2.12 Rulers, guides, and snapping

What it does:
Adds alignment infrastructure for precision layout work.

Why it exists:
Essential for design-oriented and UI composition workflows.

Dependencies:
- F0.3.

Execution scope:
- Show rulers.
- Drag guides from rulers.
- Snap layers, shapes, and selections to guides and canvas edges.
- Toggle snap behavior.

Definition of done:
- Guides are visible, movable, and influence alignment predictably.

### F2.13 Grid system

What it does:
Displays configurable document grids for spacing and alignment.

Why it exists:
Supports precision composition and consistent layout.

Dependencies:
- F2.12.

Execution scope:
- Grid visibility toggle.
- Grid spacing and subdivisions.
- Snap to grid.

Definition of done:
- Grid settings persist per document or globally according to chosen design.

### F2.14 Alignment and distribution tools

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

### F2.15 Pixel-level editing mode

What it does:
Improves precision for high-zoom work such as icon editing, texture cleanup, and exact pixel changes.

Why it exists:
Some workflows demand explicit pixel control.

Dependencies:
- F0.3, F1.16.

Execution scope:
- Crisp nearest-neighbor view at high zoom.
- Single-pixel brush behavior.
- Pixel grid overlay.

Definition of done:
- High-zoom editing does not blur actual pixel boundaries in the view.

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

### F4.1 Command palette foundation

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
