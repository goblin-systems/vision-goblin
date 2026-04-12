import type { DocumentState } from "./types";
import { estimateSnapshotBytes, getLargeImagePolicy } from "./largeImagePolicy";

let activeOperationSnapshot: string | null = null;
let activeOperationChanged = false;

function trimSnapshotStack(stack: string[], byteBudget: number, entryLimit: number) {
  while (stack.length > entryLimit) {
    stack.shift();
  }

  let totalBytes = stack.reduce((sum, snapshot) => sum + estimateSnapshotBytes(snapshot), 0);
  while (stack.length > 1 && totalBytes > byteBudget) {
    const removed = stack.shift();
    if (!removed) break;
    totalBytes -= estimateSnapshotBytes(removed);
  }
}

export function enforceHistoryBudget(doc: DocumentState) {
  const { history } = getLargeImagePolicy(doc);
  trimSnapshotStack(doc.undoStack, history.byteBudget, history.entryLimit);
  trimSnapshotStack(doc.redoStack, history.byteBudget, history.entryLimit);
}

export function pushHistory(doc: DocumentState, entry: string) {
  if (doc.historyIndex > 0) {
    // discard undone future entries before adding new action
    doc.history = doc.history.slice(doc.historyIndex);
    doc.historyIndex = 0;
  }
  doc.history = [entry, ...doc.history].slice(0, 20);
  enforceHistoryBudget(doc);
  doc.dirty = true;
}

export function beginDocumentOperation(snapshot: string) {
  activeOperationSnapshot = snapshot;
  activeOperationChanged = false;
}

export function markDocumentOperationChanged() {
  activeOperationChanged = true;
}

export function commitDocumentOperation(doc: DocumentState, entry: string) {
  if (!activeOperationSnapshot || !activeOperationChanged) {
    activeOperationSnapshot = null;
    activeOperationChanged = false;
    return;
  }

  doc.undoStack.push(activeOperationSnapshot);
  doc.redoStack = [];
  pushHistory(doc, entry);
  activeOperationSnapshot = null;
  activeOperationChanged = false;
}

export function cancelDocumentOperation() {
  activeOperationSnapshot = null;
  activeOperationChanged = false;
}
