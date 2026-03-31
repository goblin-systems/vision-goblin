/**
 * Central command registry — all editor actions flow through here.
 * Menus, keyboard shortcuts, buttons, and future command palette
 * all invoke the same command by id.
 */

export interface CommandDefinition {
  id: string;
  label: string;
  shortcut?: string;
  category: "file" | "edit" | "canvas" | "select" | "adjust" | "layer" | "window" | "tool" | "ai";
  enabled: () => boolean;
  execute: () => void | Promise<void>;
}

const registry = new Map<string, CommandDefinition>();

export function registerCommand(command: CommandDefinition) {
  registry.set(command.id, command);
}

export function registerCommands(commands: CommandDefinition[]) {
  for (const command of commands) {
    registry.set(command.id, command);
  }
}

export function executeCommand(id: string): boolean {
  const command = registry.get(id);
  if (!command) return false;
  if (!command.enabled()) return false;
  void command.execute();
  return true;
}

export function getCommand(id: string): CommandDefinition | undefined {
  return registry.get(id);
}

export function isCommandEnabled(id: string): boolean {
  const command = registry.get(id);
  return command ? command.enabled() : false;
}

export function getAllCommands(): CommandDefinition[] {
  return Array.from(registry.values());
}

export function getCommandsByCategory(category: CommandDefinition["category"]): CommandDefinition[] {
  return getAllCommands().filter((c) => c.category === category);
}

/**
 * Match a KeyboardEvent against a shortcut string like "Ctrl+Shift+S".
 * Returns true if the event matches the shortcut.
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop()!;
  const needsCtrl = parts.includes("ctrl") || parts.includes("commandorcontrol");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");

  const ctrlOk = needsCtrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
  const shiftOk = needsShift ? event.shiftKey : !event.shiftKey;
  const altOk = needsAlt ? event.altKey : !event.altKey;

  const eventKey = event.key.toLowerCase();
  const keyOk = eventKey === key || event.code.toLowerCase() === key;

  return ctrlOk && shiftOk && altOk && keyOk;
}

/**
 * Dispatch a keyboard event through all registered commands.
 * Returns true if a command was executed.
 */
export function dispatchKeyboardEvent(event: KeyboardEvent): boolean {
  for (const command of registry.values()) {
    if (!command.shortcut) continue;
    if (matchesShortcut(event, command.shortcut) && command.enabled()) {
      event.preventDefault();
      void command.execute();
      return true;
    }
  }
  return false;
}

/**
 * Checks whether any registered commands have conflicting shortcuts.
 * Returns an array of conflict descriptions (empty = no conflicts).
 */
export function updateCommandShortcut(id: string, shortcut: string | undefined) {
  const command = registry.get(id);
  if (command) command.shortcut = shortcut;
}

export function applyKeybindings(keybindings: Record<string, string>) {
  for (const [id, shortcut] of Object.entries(keybindings)) {
    updateCommandShortcut(id, shortcut || undefined);
  }
}

export function detectShortcutConflicts(): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const command of registry.values()) {
    if (!command.shortcut) continue;
    const normalized = command.shortcut.toLowerCase();
    const existing = seen.get(normalized);
    if (existing) {
      conflicts.push(`"${normalized}" is bound to both "${existing}" and "${command.id}"`);
    } else {
      seen.set(normalized, command.id);
    }
  }
  return conflicts;
}
