# Fill and Gradient Tools

- Canonical IDs: `P3`
- Status: done
- Summary or outcome: completed the bounded fill and gradient tool polish so the shipped selection-aware raster workflow now includes shared validation, built-in presets, modal-only direction editing, and clearer gradient affordances without regressing undo or discoverability.

## Shipped Enhancements

- Fill / paint bucket MVP ships as a selection-only raster operation. Clicking with Fill now applies the active colour through the effective selection mask on the active unlocked raster layer, creates a single undo step, preserves redo behaviour, and reports clear non-mutating messages when no valid fill target exists.
- Gradient MVP ships as a modal-driven destructive raster operation. The Gradient tool opens a curve editor with fixed endpoints, intermediate nodes, colour editing, live preview, reset/cancel/apply controls, and applies a left-to-right gradient to the effective selected area or full active raster layer with one undoable history step.
- Shared fill and gradient validation now route through common helpers so invalid raster targets, missing selections, and related non-mutating states surface consistent copy across both workflows.
- Built-in gradient presets now ship in the shared modal so common starting points are available without manual stop reconstruction.
- Linear and radial gradient direction handles now ship inside the shared gradient modal, keeping direction editing discoverable while avoiding extra on-canvas tool-state complexity.
- Shared gradient modal affordance polish now clarifies editing controls and direction manipulation within the existing destructive workflow.

## Remaining Scope

- None for the bounded P3 completion slice.

## Acceptance Criteria

- Fill fills only the effective selected pixels on the active editable raster layer.
- Fill does not mutate when selection, target layer, or overlap conditions are invalid and instead shows a clear message.
- Fill creates exactly one undoable history step per successful click.
- Gradient tool lands on the same selection-aware raster foundation instead of a parallel one-off path.
- Fill and gradient validation copy stays consistent for equivalent invalid target states.
- Gradient presets and modal-only direction handles cover the planned bounded editing polish.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
