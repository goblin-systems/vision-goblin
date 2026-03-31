# Backlog Structure

Use this folder for detailed backlog content. `AGENTS.md` is the repo-level entrypoint; this folder holds the epic files and navigation indexes.

## Naming Convention

- `epic-pNNN-slug.md`: current priority epics
- `epic-fNNN-slug.md`: feature, follow-up, or future roadmap epics
- `epic-rNNN-slug.md`: cross-cutting product requirements
- `done/epic-dNNN-slug.md`: shipped baseline or MVP epics

Numbering is stable and zero-padded. When older IDs exist, keep them inside the file as canonical or legacy IDs. Example: `F3.1` maps to filename key `f301`.

## Navigation

- `index-active.md`: current priorities
- `index-follow-up.md`: shipped areas with meaningful remaining scope
- `index-future.md`: deferred roadmap epics
- `index-done.md`: shipped epics

Start with the index that matches the work, then open the relevant epic file.

## Epic Template

Each epic file should include:

- Title
- Canonical ID or legacy IDs
- Status
- Summary or outcome
- Scope or remaining scope
- Acceptance criteria
- Related links when useful

## Maintenance Rules

- Backlog is organized around epic files, not broad category files.
- Keep active work easy to scan in one hop through the indexes.
- Move shipped work to `done/` instead of leaving it in active indexes.
- Preserve feature IDs when they improve traceability.
- Keep wording concise and decision-ready.
- Do not duplicate the same epic across multiple indexes without a clear reason.
