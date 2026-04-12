# AI Move Object

- Canonical IDs: `D25`
- Status: shipped
- Summary or outcome: guide-driven Gemini object relocation built on the shared red/black floating guide session foundation, with stronger Gemini move semantics for source cleanup, single-instance placement, and identity preservation.

## Shipped scope

- Added `AI: Move Object` as a new AI editing action using the shared floating guide panel workflow.
- Reused the dual-guide session foundation with move-object-specific copy and channel labels: red marks the original object to move and black marks the new destination area.
- Added clearer Gemini move-object prompt semantics covering source removal, background healing, exact single-instance relocation, identity preservation, and no duplicates or ghosts.
- Built Gemini inpainting tasks with `guideMode: move-object`, a merged source+destination edit mask, and dual-colour object guide transport.
- Registered app command and AI menu entry alongside the existing AI tools.
- Added focused tests for controller behavior, destination validation, shared guide session copy, command registration, merged guide-mask support, and Gemini prompt contract.

## Acceptance Criteria

- User can invoke AI Move Object from the app like other AI tools.
- Unified floating guide panel opens with move-object semantics.
- Gemini receives the correct move-object guide mode and prompt contract.
- Gemini receives stronger move-object instructions so the source area is healed, the object is relocated once, and duplicate or ghost outputs are discouraged.
- Build passes and targeted tests cover the new flow.

## Related

- Shared guide foundation: `backlog/done/epic-d022-ai-add-shadow.md`
- Shadow removal on the same foundation: `backlog/done/epic-d024-ai-remove-shadow.md`
- Done index: `backlog/index-done.md`
