# Epic F201 — Branching History (Git-Style)

**Status:** Future — not scheduled  
**Priority:** Low (deferred)

## Goal

Evolve the undo/redo history model from a linear stack into a branching tree, so that undoing and then taking a new action creates a new branch rather than permanently discarding the undone future. Users can navigate between branches to revisit alternative edit paths.

## Motivation

The current model (as of the history cursor refactor) correctly greys out undone entries and discards them when a new action is taken. This is the standard Photoshop-style model. The branching model goes further: like git, every divergence point is preserved as a branch. Users could explore "what if I had done X instead" without losing their current work.

## Proposed Behaviour

- Each document carries a history tree (a DAG/tree of snapshots) rather than a linear list
- The current position is a pointer into the tree
- Undo moves to the parent node
- Redo moves to the most-recently-visited child (default branch)
- When a new action is taken at a non-leaf node, a new child branch is created rather than truncating
- The history panel renders the tree (or a linearised current-branch view), with branching points indicated
- Users can click a node in any branch to switch to it (time-travel)

## Scope Considerations

- **Data model**: replace `undoStack`/`redoStack` flat arrays and `history: string[]` with a tree structure. Each node holds a snapshot string and a label.
- **Serialization**: history tree is session-only (not persisted to `.vgoblin` project files) — same as current behaviour.
- **UI**: history panel needs a tree view or branch picker. This is non-trivial UI work.
- **Memory**: a full tree can grow large quickly. Needs a max-node cap and possibly branch pruning for old/unvisited branches.
- **Conflict with current model**: the current `historyIndex` cursor approach is a clean foundation — the cursor concept extends naturally to a tree pointer.

## Non-Goals (for this epic)

- Persistence of history tree across sessions
- Collaborative / shared history
- Named bookmarks or "stash" (separate epic if needed)

## Acceptance Criteria (when implemented)

- Taking a new action after undoing creates a new branch; the undone entries are not discarded
- The history panel shows branching points and allows navigation between branches
- Memory stays bounded; old/unvisited branches are pruned after a configurable depth
- All existing undo/redo keyboard shortcuts continue to work as before on the default branch
- No regression to current snapshot/restore, zoom-exclusion, or history rendering behaviour

## Related

- History model refactor (shipped): `historyIndex` cursor, greyed-out undone entries, zoom excluded from snapshot restore — provides the foundation for this epic
- `backlog/epic-f510-long-term-editing-platform.md` — long-term differentiator context
