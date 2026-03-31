import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoblinActivityTracker } from "./activityTracker";

describe("goblin activity tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not emit ambient commentary after the user goes idle", () => {
    const onCommentaryEligible = vi.fn();
    const tracker = createGoblinActivityTracker({
      minDelayMs: 20_000,
      maxDelayMs: 20_000,
      cooldownMs: 15_000,
      idleThresholdMs: 8_000,
      random: () => 0,
      onCommentaryEligible,
    });

    tracker.recordActivity();
    vi.advanceTimersByTime(20_000);

    expect(onCommentaryEligible).not.toHaveBeenCalled();
    tracker.destroy();
  });

  it("emits ambient commentary while activity stays recent", () => {
    const onCommentaryEligible = vi.fn();
    const tracker = createGoblinActivityTracker({
      minDelayMs: 20_000,
      maxDelayMs: 20_000,
      cooldownMs: 15_000,
      idleThresholdMs: 8_000,
      random: () => 0,
      onCommentaryEligible,
    });

    tracker.recordActivity();
    vi.advanceTimersByTime(5_000);
    tracker.recordActivity();
    vi.advanceTimersByTime(5_000);
    tracker.recordActivity();
    vi.advanceTimersByTime(5_000);
    tracker.recordActivity();
    vi.advanceTimersByTime(5_000);

    expect(onCommentaryEligible).toHaveBeenCalledOnce();
    tracker.destroy();
  });
});
