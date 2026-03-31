export interface GoblinActivityTracker {
  recordActivity: () => void;
  destroy: () => void;
}

export interface GoblinActivityTrackerOptions {
  minDelayMs: number;
  maxDelayMs: number;
  cooldownMs: number;
  idleThresholdMs: number;
  onCommentaryEligible: () => void;
  now?: () => number;
  random?: () => number;
  setTimeoutFn?: (handler: () => void, timeout?: number) => number;
  clearTimeoutFn?: (timerId: number) => void;
}

export function createGoblinActivityTracker(options: GoblinActivityTrackerOptions): GoblinActivityTracker {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => window.setTimeout(handler, timeout));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((timerId) => window.clearTimeout(timerId));

  let lastActivityAt = Number.NEGATIVE_INFINITY;
  let lastCommentaryAt = Number.NEGATIVE_INFINITY;
  let timerId: number | null = null;

  function clearScheduledTimer() {
    if (timerId === null) {
      return;
    }

    clearTimeoutFn(timerId);
    timerId = null;
  }

  function getRandomDelay() {
    const range = options.maxDelayMs - options.minDelayMs;
    return options.minDelayMs + Math.round(random() * range);
  }

  function scheduleNext() {
    clearScheduledTimer();
    timerId = setTimeoutFn(() => {
      timerId = null;

      const nowAtFire = now();
      const isActive = nowAtFire - lastActivityAt <= options.idleThresholdMs;
      const cooledDown = nowAtFire - lastCommentaryAt >= options.cooldownMs;

      if (!isActive) {
        return;
      }

      if (!cooledDown) {
        scheduleNext();
        return;
      }

      lastCommentaryAt = nowAtFire;
      options.onCommentaryEligible();
      scheduleNext();
    }, getRandomDelay());
  }

  return {
    recordActivity: () => {
      lastActivityAt = now();
      if (timerId === null) {
        scheduleNext();
      }
    },
    destroy: () => {
      clearScheduledTimer();
    },
  };
}
