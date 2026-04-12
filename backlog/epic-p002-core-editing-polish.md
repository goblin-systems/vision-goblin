# Core Editing Polish

- Canonical IDs: `P2`
- Legacy feature IDs: `F1.19`, `F1.28`, `F1.29`, `F1.30`
- Status: done
- Summary or outcome: completed the remaining core editing polish slices so healing, text, shapes, and layer styles now stay editable and less destructive in the shipped P2 workflow.

## Shipped Enhancements

- Selection-scoped destructive adjustments: when an active selection is present, `commitDestructiveAdjustment` composites the adjusted result through the selection mask instead of replacing the full layer. Affected pixels outside the selection are preserved. Unit tests added to `src/app/adjustmentModalController.test.ts`.
- Clipboard image copy: `Ctrl+C` now copies either the composited document or the effective selected pixels as a PNG, cropping to non-rectangular selection bounds with transparency preserved for paste back into Vision Goblin or compatible external apps.
- Text inspector font picker: replaced the raw font-family text field with a searchable dropdown picker that keeps typed filtering, supports persisted custom fonts, and still updates text-layer `fontFamily` through the existing inspector edit flow.
- `F1.28` direct text re-editing slice: active text layers now support on-canvas `textarea` editing, auto-enter edit after creation, and active-layer double-click re-entry with blur-to-commit, Escape cancel, and one session-level history entry.
- `F1.28` text tool edit targeting: when the text tool is active, hovering editable canvas text now shows a text cursor and single-clicking existing text enters in-place editing instead of creating a replacement text layer.
- `F1.28` text transform completion: common text transforms now stay text-native, side handles resize text boxes instead of skewing, and transformed text remains on-canvas re-editable after save and reopen.
- `F1.28` dual text transform behavior: the text tool now opens a text-layout transform session for selected text layers so side handles resize wrapping width without geometric distortion, while the transform tool keeps true layer-level text scale/skew/rotate behavior and existing-text editing now relies on double-click instead of stealing single-click transform gestures.
- `F1.29` shape editing polish MVP slice: move and transform now reselect visible unlocked shapes directly from the canvas, move mode can drag a reselected shape in the same gesture, and single-shape resize or rotate commits stay `type === "shape"` so shape styling survives further edits and reopen.
- `F1.29` multi-shape transform completion: layer-list multi-selection of visible unlocked shape layers now starts a shared group transform session, group move/scale/rotate commit back into each member's native `shapeData` instead of rasterizing, locked or background layers are excluded, and save/reopen preserves transformed geometry for further shape editing.
- Canvas layer picking polish: `Alt` + click now selects the topmost visible unlocked pixel-backed layer under the cursor across raster, text, shape, and smart-object layers, while preserving clone-stamp `Alt` source picking and existing selection-tool gestures.
- Paint cursor polish: brush, eraser, healing brush, and clone stamp now show a live brush-size ring on the canvas, and `Alt` + mouse wheel resizes the active brush for paint flows without stealing normal wheel zoom elsewhere.
- `F1.19` healing brush completion slice: healing now auto-picks a nearby donor patch instead of averaging a tiny local ring, adds explicit sample-spread and texture-blend controls alongside strength, respects active selection masks while painting, improves responsiveness with per-stroke donor-search reuse and cached annulus scoring samples for large brushes, and ships regression coverage for textured blemish and edge-preservation cases.
- `F1.30` effects and style workflow polish: the existing layer-effects inspector now supports safer per-layer effect editing with undoable add/remove/toggle/clear/apply flows, custom preset saves update confidently instead of silently duplicating, effect stacks persist through save/reopen and undo/redo, same-type effects render coherently within the existing per-bucket effect model, and enabled styles stay discoverable from the layer list.

## Remaining Scope

- None for the bounded P2 completion slice.

## Acceptance Criteria

- Healing brush handles common blemish, dust, and small object cleanup more reliably than the current baseline.
- Text remains editable after save and reopen and can be reselected and edited with less friction than the current toolbar-first workflow.
- Shapes are easy to create, restyle, and adjust without destructive workarounds.
- Common layer styling tasks are easier to apply, review, and revise than in the current baseline.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Shipped baseline: `backlog/done/epic-d004-adjustments-and-styling.md`
- Active index: `backlog/index-active.md`
