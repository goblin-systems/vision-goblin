import { invoke } from "@tauri-apps/api/core";

let debugEnabled = false;
let debugLogPath = "Debug logs are disabled.";

export async function configureDebugLogging(enabled: boolean): Promise<void> {
  debugEnabled = enabled;
  try {
    const path = await invoke<string>("set_debug_logging_enabled", { enabled });
    debugLogPath = enabled ? path : "Debug logs are disabled.";
  } catch (err) {
    console.error("Failed to configure debug logging:", err);
    debugLogPath = "Could not configure debug logging.";
  }
}

export function isDebugLoggingEnabled(): boolean {
  return debugEnabled;
}

export function getDebugLogPath(): string {
  return debugLogPath;
}

export function debugLog(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO") {
  const text = `[${level}] ${message}`;
  if (level === "ERROR") {
    console.error(text);
  } else if (level === "WARN") {
    console.warn(text);
  } else {
    console.log(text);
  }

  if (!debugEnabled) return;

  invoke("write_debug_log", { level, message }).catch((err) => {
    console.error("Failed to write debug log:", err);
  });
}

export async function openDebugLogFolder(): Promise<void> {
  await invoke("open_debug_log_folder");
}
