import type { DocumentState } from "../editor/types";
import type { AutosaveTarget, RecoveryEntry } from "../editor/autosave";
import { deserializeDocument, serializeDocument } from "../editor/documents";

export interface RecoveryPromptCopy {
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
}

export interface RecoveryRestoreResult {
  restored: DocumentState[];
  failed: Array<{ entry: RecoveryEntry; error: unknown }>;
}

export function trimRecentItems(items: string[], nextPath: string, limit = 8) {
  return [nextPath, ...items.filter((item) => item !== nextPath)].slice(0, limit);
}

export function buildAutosaveTargets(documents: DocumentState[]): AutosaveTarget[] {
  return documents.map((doc) => ({
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dirty: doc.dirty,
    layerCount: doc.layers.length,
    serialize: () => serializeDocument(doc),
  }));
}

export function getRecoveryPromptCopy(count: number): RecoveryPromptCopy {
  return {
    title: "Recover unsaved work?",
    message: `${count} unsaved document${count === 1 ? " was" : "s were"} found from a previous session. Would you like to restore ${count === 1 ? "it" : "them"}?`,
    acceptLabel: "Restore all",
    rejectLabel: "Discard",
  };
}

export async function restoreRecoveryDocuments(entries: RecoveryEntry[]): Promise<RecoveryRestoreResult> {
  const restored: DocumentState[] = [];
  const failed: Array<{ entry: RecoveryEntry; error: unknown }> = [];

  for (const entry of entries) {
    try {
      const doc = await deserializeDocument(entry.data, null, true);
      doc.name = entry.name;
      restored.push(doc);
    } catch (error) {
      failed.push({ entry, error });
    }
  }

  return { restored, failed };
}
