# AI Job Inspection Debug Surface

- Canonical ID: `F4.7`
- Status: follow-up
- Summary or outcome: debug mode now exposes inspectable AI task jobs with retained prompts, sent assets, returned artifacts, and sanitized raw provider payloads across all task families.

## Outcome

- Debug-only inspect controls appear on AI task jobs in the jobs list.
- The inspection modal shows prompt text, sent image or mask inputs, returned preview artifacts, and raw provider payload content without depending on filesystem debug dumps.
- Successful and failed task jobs retain enough in-memory inspection data for post-run diagnostics across segmentation, inpainting, enhancement, generation, captioning, and text-reconstruction.

## Scope Delivered

- Extended AI request/response contracts and job queue records with debug inspection snapshots.
- Captured provider request asset snapshots and sanitized raw response payloads without exposing credentials or headers.
- Added modal UI coverage and queue/runtime/provider/controller tests for inspection behavior.
- Follow-up polish now seeds planned provider/model details during queued/running inspection states and keeps "Sent assets" anchored to stable task-level user-facing inputs instead of provider transport-specific payloads.
- Prompt display is now stable across the full job lifecycle: inpainting tasks build the full combined prompt (system + input order + user prompt) at enqueue time, and the merge prefers the enqueue-time prompt over any provider-returned prompt.
- Fixed text selection in inspection modal: added `user-select: text` to `.ai-inspection-modal-body` to override the global `body { user-select: none }` rule, enabling copy of prompts, responses, and payloads.

## Remaining Follow-Up Scope

- Improve grouping and readability when one job produces many artifacts or large payloads.
- Tune inspection presentation so deep debug detail remains useful without overwhelming routine diagnosis.

## Acceptance Criteria

- Inspect button appears only when debug logging is enabled and only for inspectable AI task jobs.
- Inspect modal can show sent assets and received outputs for all AI task families.
- Raw provider payload is visible in sanitized form after job completion.

## Related

- AI provider foundations: `backlog/done/epic-d006-ai-provider-foundations.md`
- Follow-up index: `backlog/index-follow-up.md`
