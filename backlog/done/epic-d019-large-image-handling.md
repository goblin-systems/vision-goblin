# Large Image Handling

- Canonical IDs: `D19`, `P1`
- Status: done
- Summary or outcome: keep common editing workflows responsive enough for representative large files with centralized guardrails, degraded interactive rendering, memory-aware history limits, and repeatable regression coverage.

## Shipped scope

- Added a centralized large-image policy for representative size and memory hotspots.
- Degraded interactive rendering for large documents by skipping the heaviest preview paths where practical.
- Added memory-aware undo and redo history budgeting so large documents retain bounded history instead of unbounded snapshot growth.
- Added debug-log visibility and regression tests for policy, render degradation, history trimming, and adjustment-preview guardrails.

## Acceptance Notes

- Large documents now route high-frequency interaction renders through a bounded degraded path when adjustment previews or expensive overlays would be too costly.
- Memory-heavy history growth is trimmed against byte budgets that scale down for large and huge documents.
- Coverage exists for policy classification, history guardrails, degraded render diagnostics, and adjustment-layer preview skipping.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
