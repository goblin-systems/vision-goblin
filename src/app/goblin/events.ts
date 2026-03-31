export interface RollingWindowResult {
  timestamps: number[];
  matched: boolean;
}

export function recordRollingWindowEvent(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
  threshold: number,
): RollingWindowResult {
  const next = timestamps.filter((timestamp) => now - timestamp <= windowMs);
  next.push(now);

  return {
    timestamps: next,
    matched: next.length >= threshold,
  };
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}
