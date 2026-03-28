import { buildStarterDocuments } from "../editor/documents";
import type { DocumentState, Layer } from "../editor/types";

export interface DocumentSession {
  documents: DocumentState[];
  readonly activeDocumentId: string;
  getDocument(documentId: string): DocumentState | null;
  getActiveDocument(): DocumentState | null;
  getActiveLayer(doc: DocumentState): Layer | null;
  setActiveDocument(doc: DocumentState): boolean;
  activateDocument(documentId: string): boolean;
  resetToStarterDocuments(defaultZoom: number): DocumentState[];
  removeDocument(documentId: string): { document: DocumentState; index: number } | null;
}

export function createDocumentSession(): DocumentSession {
  const documents: DocumentState[] = [];
  let activeDocumentId = "";

  return {
    documents,
    get activeDocumentId() {
      return activeDocumentId;
    },
    getDocument(documentId) {
      return documents.find((doc) => doc.id === documentId) ?? null;
    },
    getActiveDocument() {
      return documents.find((doc) => doc.id === activeDocumentId) ?? null;
    },
    getActiveLayer(doc) {
      return doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? doc.layers[0] ?? null;
    },
    setActiveDocument(doc) {
      const exists = documents.some((item) => item.id === doc.id);
      if (!exists) {
        documents.push(doc);
      }
      activeDocumentId = doc.id;
      return !exists;
    },
    activateDocument(documentId) {
      if (!documents.some((doc) => doc.id === documentId)) {
        return false;
      }
      activeDocumentId = documentId;
      return true;
    },
    resetToStarterDocuments(defaultZoom) {
      documents.splice(0, documents.length, ...buildStarterDocuments(defaultZoom));
      activeDocumentId = documents[0]?.id ?? "";
      return documents;
    },
    removeDocument(documentId) {
      const index = documents.findIndex((doc) => doc.id === documentId);
      if (index < 0) {
        return null;
      }
      const [document] = documents.splice(index, 1);
      if (activeDocumentId === documentId) {
        activeDocumentId = documents[Math.max(0, index - 1)]?.id ?? "";
      }
      return { document, index };
    },
  };
}
