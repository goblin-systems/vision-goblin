import { describe, expect, it, vi } from "vitest";
import { normalizeAiTaskError } from "./contracts";
import { createOpenAiCompatibleProvider } from "./providers/openAiCompatibleProvider";
import { createAiProviderRegistry } from "./registry";
import type { AiCaptioningTask, AiGenerationTask } from "./types";

describe("AI provider registry", () => {
  it("routes a generation task through the openai-compatible adapter", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        created: "gen-123",
        model: "gpt-image-1",
        data: [{ b64_json: "AAAA" }],
        usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
      }),
    }));

    const registry = createAiProviderRegistry([
      createOpenAiCompatibleProvider({
        endpoint: "https://example.test/v1",
        fetch: fetchMock,
        modelByFamily: { generation: "gpt-image-1" },
      }),
    ]);

    const task: AiGenerationTask = {
      id: "task-generation-1",
      family: "generation",
      prompt: "A goblin sketching thumbnails",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const httpResult = await registry.execute({ task, providerId: "openai-compatible" });

    expect(httpResult.ok).toBe(true);
    expect(httpResult.providerId).toBe("openai-compatible");
    expect(httpResult.ok && httpResult.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAAA",
      purpose: "generated",
    });
    expect(httpResult.ok && httpResult.usage).toEqual({
      estimatedCostUsd: 0.04,
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: "A goblin sketching thumbnails",
          n: 1,
          size: "1024x1024",
          output_format: "png",
        }),
      }),
    );
  });

  it("normalizes openai-compatible caption responses to shared text artifacts", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_123",
        model: "gpt-4.1-mini",
        output_text: "A green goblin holding a paintbrush beside a canvas.",
        usage: { input_tokens: 22, output_tokens: 9, total_tokens: 31 },
      }),
    }));

    const registry = createAiProviderRegistry([
      createOpenAiCompatibleProvider({
        endpoint: "https://example.test/v1",
        fetch: fetchMock,
        modelByFamily: { captioning: "gpt-4.1-mini" },
      }),
    ]);

    const task: AiCaptioningTask = {
      id: "task-caption-1",
      family: "captioning",
      input: {
        image: {
          kind: "image",
          mimeType: "image/png",
          data: "data:image/png;base64,BBBB",
          width: 256,
          height: 256,
        },
      },
      options: { detail: "brief" },
    };

    const result = await registry.execute({ task });

    expect(result).toEqual({
      ok: true,
      providerId: "openai-compatible",
      family: "captioning",
      taskId: "task-caption-1",
      providerTaskId: "resp_123",
      model: "gpt-4.1-mini",
      artifacts: [
        {
          kind: "text",
          role: "caption",
          text: "A green goblin holding a paintbrush beside a canvas.",
        },
      ],
      warnings: [],
      usage: {
        estimatedCostUsd: 0.0000775,
        inputTokens: 22,
        outputTokens: 9,
        totalTokens: 31,
      },
    });
  });

  it("normalizes transport failures into a shared error contract", async () => {
    const registry = createAiProviderRegistry([
      createOpenAiCompatibleProvider({
        endpoint: "https://example.test/v1",
        fetch: vi.fn(async () => {
          throw new Error("network unavailable");
        }),
      }),
    ]);

    const task: AiGenerationTask = {
      id: "task-generation-2",
      family: "generation",
      prompt: "A dramatic studio portrait of a goblin inventor",
    };

    const result = await registry.execute({ task });

    expect(result).toEqual({
      ok: false,
      providerId: "openai-compatible",
      family: "generation",
      taskId: "task-generation-2",
      providerTaskId: undefined,
      error: {
        code: "transport_error",
        message: "network unavailable",
        retryable: true,
        providerCode: undefined,
        details: undefined,
      },
      warnings: [],
    });
  });

  it("normalizes plain thrown values into fallback error details", () => {
    expect(normalizeAiTaskError("bad response")).toEqual({
      code: "unknown_error",
      message: "Unknown AI provider error.",
      retryable: false,
      providerCode: undefined,
      details: "bad response",
    });
  });
});
