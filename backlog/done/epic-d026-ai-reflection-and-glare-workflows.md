# AI Reflection And Glare Workflows

- Canonical IDs: `D26`
- Legacy feature IDs: `F4.4`
- Status: shipped
- Summary or outcome: guide-driven Gemini reflection and glare add/remove workflows now ship on the shared floating mask-session foundation.

## Shipped scope

- Added `AI: Add Reflection` and `AI: Remove Reflection` as app commands and AI menu actions.
- Reused the shared floating guide session so both workflows fit the same non-blocking paint-and-apply model as the shadow tools.
- Add Reflection ships with dual-guide semantics: red marks the source object or bright cause, black marks the target reflection region.
- Remove Reflection ships with black-led cleanup semantics and optional red context.
- Gemini inpainting tasks now support `reflection-add` and `reflection-remove` guide modes with dedicated prompt semantics and targeted tests.

## Acceptance Criteria

- User can launch both reflection workflows from the app like other AI editing tools.
- The guide session copy makes add-vs-remove intent clear before apply.
- Applying either workflow creates a normal undoable AI edit with provenance.

## Related

- AI provider foundations: `backlog/done/epic-d006-ai-provider-foundations.md`
- Shared guide-session baseline: `backlog/done/epic-d022-ai-add-shadow.md`
- Done index: `backlog/index-done.md`
