# Epic D23 — Gemini Refusal Text Surfacing

**Status:** Done
**Area:** AI provider / Gemini

## Problem

When Gemini declined to generate an image due to a safety block or policy refusal, the error shown to the user was a generic message with no visibility into what Gemini actually said. For example:

```
AI task failed: "AI shadow generation" – Gemini inpainting response did not include an image.
```

The AI's explanation (or block reason) was silently discarded.

## Root Cause

`parseNativeResponse` in `geminiProvider.ts` only extracted text from `candidates[0].content.parts[].text`. Additional Gemini refusal structures produced no `text` at all:

1. **Safety block, no content field** — `candidates[0].finishReason: "SAFETY"`, no `content`
2. **Prompt-level block** — empty `candidates[]`, `promptFeedback.blockReason: "SAFETY"`
3. **Empty content parts with non-STOP finishReason** — `candidates[0].content.parts: []`, `finishReason: "RECITATION"`
4. **Real-world image refusal with human-readable finish message** — `candidates[0].finishReason: "IMAGE_OTHER"`, `finishMessage: "Unable to show the generated image..."`

## Solution

### `geminiProvider.ts`

- Enhanced `parseNativeResponse` with a fallback extraction block:
  - Checks `candidates[0].finishReason` — if present and not `"STOP"`, adds `"Finish reason: <REASON>"`
  - Checks `promptFeedback.blockReason` on the raw response — if present, adds `"Prompt blocked: <REASON>"`
  - Checks `candidates[0].finishMessage` before fallback reasons so Gemini's human-readable refusal text wins over generic reason codes
  - Joins reasons with `". "` and sets `text` when no text parts were found
- Added WARN-level response payload logging in all 4 failure branches (generation, segmentation, inpainting, enhancement):
  - `options.log?.(\`[AI provider debug][gemini] Response payload (no images): ${JSON.stringify(payload)}\`, "WARN")`

### Fixture-backed integration coverage

- Copied the real AI shadow selected-layers image and mask into `src/test/samples/` as:
  - `ai_shadow_selected_layers.png`
  - `ai_shadow_mask.png`
- Added a deterministic provider-level integration-style test under `src/test/e2e/gemini-provider.e2e.test.ts` that:
  - loads those real fixtures
  - builds an inpainting task matching the AI shadow workflow shape
  - mocks the exact `finishMessage` refusal payload
  - asserts both `error.message` and `error.aiMessage` surface the human-readable Gemini text

### `geminiProvider.test.ts`

- Added 3 new response factory helpers: `makeSafetyBlockedResponse`, `makePromptBlockedResponse`, `makeEmptyPartsResponse`
- Added 12 new test cases (3 structures × 4 task families) verifying the error message contains the block/finish reason string

## Contracts

`AiTaskError.aiMessage?: string` was already added to `src/app/ai/contracts.ts` in a prior session. No further changes needed.

## Files Changed

- `src/app/ai/providers/geminiProvider.ts`
- `src/app/ai/providers/geminiProvider.test.ts`
- `src/test/e2e/gemini-provider.e2e.test.ts`
- `src/test/e2e/helpers.ts`
- `src/test/samples/ai_shadow_selected_layers.png`
- `src/test/samples/ai_shadow_mask.png`

## Validation

- Targeted fixture-backed Gemini refusal test passes
- Provider unit tests pass
- Full test suite and build currently fail for unrelated pre-existing text/canvas issues elsewhere in the repo
