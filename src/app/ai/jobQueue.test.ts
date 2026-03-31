import { describe, expect, it } from "vitest";
import type { AiValidationResult } from "./runtime";
import { createAiJobQueue } from "./jobQueue";
import type { AiPlatformRuntime } from "./runtime";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AI job queue", () => {
  it("retries failed jobs as new queue entries", async () => {
    let attempts = 0;
    const executeTask: AiPlatformRuntime["executeTask"] = async (request) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          attemptedProviderIds: ["openai-compatible"],
          primaryProviderId: "openai-compatible",
          fallbackProviderIds: [],
          fallbackUsed: false,
          degradedMode: false,
          response: {
            ok: false,
            providerId: "openai-compatible",
            family: request.task.family,
            taskId: request.task.id,
            error: {
              code: "provider_error",
              message: "temporary failure",
              retryable: true,
            },
            warnings: [],
          },
        };
      }

      return {
        ok: true,
        attemptedProviderIds: ["openai-compatible"],
        primaryProviderId: "openai-compatible",
        fallbackProviderIds: [],
        fallbackUsed: false,
        degradedMode: false,
        estimatedCostMessage: "Estimated cost: $0.0000.",
        response: {
          ok: true,
          providerId: "openai-compatible",
          family: request.task.family,
          taskId: request.task.id,
          artifacts: [],
          warnings: [],
          usage: { estimatedCostUsd: 0 },
        },
      };
    };

    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({
        ok: true,
        providerId: "openai-compatible",
        providerName: "Local stub",
        message: "ok",
        checkedAt: new Date().toISOString(),
      }),
      executeTask,
    };

    const queue = createAiJobQueue(runtime);
    const original = queue.enqueueTask({ task: { id: "job-1", family: "generation", prompt: "goblin" } }, "Run generation");
    await flushPromises();

    expect(queue.listJobs()[0]?.status).toBe("failed");

    const retried = queue.retryJob(original.id);
    expect(retried).not.toBeNull();
    await flushPromises();

    const jobs = queue.listJobs();
    expect(jobs[0]?.status).toBe("completed");
    expect(jobs[1]?.status).toBe("retried");
  });

  it("cancels running validation jobs with AbortController", async () => {
    const validateProvider: AiPlatformRuntime["validateProvider"] = (providerId, signal) => new Promise<AiValidationResult>((resolve) => {
      signal?.addEventListener("abort", () => {
        resolve({
          ok: false,
          providerId,
          providerName: "OpenAI compatible",
          message: "aborted",
          checkedAt: new Date().toISOString(),
        });
      });
    });

    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      executeTask: async () => {
        throw new Error("not used in validation test");
      },
      validateProvider,
    };

    const queue = createAiJobQueue(runtime);
    const job = queue.enqueueValidation("openai-compatible", "Validate remote provider");
    await flushPromises();

    expect(queue.listJobs()[0]?.status).toBe("running");

    expect(queue.cancelJob(job.id)).toBe(true);
    await flushPromises();

    expect(queue.listJobs()[0]?.status).toBe("cancelled");
    expect(queue.listJobs()[0]?.canRetry).toBe(true);
  });
});
