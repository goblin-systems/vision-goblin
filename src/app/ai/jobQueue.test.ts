import { describe, expect, it } from "vitest";
import type { AiValidationResult } from "./runtime";
import { createAiJobQueue } from "./jobQueue";
import type { AiPlatformRuntime } from "./runtime";
import { buildInpaintingPromptContract } from "./prompts/provider";

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
          model: "gpt-4.1-mini",
          family: request.task.family,
          taskId: request.task.id,
          artifacts: [],
          warnings: [],
          usage: { estimatedCostUsd: 0 },
          inspection: {
            request: { prompt: "goblin", assets: [] },
            response: { rawPayload: { ok: true } },
          },
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
    expect(jobs[0]?.inspection?.task.family).toBe("generation");
    expect(jobs[0]?.inspection?.providerId).toBe("openai-compatible");
    expect(jobs[0]?.inspection?.model).toBe("gpt-4.1-mini");
    expect(jobs[0]?.inspection?.response?.rawPayload).toEqual({ ok: true });
  });

  it("retains inspectable request data on task failure", async () => {
    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({ ok: true, providerId: "openai-compatible", providerName: "stub", message: "ok", checkedAt: new Date().toISOString() }),
      executeTask: async () => ({
        ok: false,
        attemptedProviderIds: ["openai-compatible"],
        primaryProviderId: "openai-compatible",
        fallbackProviderIds: [],
        fallbackUsed: false,
        degradedMode: false,
        response: {
          ok: false,
          providerId: "openai-compatible",
          family: "captioning",
          taskId: "job-2",
          error: { code: "provider_error", message: "failed", retryable: true },
          warnings: [],
          inspection: {
            request: { prompt: "describe image", assets: [{ kind: "image", label: "input image", mimeType: "image/png", data: "data:image/png;base64,AAAA" }] },
            response: { rawPayload: { error: true } },
          },
        },
      }),
    };

    const queue = createAiJobQueue(runtime);
    queue.enqueueTask({
      task: { id: "job-2", family: "captioning", prompt: "describe image", input: { image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA" } } },
      inspection: { request: { prompt: "describe image", assets: [] } },
    }, "Caption image");
    await flushPromises();

    const job = queue.listJobs()[0];
    expect(job?.status).toBe("failed");
    expect(job?.inspection?.request?.prompt).toBe("describe image");
    expect(job?.inspection?.response?.rawPayload).toEqual({ error: true });
  });

  it("derives sent assets from the task when runtime inspection omits them", async () => {
    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({ ok: true, providerId: "openai-compatible", providerName: "stub", message: "ok", checkedAt: new Date().toISOString() }),
      executeTask: async () => ({
        ok: true,
        attemptedProviderIds: ["gemini"],
        primaryProviderId: "gemini",
        fallbackProviderIds: [],
        fallbackUsed: false,
        degradedMode: false,
        response: {
          ok: true,
          providerId: "gemini",
          family: "inpainting",
          taskId: "job-3",
          model: "gemini-2.5-flash-image",
          artifacts: [],
          warnings: [],
          inspection: {
            response: { rawPayload: { ok: true } },
          },
        },
      }),
    };

    const queue = createAiJobQueue(runtime);
    queue.enqueueTask({
      task: {
        id: "job-3",
        family: "inpainting",
        prompt: "Replace the sign",
        input: {
          image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 },
          mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,BBBB", width: 10, height: 10 },
        },
      },
    }, "Inpaint image");
    await flushPromises();

    const job = queue.listJobs()[0];
    expect(job?.status).toBe("completed");
    expect(job?.inspection?.providerId).toBe("gemini");
    expect(job?.inspection?.model).toBe("gemini-2.5-flash-image");
    expect(job?.inspection?.request?.prompt).toContain("Replace the sign");
    expect(job?.inspection?.request?.prompt).toContain("You are an image editing assistant");
    expect(job?.inspection?.request?.assets.map((asset) => asset.label)).toEqual(["input image", "mask"]);
    expect(job?.inspection?.response?.rawPayload).toEqual({ ok: true });
  });

  it("keeps the task-level sent assets stable when provider inspection returns different assets", async () => {
    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({ ok: true, providerId: "gemini", providerName: "stub", message: "ok", checkedAt: new Date().toISOString() }),
      executeTask: async () => ({
        ok: true,
        attemptedProviderIds: ["gemini"],
        primaryProviderId: "gemini",
        fallbackProviderIds: [],
        fallbackUsed: false,
        degradedMode: false,
        response: {
          ok: true,
          providerId: "gemini",
          family: "inpainting",
          taskId: "job-4",
          model: "gemini-2.5-flash-image",
          artifacts: [],
          warnings: [],
          inspection: {
            request: {
              prompt: "Remove the reflection",
              assets: [
                { kind: "image", label: "input image", mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 },
                { kind: "image", label: "guide image", mimeType: "image/png", data: "data:image/png;base64,CCCC", width: 10, height: 10 },
              ],
            },
            response: { rawPayload: { ok: true } },
          },
        },
      }),
    };

    const queue = createAiJobQueue(runtime);
    queue.enqueueTask({
      task: {
        id: "job-4",
        family: "inpainting",
        prompt: "Remove the reflection",
        input: {
          image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 },
          mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,BBBB", width: 10, height: 10 },
        },
        options: {
          mode: "replace",
          guideMode: "reflection-remove",
        },
      },
    }, "Remove reflection");
    await flushPromises();

    const job = queue.listJobs()[0];
    expect(job?.status).toBe("completed");
    expect(job?.inspection?.request?.assets.map((asset) => asset.label)).toEqual(["input image", "mask"]);
  });

  it("keeps the enqueue-time prompt stable when provider inspection returns a different prompt", async () => {
    const taskImage = { kind: "image" as const, mimeType: "image/png", data: "data:image/png;base64,AAAA", width: 10, height: 10 };
    const taskMask = { kind: "mask" as const, mimeType: "image/png", data: "data:image/png;base64,BBBB", width: 10, height: 10 };

    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({ ok: true, providerId: "gemini", providerName: "stub", message: "ok", checkedAt: new Date().toISOString() }),
      executeTask: async () => ({
        ok: true,
        attemptedProviderIds: ["gemini"],
        primaryProviderId: "gemini",
        fallbackProviderIds: [],
        fallbackUsed: false,
        degradedMode: false,
        response: {
          ok: true,
          providerId: "gemini",
          family: "inpainting",
          taskId: "job-stable",
          model: "gemini-2.5-flash-image",
          artifacts: [],
          warnings: [],
          inspection: {
            request: {
              prompt: "Provider built a different combined prompt",
              assets: [],
            },
            response: { rawPayload: { ok: true } },
          },
        },
      }),
    };

    const queue = createAiJobQueue(runtime);
    const enqueued = queue.enqueueTask({
      task: {
        id: "job-stable",
        family: "inpainting",
        prompt: "Fix the wall",
        input: { image: taskImage, mask: taskMask },
      },
    }, "Inpaint wall");

    const promptAtEnqueue = queue.listJobs().find((j) => j.id === enqueued.id)?.inspection?.request?.prompt;
    expect(promptAtEnqueue).toContain("Fix the wall");
    expect(promptAtEnqueue).toContain("You are an image editing assistant");

    await flushPromises();

    const job = queue.listJobs().find((j) => j.id === enqueued.id);
    expect(job?.status).toBe("completed");
    expect(job?.inspection?.request?.prompt).toBe(promptAtEnqueue);
  });

  it("seeds planned provider and model inspection values while the job is still pending", () => {
    const runtime: AiPlatformRuntime = {
      listProviders: () => [],
      validateProvider: async () => ({ ok: true, providerId: "gemini", providerName: "stub", message: "ok", checkedAt: new Date().toISOString() }),
      executeTask: async () => new Promise(() => {}),
    };

    const queue = createAiJobQueue(runtime);
    const job = queue.enqueueTask({
      task: { id: "job-5", family: "generation", prompt: "goblin" },
      plannedProviderId: "gemini",
      plannedModel: "gemini-2.5-flash-image",
    }, "Generate goblin");

    const queued = queue.listJobs().find((candidate) => candidate.id === job.id);
    expect(["pending", "running"]).toContain(queued?.status);
    expect(queued?.providerId).toBe("gemini");
    expect(queued?.inspection?.providerId).toBe("gemini");
    expect(queued?.inspection?.model).toBe("gemini-2.5-flash-image");
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
