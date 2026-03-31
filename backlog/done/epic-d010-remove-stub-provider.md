# Remove Stub Provider and Clean Up Provider Infrastructure

- Canonical IDs: `P3`, `D10`
- Status: done
- Summary or outcome: deleted the stub-local AI provider which generated deterministic placeholder images, and cleaned up all references across config, defaults, settings UI, runtime, and tests so the AI platform only contains real provider paths. Added migration logic to `normalizeAiSettings()` for persisted settings that still reference `"stub-local"`.

## Delivered Scope

- P3.1: Deleted `src/app/ai/providers/stubProvider.ts` module entirely.
- P3.2: Removed `"stub-local"` from `AI_PROVIDER_IDS` union type, `DEFAULT_AI_SETTINGS`, runtime `PROVIDERS` map, `cloneProviderSettings`, and `defaultModelForFamily`.
- P3.3: Removed the stub-local provider card from `index.html` and all related bindings in `controller.ts`.
- P3.4: Updated all test fixtures referencing `"stub-local"` across `runtime.test.ts`, `registry.test.ts`, `jobQueue.test.ts`, `editingSupport.test.ts`, `documents.test.ts`, `secureStore.test.ts`, and `controller.test.ts`. All 368 tests pass.
- P3.5: `normalizeAiSettings()` gracefully migrates persisted settings that reference `"stub-local"` to `"openai-compatible"` on load. New migration tests added in `config.test.ts`.

## Acceptance Criteria (all met)

- No source file references `stub-local` or `stubProvider` after delivery (only migration logic and its tests reference the string for backward compatibility).
- `npm test` passes with all 368 tests.
- `npm run build` succeeds.
- Persisted settings with `"stub-local"` are silently migrated on load without error.
- No runtime provider map entry exists for a stub provider.

## Related

- Shipped baseline: `backlog/done/epic-d006-ai-provider-foundations.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
