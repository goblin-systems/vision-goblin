import type { AiArtifact, AiTask, AiTaskFamily } from "./types";

export type AiLogLevel = "INFO" | "WARN" | "ERROR";

export type AiDebugLogger = (message: string, level?: AiLogLevel) => void;

export type AiErrorCode =
  | "provider_not_found"
  | "unsupported_task"
  | "transport_error"
  | "provider_error"
  | "invalid_response"
  | "unknown_error";

export interface AiTaskUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface AiTaskError {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
  providerCode?: string;
  details?: unknown;
}

export interface AiProviderRequest<TTask extends AiTask = AiTask> {
  task: TTask;
  providerId?: string;
  preferredModel?: string;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
}

export interface AiTaskSuccess<TTask extends AiTask = AiTask> {
  ok: true;
  providerId: string;
  family: TTask["family"];
  taskId: string;
  providerTaskId?: string;
  model?: string;
  artifacts: AiArtifact[];
  warnings: string[];
  usage?: AiTaskUsage;
}

export interface AiTaskFailure<TTask extends AiTask = AiTask> {
  ok: false;
  providerId: string;
  family: TTask["family"];
  taskId: string;
  providerTaskId?: string;
  error: AiTaskError;
  warnings: string[];
}

export type AiProviderResponse<TTask extends AiTask = AiTask> = AiTaskSuccess<TTask> | AiTaskFailure<TTask>;

export interface AiProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportedFamilies: readonly AiTaskFamily[];
  execute<TTask extends AiTask>(request: AiProviderRequest<TTask>): Promise<AiProviderResponse<TTask>>;
}

export function createAiSuccessResponse<TTask extends AiTask>(
  request: AiProviderRequest<TTask>,
  response: Omit<AiTaskSuccess<TTask>, "ok" | "providerId" | "family" | "taskId" | "warnings"> & { providerId: string; warnings?: string[] },
): AiTaskSuccess<TTask> {
  return {
    ok: true,
    providerId: response.providerId,
    family: request.task.family,
    taskId: request.task.id,
    providerTaskId: response.providerTaskId,
    model: response.model,
    artifacts: response.artifacts,
    warnings: response.warnings ?? [],
    usage: response.usage,
  };
}

export function createAiFailureResponse<TTask extends AiTask>(
  request: AiProviderRequest<TTask>,
  response: {
    providerId: string;
    providerTaskId?: string;
    error: AiTaskError;
    warnings?: string[];
  },
): AiTaskFailure<TTask> {
  return {
    ok: false,
    providerId: response.providerId,
    family: request.task.family,
    taskId: request.task.id,
    providerTaskId: response.providerTaskId,
    error: response.error,
    warnings: response.warnings ?? [],
  };
}

export function normalizeAiTaskError(
  error: unknown,
  defaults?: Partial<AiTaskError>,
): AiTaskError {
  if (isAiTaskError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      providerCode: error.providerCode,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: defaults?.code ?? "transport_error",
      message: error.message,
      retryable: defaults?.retryable ?? true,
      providerCode: defaults?.providerCode,
      details: defaults?.details,
    };
  }

  return {
    code: defaults?.code ?? "unknown_error",
    message: defaults?.message ?? "Unknown AI provider error.",
    retryable: defaults?.retryable ?? false,
    providerCode: defaults?.providerCode,
    details: error ?? defaults?.details,
  };
}

function isAiTaskError(value: unknown): value is AiTaskError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AiTaskError>;
  return typeof candidate.code === "string" && typeof candidate.message === "string" && typeof candidate.retryable === "boolean";
}
