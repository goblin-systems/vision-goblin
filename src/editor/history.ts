import type { DocumentState } from "./types";

let activeOperationSnapshot: string | null = null;
let activeOperationChanged = false;

export function pushHistory(doc: DocumentState, entry: string) {
  doc.history = [entry, ...doc.history].slice(0, 20);
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
  if (doc.undoStack.length > 40) {
    doc.undoStack.shift();
  }
  doc.redoStack = [];
  pushHistory(doc, entry);
  activeOperationSnapshot = null;
  activeOperationChanged = false;
}

export function cancelDocumentOperation() {
  activeOperationSnapshot = null;
  activeOperationChanged = false;
}
