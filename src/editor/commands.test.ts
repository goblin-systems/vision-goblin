import { describe, expect, it, vi } from "vitest";
import {
  registerCommand,
  registerCommands,
  executeCommand,
  getCommand,
  isCommandEnabled,
  getAllCommands,
  getCommandsByCategory,
  matchesShortcut,
  dispatchKeyboardEvent,
  detectShortcutConflicts,
  type CommandDefinition,
} from "./commands";

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: overrides.id ?? "test-cmd",
    label: overrides.label ?? "Test",
    category: overrides.category ?? "edit",
    enabled: overrides.enabled ?? (() => true),
    execute: overrides.execute ?? vi.fn(),
    shortcut: overrides.shortcut,
  };
}

describe("command registry", () => {
  it("registers and retrieves a command", () => {
    registerCommand(makeCommand({ id: "reg-test" }));
    expect(getCommand("reg-test")).toBeDefined();
    expect(getCommand("reg-test")!.id).toBe("reg-test");
  });

  it("executes an enabled command", () => {
    const execute = vi.fn();
    registerCommand(makeCommand({ id: "exec-test", execute }));
    const result = executeCommand("exec-test");
    expect(result).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not execute a disabled command", () => {
    const execute = vi.fn();
    registerCommand(makeCommand({ id: "disabled-test", enabled: () => false, execute }));
    const result = executeCommand("disabled-test");
    expect(result).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns false for unknown command id", () => {
    expect(executeCommand("nonexistent")).toBe(false);
  });

  it("isCommandEnabled reflects enabled state", () => {
    registerCommand(makeCommand({ id: "enabled-check", enabled: () => true }));
    registerCommand(makeCommand({ id: "disabled-check", enabled: () => false }));
    expect(isCommandEnabled("enabled-check")).toBe(true);
    expect(isCommandEnabled("disabled-check")).toBe(false);
    expect(isCommandEnabled("nonexistent")).toBe(false);
  });

  it("registerCommands registers multiple at once", () => {
    registerCommands([
      makeCommand({ id: "bulk-1" }),
      makeCommand({ id: "bulk-2" }),
    ]);
    expect(getCommand("bulk-1")).toBeDefined();
    expect(getCommand("bulk-2")).toBeDefined();
  });

  it("filters by category", () => {
    registerCommand(makeCommand({ id: "file-cmd", category: "file" }));
    registerCommand(makeCommand({ id: "edit-cmd", category: "edit" }));
    const fileCmds = getCommandsByCategory("file");
    expect(fileCmds.some((c) => c.id === "file-cmd")).toBe(true);
  });
});

describe("matchesShortcut", () => {
  function fakeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return { key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides } as KeyboardEvent;
  }

  it("matches Ctrl+S", () => {
    expect(matchesShortcut(fakeEvent({ ctrlKey: true, key: "s" }), "Ctrl+S")).toBe(true);
  });

  it("does not match without ctrl", () => {
    expect(matchesShortcut(fakeEvent({ key: "s" }), "Ctrl+S")).toBe(false);
  });

  it("matches Ctrl+Shift+S", () => {
    expect(matchesShortcut(fakeEvent({ ctrlKey: true, shiftKey: true, key: "s" }), "Ctrl+Shift+S")).toBe(true);
  });

  it("does not match Ctrl+S when shift is also pressed", () => {
    expect(matchesShortcut(fakeEvent({ ctrlKey: true, shiftKey: true, key: "s" }), "Ctrl+S")).toBe(false);
  });
});

describe("dispatchKeyboardEvent", () => {
  it("dispatches to command matching shortcut", () => {
    const execute = vi.fn();
    registerCommand(makeCommand({ id: "dispatch-test", shortcut: "Ctrl+Q", execute }));
    const event = { key: "q", code: "KeyQ", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    const dispatched = dispatchKeyboardEvent(event);
    expect(dispatched).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("detectShortcutConflicts", () => {
  it("detects duplicate shortcuts", () => {
    registerCommand(makeCommand({ id: "conflict-a", shortcut: "Ctrl+X" }));
    registerCommand(makeCommand({ id: "conflict-b", shortcut: "Ctrl+X" }));
    const conflicts = detectShortcutConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain("conflict-a");
    expect(conflicts[0]).toContain("conflict-b");
  });
});
