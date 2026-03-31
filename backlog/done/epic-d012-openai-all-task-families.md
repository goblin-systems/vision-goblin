# D12: OpenAI-Compatible Provider — All 5 Task Families

**ID:** D12
**Status:** Shipped

## Summary

Extended the OpenAI-compatible AI provider to support all 5 task families: segmentation, inpainting, enhancement, generation, and captioning. Previously only generation and captioning were supported, causing runtime errors for all AI selection, repair, and enhancement features. Subsequently fixed three API compatibility bugs (wrong endpoints, wrong request formats, stale model migration).

## What was done

### Initial implementation (all 5 families)

- Added `executeSegmentation()` — uses `/responses` endpoint with vision model to generate binary masks. System prompt varies by mode (subject, background, object, background-removal).
- Added `executeInpainting()` — uses `/responses` endpoint with source image + mask + prompt. System prompt describes mask semantics (white = edit, black = keep).
- Added `executeEnhancement()` — uses `/responses` endpoint with source image + operation-specific prompts (auto-enhance, upscale, denoise, restore, colorize, style-transfer).
- Updated `OPENAI_COMPATIBLE_FAMILIES` to include all 5 families.
- Updated runtime `PROVIDERS` descriptor `supportedFamilies` to include all 5 families.

### Bug fixes (API compatibility)

- **Fixed:** Enhancement was sending invalid `image` param to `/images/generations` (endpoint doesn't accept it). Switched to Responses API.
- **Fixed:** Inpainting was sending JSON to `/images/edits` (expects multipart form data). Switched to Responses API.
- **Fixed:** `normalizeAiSettings()` migration was not clearing `preferredModel` with stale stub model names like `"stub-deterministic-v1"`. Now clears any `stub-*` model names.
- **Updated model defaults:** inpainting and enhancement default to `gpt-4o` (Responses API needs vision+generation model), generation stays `gpt-image-1`.

## Files changed

- `src/app/ai/providers/openAiCompatibleProvider.ts` — all 5 family handlers using correct API endpoints
- `src/app/ai/providers/openAiCompatibleProvider.test.ts` — 35 tests covering all families
- `src/app/ai/runtime.ts` — supportedFamilies updated
- `src/app/ai/config.ts` — defaultModelForFamily() updated, stub model migration added
- `src/app/ai/config.test.ts` — 12 tests including migration and default model tests

## Acceptance criteria

- [x] All 5 families listed in provider and runtime descriptor
- [x] Segmentation, inpainting, enhancement, captioning all use `/responses` (Responses API)
- [x] Generation uses `/images/generations` (Images API)
- [x] Segmentation returns mask artifacts, inpainting/enhancement return image artifacts
- [x] Stub model names cleared during settings migration
- [x] 426 total tests, 0 regressions
- [x] Build succeeds

## Known limitations

- Segmentation quality depends on vision model's ability to produce binary masks via prompting
- Enhancement via Responses API is a prompt-based approximation (no dedicated enhancement endpoint)
- Cost estimates are rough approximations (token-based for Responses API calls)
- No integration tests against real OpenAI API
