# Gemini Provider, Provider Selection, and Model Discovery

- Canonical IDs: `P4`
- Status: shipped
- Summary or outcome: added a native Gemini provider adapter, model discovery that fetches available models from provider APIs and classifies their capabilities, replaced free-text model inputs with dropdowns, and added per-family provider selection in settings.

## Delivered Scope

- P4.1: Created `src/app/ai/providers/geminiProvider.ts` — thin adapter wrapping `openAiCompatibleProvider` for Google Gemini execution via OAI-compatible endpoint.
- P4.2: Extended `AI_PROVIDER_IDS` with `"gemini"`, added Gemini to config types, defaults, runtime PROVIDERS map, settings HTML (full provider card with enable/endpoint/secret/validate controls), and generalized controller for multi-provider.
- P4.3: Per-family primary and fallback provider dropdowns in routing grid let users choose their active provider per task family.
- P4.4: Created `src/app/ai/modelDiscovery.ts` and `src/app/ai/modelHints.ts` — model discovery service that fetches models from provider APIs, classifies by capability, and caches per session. Gemini uses native `/v1beta/models` with `supportedGenerationMethods`; OpenAI uses `/v1/models` with heuristic classification.
- P4.5: Replaced free-text model input fields in routing grid with `<select>` dropdowns populated from model discovery, filtered by task family. Includes "Auto (default)" option and "(custom)" fallback for user-specified models.

## Shipped Notes

- Decisions resolved: OpenAI classification uses API-first with heuristic fallback via `modelHints.ts`; Gemini uses native `/v1beta/models` for discovery and OAI-compatible endpoint for execution.
- 56 new tests added (7 Gemini adapter, 6 config, 3 runtime, 21 model hints, 27 model discovery, 8 controller dropdown).
- Model hints will need periodic updates as providers release new models.
- Gemini discovery currently fetches only the first page (no pagination). Sufficient for most usage.

## Related

- Shipped baseline: `backlog/done/epic-d006-ai-provider-foundations.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
