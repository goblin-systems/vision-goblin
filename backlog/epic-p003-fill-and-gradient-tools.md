# Fill and Gradient Tools

- Canonical IDs: `P3`
- Status: follow-up
- Summary or outcome: selection-based fill and destructive gradient MVP now ship on the same selection-aware raster workflow without regressing undo, selection masking, or tool discoverability.

## Shipped Enhancements

- Fill / paint bucket MVP ships as a selection-only raster operation. Clicking with Fill now applies the active colour through the effective selection mask on the active unlocked raster layer, creates a single undo step, preserves redo behaviour, and reports clear non-mutating messages when no valid fill target exists.
- Gradient MVP ships as a modal-driven destructive raster operation. The Gradient tool opens a curve editor with fixed endpoints, intermediate nodes, colour editing, live preview, reset/cancel/apply controls, and applies a left-to-right gradient to the effective selected area or full active raster layer with one undoable history step.

## Remaining Scope

- Follow-up polish: gradient editing affordances, presets, direction handles, and shared fill/gradient validation copy.

## Acceptance Criteria

- Fill fills only the effective selected pixels on the active editable raster layer.
- Fill does not mutate when selection, target layer, or overlap conditions are invalid and instead shows a clear message.
- Fill creates exactly one undoable history step per successful click.
- Gradient tool lands on the same selection-aware raster foundation instead of a parallel one-off path.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Active index: `backlog/index-active.md`
