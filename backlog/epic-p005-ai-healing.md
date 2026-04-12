# AI Healing

- Canonical IDs: `P005`
- Status: active
- Summary or outcome: add a single-pass AI healing workflow that reuses the unified AI mask session foundation and shared masked raster preparation path, without touching the manual healing brush.

## Progress notes

- Shared AI input-scope defaults now route through one helper so prompt modals and unified mask sessions default to `selected-layers` consistently where scope is exposed.
- AI Healing and Replace Raster Text now default to `selected-layers`, Replace Raster Text exposes the same session scope selector as other mask-session tools, and inpaint keeps only one effective scope selector by using the session scope plus a prompt-only text modal.
- Unified mask-session selection-mode polish now gives intersect a readable `Intersect` tooltip/aria label with a text fallback instead of the broken icon.
- Phase 1 mask-session consistency slice shipped: move object, clone object, add/remove shadow, and add/remove reflection now expose the same selection-capable tool picker as inpaint, and `AI: Inpaint Selection` command gating now requires only an open document.
- Phase 2 consistency slice shipped: AI Denoise now launches the unified single-channel mask session with selection-capable tools, in-session input scope + strength controls, shared scoped raster target prep, and blank-mask full-target fallback while still using the enhancement task family.

## Scope

- Add `AI: Healing` as a standard AI action reachable from command registration and the AI navigation menu.
- Reuse the shared single-channel AI mask session flow for mask painting and selection tools.
- Require a non-empty user mask for healing; unlike raster text replacement, healing must not silently fall back to the full target.
- Extract reusable scoped raster target + mask preparation into a focused helper under `src/app/ai/` so raster-text replacement and healing share the same coordinate and scope logic.
- Run one normal `inpainting` family task with a fixed healing prompt and apply the result back as an undoable AI raster edit with provenance.
- Preserve existing `replaceRasterText` blank-mask fallback behaviour and keep manual editor-domain healing untouched.
- Reuse centralized AI input-scope defaults so mask-session and prompt-based AI tools consistently default to selected layers, remove duplicate scope choice from inpaint, and expose the same scope control in replace-raster-text.
- Polish the unified AI mask-session selection-mode UI so the intersect button uses a sane fallback glyph and human-readable tooltip/aria copy.

## Acceptance Criteria

- A user can invoke AI Healing like other AI actions.
- AI Healing opens the shared single-channel AI mask workflow.
- Empty masks are rejected for AI Healing.
- Healing performs one inpainting request using the fixed healing prompt.
- `replaceRasterText` still supports its previous blank-mask fallback behaviour.
- Manual healing brush behaviour remains unchanged.
- Targeted tests cover controller behaviour, shared raster-target prep, command registration, and nav wiring.

## Related

- Unified mask session baseline: `backlog/done/epic-d028-unified-ai-mask-session.md`
- Raster text cleanup follow-up: `backlog/epic-f420-ai-text-cleanup-and-ocr-replace.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
