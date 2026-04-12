# AI Clone Object

- Canonical IDs: `D27`
- Status: shipped
- Summary or outcome: guide-driven Gemini object cloning now ships with one source guide and one-or-more destination areas on the shared floating mask-session foundation.

## Shipped scope

- Added `AI: Clone Object` as an app command and AI menu action.
- Reused the floating guide session with clone-specific copy: red marks the source object and black marks one or more destination regions.
- Supports multi-destination cloning in one pass, while filtering tiny destination specks before task construction.
- Builds Gemini inpainting tasks with `clone-object` guide semantics and targeted controller/session/command coverage.

## Acceptance Criteria

- User can invoke AI Clone Object from the app like other AI tools.
- The workflow requires both a source object guide and at least one meaningful destination area.
- Applying the workflow creates a normal undoable AI edit with provenance.

## Related

- Shared guide-session baseline: `backlog/done/epic-d022-ai-add-shadow.md`
- Related move workflow: `backlog/done/epic-d025-ai-move-object.md`
- Done index: `backlog/index-done.md`
