# Cross-Cutting Product Requirements

- Canonical IDs: `R1`
- Status: active constraint
- Summary or outcome: keep performance, trust, fidelity, and usability standards visible across all backlog decisions.

## Scope

- Performance and responsiveness: define acceptable latency for input, preview, and commit on heavy tools; add progress, cancellation, or degraded-mode UX where operations are slow; avoid unnecessary full rerender paths.
- Document fidelity and recoverability: preserve editable constructs in the native format, warn on flattening or unsupported export behavior, and maintain autosave and recovery as new feature types are added.
- Error handling and trust: keep failures explainable, protect destructive steps with confirmation or undo, and distinguish common AI failure modes where possible.
- Discoverability and onboarding: keep high-value tools discoverable through hints, menus, shortcuts, and command palette search.
- Quality expectations: maintain unit coverage for core mutations, regression coverage for rendering-critical behavior where practical, fidelity coverage for import and export, and contract-style coverage for AI integrations.
- Accessibility and usability baseline: preserve keyboard access, avoid pointer-only critical flows, and maintain acceptable contrast, labeling, and focus states.
- Optional telemetry and diagnostics: allow future privacy-conscious instrumentation for command usage, crashes, performance timing, and AI job outcomes.

## Acceptance Criteria

- New epics explicitly account for the relevant constraints above.
- Performance, fidelity, reliability, and usability tradeoffs stay visible during prioritization.

## Related

- Active index: `backlog/index-active.md`
- Follow-up index: `backlog/index-follow-up.md`
- Future index: `backlog/index-future.md`
