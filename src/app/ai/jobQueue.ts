import { normalizeAiTaskError, type AiTaskError } from "./contracts";
import type { AiProviderId } from "./config";
import type { AiPlatformRuntime, AiRuntimeTaskRequest, AiTaskExecutionOutcome, AiValidationResult } from "./runtime";
import type { AiTask } from "./types";

export type AiJobStatus = "pending" | "running" | "failed" | "retried" | "completed" | "cancelled";

export interface AiJobRecord {
  id: string;
  title: string;
  kind: "task" | "validation";
  status: AiJobStatus;
  createdAt: string;
  updatedAt: string;
  providerId?: AiProviderId;
  attemptedProviderIds: AiProviderId[];
  family?: AiTask["family"];
  attemptCount: number;
  retryOfJobId?: string;
  canRetry: boolean;
  canCancel: boolean;
  message: string;
  degradedMessage?: string;
  estimatedCostMessage?: string;
  validationResult?: AiValidationResult;
  taskResult?: AiTaskExecutionOutcome;
  error?: AiTaskError;
}

type JobPayload =
  | { kind: "task"; request: AiRuntimeTaskRequest; title: string }
  | { kind: "validation"; providerId: AiProviderId; title: string };

export interface AiJobQueue {
  subscribe(listener: () => void): () => void;
  listJobs(): AiJobRecord[];
  enqueueTask<TTask extends AiTask>(request: AiRuntimeTaskRequest<TTask>, title: string): AiJobRecord;
  enqueueValidation(providerId: AiProviderId, title?: string): AiJobRecord;
  retryJob(jobId: string): AiJobRecord | null;
  cancelJob(jobId: string): boolean;
}

export function createAiJobQueue(runtime: AiPlatformRuntime): AiJobQueue {
  const jobs: AiJobRecord[] = [];
  const payloads = new Map<string, JobPayload>();
  const abortControllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let processing = false;
  let counter = 0;

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function createJob(payload: JobPayload, retryOfJobId?: string, attemptCount = 1): AiJobRecord {
    counter += 1;
    const timestamp = new Date().toISOString();
    const job: AiJobRecord = {
      id: `ai-job-${counter}`,
      title: payload.title,
      kind: payload.kind,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      providerId: payload.kind === "validation" ? payload.providerId : undefined,
      attemptedProviderIds: [],
      family: payload.kind === "task" ? payload.request.task.family : undefined,
      attemptCount,
      retryOfJobId,
      canRetry: false,
      canCancel: true,
      message: payload.kind === "validation" ? "Queued provider validation." : "Queued AI task.",
    };

    jobs.unshift(job);
    payloads.set(job.id, payload);
    emit();
    void processNext();
    return job;
  }

  async function processNext() {
    if (processing) {
      return;
    }
    const nextJob = jobs.find((job) => job.status === "pending");
    if (!nextJob) {
      return;
    }

    processing = true;
    const payload = payloads.get(nextJob.id);
    if (!payload) {
      processing = false;
      return;
    }

    const abortController = new AbortController();
    abortControllers.set(nextJob.id, abortController);
    updateJob(nextJob.id, {
      status: "running",
      updatedAt: new Date().toISOString(),
      canCancel: true,
      canRetry: false,
      message: payload.kind === "validation" ? "Validating provider connection..." : "Running AI task...",
    });

    try {
      if (payload.kind === "validation") {
        const result = await runtime.validateProvider(payload.providerId, abortController.signal);
        if (abortController.signal.aborted) {
          updateJob(nextJob.id, {
            status: "cancelled",
            updatedAt: new Date().toISOString(),
            canCancel: false,
            canRetry: true,
            message: "Validation cancelled.",
          });
        } else {
          updateJob(nextJob.id, {
            status: result.ok ? "completed" : "failed",
            updatedAt: new Date().toISOString(),
            canCancel: false,
            canRetry: !result.ok,
            validationResult: result,
            message: result.message,
            providerId: result.providerId,
          });
        }
      } else {
        const result = await runtime.executeTask({
          ...payload.request,
          signal: abortController.signal,
        });
        if (abortController.signal.aborted) {
          updateJob(nextJob.id, {
            status: "cancelled",
            updatedAt: new Date().toISOString(),
            canCancel: false,
            canRetry: true,
            attemptedProviderIds: result.attemptedProviderIds,
            message: "AI job cancelled.",
          });
        } else if (result.ok) {
          updateJob(nextJob.id, {
            status: "completed",
            updatedAt: new Date().toISOString(),
            canCancel: false,
            canRetry: false,
            taskResult: result,
            attemptedProviderIds: result.attemptedProviderIds,
            message: result.degradedMessage ?? "AI job completed.",
            degradedMessage: result.degradedMessage,
            estimatedCostMessage: result.estimatedCostMessage,
          });
        } else {
          updateJob(nextJob.id, {
            status: "failed",
            updatedAt: new Date().toISOString(),
            canCancel: false,
            canRetry: result.response.error.retryable,
            taskResult: result,
            attemptedProviderIds: result.attemptedProviderIds,
            error: result.response.error,
            message: result.response.error.message,
          });
        }
      }
    } catch (error) {
      const normalized = normalizeAiTaskError(error, {
        code: "unknown_error",
        retryable: true,
      });
      updateJob(nextJob.id, {
        status: abortController.signal.aborted ? "cancelled" : "failed",
        updatedAt: new Date().toISOString(),
        canCancel: false,
        canRetry: true,
        error: normalized,
        message: abortController.signal.aborted ? "AI job cancelled." : normalized.message,
      });
    } finally {
      abortControllers.delete(nextJob.id);
      processing = false;
      emit();
      void processNext();
    }
  }

  function updateJob(jobId: string, patch: Partial<AiJobRecord>) {
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      return;
    }
    Object.assign(job, patch);
    emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listJobs() {
      return jobs.map((job) => ({ ...job, attemptedProviderIds: [...job.attemptedProviderIds] }));
    },
    enqueueTask(request, title) {
      return createJob({ kind: "task", request, title });
    },
    enqueueValidation(providerId, title = `Validate ${providerId}`) {
      return createJob({ kind: "validation", providerId, title });
    },
    retryJob(jobId) {
      const job = jobs.find((candidate) => candidate.id === jobId);
      const payload = payloads.get(jobId);
      if (!job || !payload || (job.status !== "failed" && job.status !== "cancelled")) {
        return null;
      }
      updateJob(jobId, {
        status: "retried",
        updatedAt: new Date().toISOString(),
        canRetry: false,
        canCancel: false,
        message: "Superseded by retry.",
      });
      return createJob(payload, jobId, job.attemptCount + 1);
    },
    cancelJob(jobId) {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) {
        return false;
      }

      if (job.status === "pending") {
        updateJob(jobId, {
          status: "cancelled",
          updatedAt: new Date().toISOString(),
          canCancel: false,
          canRetry: true,
          message: "AI job cancelled before execution.",
        });
        return true;
      }

      if (job.status !== "running") {
        return false;
      }

      abortControllers.get(jobId)?.abort();
      return true;
    },
  };
}
