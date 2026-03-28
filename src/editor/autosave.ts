/**
 * Autosave and crash recovery.
 *
 * Periodically serializes dirty documents into a Tauri store.
 * On next launch, if recovery entries exist, the caller can
 * offer a restore-or-discard UI per document.
 */

import { load, type Store } from "@tauri-apps/plugin-store";
import type { SerializedDocument } from "./types";

export interface RecoveryEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  layerCount: number;
  savedAt: number;
  data: SerializedDocument;
}

const STORE_KEY = "recovery_entries";
const STORE_FILE = "autosave.json";

let store: Store | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return store;
}

/**
 * Read all pending recovery entries from disk.
 */
export async function loadRecoveryEntries(): Promise<RecoveryEntry[]> {
  const s = await getStore();
  const raw = await s.get<RecoveryEntry[]>(STORE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is RecoveryEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.savedAt === "number" &&
      entry.data !== undefined
  );
}

/**
 * Write recovery entries to disk.
 */
export async function saveRecoveryEntries(entries: RecoveryEntry[]): Promise<void> {
  const s = await getStore();
  await s.set(STORE_KEY, entries);
  await s.save();
}

/**
 * Clear all recovery entries (e.g. on clean shutdown).
 */
export async function clearRecoveryEntries(): Promise<void> {
  await saveRecoveryEntries([]);
}

/**
 * Remove a single recovery entry by document id.
 */
export async function discardRecoveryEntry(documentId: string): Promise<void> {
  const entries = await loadRecoveryEntries();
  await saveRecoveryEntries(entries.filter((e) => e.id !== documentId));
}

export interface AutosaveTarget {
  id: string;
  name: string;
  width: number;
  height: number;
  dirty: boolean;
  layerCount: number;
  serialize: () => SerializedDocument;
}

/**
 * Snapshot all dirty documents into recovery entries.
 */
export async function autosaveDocuments(targets: AutosaveTarget[]): Promise<number> {
  const dirty = targets.filter((t) => t.dirty);
  if (dirty.length === 0) return 0;

  const existing = await loadRecoveryEntries();
  const map = new Map(existing.map((e) => [e.id, e]));

  for (const target of dirty) {
    map.set(target.id, {
      id: target.id,
      name: target.name,
      width: target.width,
      height: target.height,
      layerCount: target.layerCount,
      savedAt: Date.now(),
      data: target.serialize(),
    });
  }

  await saveRecoveryEntries(Array.from(map.values()));
  return dirty.length;
}

/**
 * Start the autosave timer. Calls `onTick` periodically (default 60 s).
 */
export function startAutosaveTimer(
  onTick: () => void | Promise<void>,
  intervalMs = 60_000
): void {
  stopAutosaveTimer();
  intervalId = setInterval(() => void onTick(), intervalMs);
}

/**
 * Stop the autosave timer.
 */
export function stopAutosaveTimer(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
