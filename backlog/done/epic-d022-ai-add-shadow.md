# AI Add Shadow

- Canonical IDs: `D22`
- Status: shipped
- Summary or outcome: dual-mask AI shadow generation using inpainting, with configurable light direction and intensity. The 15th AI tool in the app.

## Shipped scope

- Modal with 9 directional light options plus auto, intensity slider (0–100), and input scope selector.
- Controller using inpainting replace mode to generate realistic shadows within the manually painted landing mask.
- Dual guide step with empty red caster and black landing-surface masks; existing selections are ignored.
- Prompt constructed from the chosen light direction and intensity settings.
- Command registered at document level so controller validation can explain missing prerequisites instead of hard-disabling valid invocations.
- Menu entry with cloud-sun icon under the AI tools section.
- Test coverage for modal and controller.
- Follow-up polish shipped: the blocking shadow settings modal and separate floating guide panel are merged into one non-blocking floating modal-style session card that owns settings and mask painting together.

## Acceptance Criteria

- User can launch AI Add Shadow without a pre-existing selection.
- User paints both the red caster guide and black landing-surface guide manually.
- Modal lets the user configure light direction and intensity before applying.
- AI generates a shadow via inpainting replace mode and commits the result.
- Build passes and all 841 tests pass.

## Related

- AI provider foundations: `backlog/done/epic-d006-ai-provider-foundations.md`
- AI repair and generation baseline: `backlog/done/epic-d008-ai-repair-and-generation.md`
- AI nav and modals: `backlog/done/epic-d011-ai-nav-and-modals.md`
- Future — AI Relight (related but distinct): `backlog/index-future.md` (F4.3)
- Done index: `backlog/index-done.md`
