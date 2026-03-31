# Large Image Handling

- Canonical IDs: `P1`
- Status: active
- Summary or outcome: keep common editing workflows responsive enough for real work on representative large files.

## Scope

- Measure representative file sizes and hotspot operations.
- Reduce unnecessary full-canvas work during pan, zoom, and history-driven updates.
- Add guardrails for memory-heavy operations.
- Improve visibility into expensive operations, failures, or degraded modes where needed.

## Acceptance Criteria

- Large test files remain usable for common pan, zoom, paint, selection, and transform workflows.
- Memory spikes are understood and mitigated where practical.
- Regressions are testable or benchmarkable in repeatable scenarios.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Active index: `backlog/index-active.md`
