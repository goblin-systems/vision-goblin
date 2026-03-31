# AI Provider Foundations

- Canonical IDs: `F3.1`, `F3.2`, `F3.14`, `F3.15`
- Status: done
- Summary or outcome: the shared AI platform slice now ships provider configuration, secure credential handling, observable job lifecycle UX, fallback routing, and degraded-mode messaging for feature-specific tools to build on.

## Outcome

- `F3.1` Shared task families, normalized provider request and response contracts, registry-based routing, and two adapter paths ship in code.
- `F3.2` Users can configure provider enablement, endpoint and secure credential handling, model preference by task family, and provider validation from the app settings surface.
- `F3.14` The app now exposes an AI job queue with pending, running, failed, retried, cancelled, and completed states, plus cancel and retry controls where supported.
- `F3.15` Runtime routing now supports alternate providers, degraded-mode messaging when fallback takes over, and estimated cost messaging when usage data provides a rough cost.

## Scope Delivered

- Secure provider secrets stay out of `settings.json` and are persisted in a dedicated `credentials.json` store via `tauri-plugin-store`.
- The original `keyring` crate backend was replaced after repeated write-then-read failures on Windows. The new implementation lives entirely in TypeScript (`src/app/ai/secureStore.ts`) and is covered by 10 direct unit tests, 2 integration tests, and 2 controller tests.
- AI settings are visible in the existing settings tab and AI job state is visible in the editor shell.
- The shared runtime is ready for future selection, repair, enhancement, and automation features to enqueue jobs without re-solving provider orchestration.

## Acceptance Criteria

- The product can route the same AI task shape through more than one provider path.
- A user can assign and validate an AI provider or model for at least one task family.
- Users can tell what an AI job is doing and what failed when something goes wrong.
- Provider failure does not always mean feature failure when alternates are configured.

## Related

- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
- Done index: `backlog/index-done.md`
