# Core Editing Polish

- Canonical IDs: `P2`
- Legacy feature IDs: `F1.19`, `F1.28`, `F1.29`, `F1.30`
- Status: active
- Summary or outcome: improve re-editing quality and reduce destructive workarounds in partially shipped core editing workflows.

## Shipped Enhancements

- Selection-scoped destructive adjustments: when an active selection is present, `commitDestructiveAdjustment` composites the adjusted result through the selection mask instead of replacing the full layer. Affected pixels outside the selection are preserved. Unit tests added to `src/app/adjustmentModalController.test.ts`.

## Remaining Scope

- `F1.19` Healing brush: improve retouch quality on harder cases, add stronger sampling and blending controls, and reduce edge or texture artifacts.
- `F1.28` Text tool: support direct on-canvas re-editing, better text-specific transforms, and only the typography controls that materially improve common design tasks.
- `F1.29` Shape tools: improve multi-shape selection, on-canvas handles, and geometric controls where they help everyday adjustment work.
- `F1.30` Effects and style workflow polish: improve presets, per-layer style management, editing flow, and discoverability.

## Acceptance Criteria

- Healing brush handles common blemish, dust, and small object cleanup more reliably than the current baseline.
- Text remains editable after save and reopen and can be reselected and edited with less friction than the current toolbar-first workflow.
- Shapes are easy to create, restyle, and adjust without destructive workarounds.
- Common layer styling tasks are easier to apply, review, and revise than in the current baseline.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Shipped baseline: `backlog/done/epic-d004-adjustments-and-styling.md`
- Active index: `backlog/index-active.md`
