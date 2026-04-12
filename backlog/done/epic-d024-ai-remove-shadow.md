# AI Remove Shadow

- Canonical IDs: `D24`
- Status: shipped
- Summary or outcome: guide-driven Gemini shadow reduction and removal built on the shared floating guide session foundation, with black-driven shadow targeting and optional red context.

## Shipped scope

- Added `AI: Remove Shadow` as a new AI editing action using the shared floating guide panel workflow.
- Reused the shared guide session foundation with remove-shadow-specific copy and channel labels: black marks the shadow region to lighten or remove, while red remains optional context only.
- Added a shadow reduction strength slider plus input scope control in the shared panel without reintroducing a separate blocking modal.
- Built Gemini-only inpainting tasks with `guideMode: shadow-remove` and guide-only transport.
- Registered app command and AI menu entry alongside existing AI tools.
- Added focused tests for controller behavior, command registration, shared guide session behavior, guide-only transport support, and Gemini prompt contract.

## Acceptance Criteria

- User can invoke AI Remove Shadow from the app like other AI tools.
- Unified floating guide panel opens with remove-shadow semantics.
- Remove Shadow can complete with only the black guide painted.
- Gemini receives the correct guide mode and guide-only prompting contract for shadow removal.
- Build passes and targeted tests cover the new flow.

## Related

- Shared guide foundation and shadow generation baseline: `backlog/done/epic-d022-ai-add-shadow.md`
- Gemini refusal surfacing and shadow test fixtures: `backlog/done/epic-d023-gemini-refusal-text-surfacing.md`
- Follow-up shipped next: `backlog/done/epic-d025-ai-move-object.md`
- Done index: `backlog/index-done.md`
