import { describe, expect, it, vi } from "vitest";
import { createGeminiProvider } from "./geminiProvider";
import type {
  AiCaptioningTask,
  AiEnhancementTask,
  AiGenerationTask,
  AiImageAsset,
  AiInpaintingTask,
  AiMaskAsset,
  AiSegmentationTask,
} from "../types";

// ── Test helpers ────────────────────────────────────────────────────────

type MockFetchFn = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  return vi.fn<MockFetchFn>(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }));
}

function makeImageAsset(data = "data:image/png;base64,AAAA"): AiImageAsset {
  return { kind: "image", mimeType: "image/png", data, width: 512, height: 512 };
}

function makeMaskAsset(data = "data:image/png;base64,MMMM"): AiMaskAsset {
  return { kind: "mask", mimeType: "image/png", data, width: 512, height: 512 };
}

function parseFetchBody(fetchMock: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1];
  return JSON.parse(init?.body as string);
}

/** Chat completion response for captioning (OpenAI-compatible). */
function makeChatCompletionResponse(overrides?: {
  id?: string;
  model?: string;
  content?: string;
  images?: Array<{ type: string; image_url: { url: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}) {
  return {
    id: overrides?.id ?? "chatcmpl-123",
    model: overrides?.model ?? "gemini-2.5-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: overrides?.content ?? "",
          ...(overrides?.images ? { images: overrides.images } : {}),
        },
        finish_reason: "stop",
      },
    ],
    ...(overrides?.usage ? { usage: overrides.usage } : {}),
  };
}

/** Native generateContent response for image-producing tasks. */
function makeNativeResponse(overrides?: {
  modelVersion?: string;
  parts?: Array<{ text?: string } | { inlineData: { mimeType: string; data: string } }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}) {
  const defaultParts = overrides?.parts ?? [];
  return {
    candidates: [
      {
        content: {
          parts: defaultParts,
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
    ...(overrides?.usageMetadata ? { usageMetadata: overrides.usageMetadata } : {}),
    ...(overrides?.modelVersion ? { modelVersion: overrides.modelVersion } : {}),
  };
}

const GEMINI_OPENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_NATIVE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

// ── Tests ───────────────────────────────────────────────────────────────

describe("Gemini provider", () => {
  // ── Provider metadata ─────────────────────────────────────────────────

  it("returns an adapter with the correct id and displayName", () => {
    const provider = createGeminiProvider({ apiKey: "test-key" });
    expect(provider.id).toBe("gemini");
    expect(provider.displayName).toBe("Google Gemini");
  });

  it("supportedFamilies includes all 5 families", () => {
    const provider = createGeminiProvider({ apiKey: "test-key" });
    expect([...provider.supportedFamilies]).toEqual(
      expect.arrayContaining(["segmentation", "inpainting", "enhancement", "generation", "captioning"]),
    );
    expect(provider.supportedFamilies).toHaveLength(5);
  });

  // ── Endpoint configuration ────────────────────────────────────────────

  it("captioning: uses the default OpenAI-compatible endpoint", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "A test caption." }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-ep",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    await provider.execute({ task });

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_OPENAI_ENDPOINT}/chat/completions`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("generation: uses the native generateContent endpoint", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "BBBB" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-1",
      family: "generation",
      prompt: "A goblin in a spacesuit",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    await provider.execute({ task });

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("captioning: allows overriding the endpoint (applies to chat/completions path only)", async () => {
    const customEndpoint = "https://custom-gemini.test/v1";
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "Custom endpoint caption." }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", endpoint: customEndpoint, fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-custom",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    await provider.execute({ task });

    expect(fetchMock).toHaveBeenCalledWith(
      `${customEndpoint}/chat/completions`,
      expect.anything(),
    );
  });

  it("generation: endpoint override does NOT affect native API URL", async () => {
    const customEndpoint = "https://custom-gemini.test/v1";
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "CCCC" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", endpoint: customEndpoint, fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-override",
      family: "generation",
      prompt: "A pixel art landscape",
    };

    await provider.execute({ task });

    // Native endpoint is always the fixed Gemini URL, unaffected by endpoint override.
    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.anything(),
    );
  });

  // ── Authorization ─────────────────────────────────────────────────────

  it("captioning: sends Authorization: Bearer header with the API key", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "Auth test." }),
    });

    const provider = createGeminiProvider({ apiKey: "my-gemini-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-auth",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    await provider.execute({ task });

    const init = fetchMock.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-gemini-key");
  });

  it("generation: sends x-goog-api-key header for native API", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "EEEE" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "my-gemini-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-auth",
      family: "generation",
      prompt: "test",
    };

    await provider.execute({ task });

    const init = fetchMock.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("my-gemini-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  // ── Generation ────────────────────────────────────────────────────────

  it("generation: uses native endpoint, correct model, and generationConfig", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        modelVersion: "gemini-2.5-flash-image",
        parts: [{ inlineData: { mimeType: "image/png", data: "DDDD" } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-3",
      family: "generation",
      prompt: "A goblin with a paintbrush",
      options: { width: 1024, height: 1024, imageCount: 1 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,DDDD",
      purpose: "generated",
    });

    const body = parseFetchBody(fetchMock);
    expect(body.generationConfig).toEqual({
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    });

    // Verify contents format (native API).
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    expect(contents).toHaveLength(1);
    expect(contents[0].parts[0].text).toContain("A goblin with a paintbrush");
    expect(contents[0].parts[0].text).toContain("Output image must be exactly 1024x1024px");
  
    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("generation: logs the exact serialized JSON body before dispatch", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "LOGGED" } }],
      }),
    });
    const logMock = vi.fn();

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock, log: logMock });

    const task: AiGenerationTask = {
      id: "gen-log",
      family: "generation",
      prompt: "A logged gemini goblin",
      options: { width: 1024, height: 1024, imageCount: 1 },
    };

    await provider.execute({ task });

    const init = fetchMock.mock.calls[0][1];
    const body = init?.body as string;
    expect(logMock).toHaveBeenCalledWith(
      `[AI provider debug][gemini] Dispatching JSON request to ${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent with exact serialized body:\n${body}`,
    );
  });

  it("generation: maps aspect ratio for non-square dimensions", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "WIDE" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-wide",
      family: "generation",
      prompt: "A wide landscape",
      options: { width: 1920, height: 1080 },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const genConfig = body.generationConfig as { imageConfig?: { aspectRatio?: string } };
    expect(genConfig.imageConfig?.aspectRatio).toBe("16:9");
  });

  it("generation: omits imageConfig when no dimensions provided", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "NOSIZE" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-nosize",
      family: "generation",
      prompt: "Something",
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const genConfig = body.generationConfig as { imageConfig?: unknown };
    expect(genConfig.imageConfig).toBeUndefined();
  });

  it("generation: returns failure when no images in response", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ text: "I cannot generate that image." }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = { id: "gen-fail", family: "generation", prompt: "test" };
    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("invalid_response");
  });

  // ── Captioning ────────────────────────────────────────────────────────

  it("captioning: uses correct endpoint, model, and does NOT include modalities", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({
        content: "A green goblin holding a sword.",
        usage: { prompt_tokens: 22, completion_tokens: 9, total_tokens: 31 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-1",
      family: "captioning",
      input: { image: makeImageAsset() },
      options: { detail: "brief" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "text",
      role: "caption",
      text: "A green goblin holding a sword.",
    });

    const body = parseFetchBody(fetchMock);
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.modalities).toBeUndefined();

    // Verify image_url format in user content.
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    const content = userMsg!.content as Array<{ type: string; image_url?: { url: string } }>;
    const imagePart = content.find((c) => c.type === "image_url");
    expect(imagePart?.image_url?.url).toBe("data:image/png;base64,AAAA");

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_OPENAI_ENDPOINT}/chat/completions`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("captioning: returns failure when no text content in response", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "" }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-fail",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("invalid_response");
  });

  // ── Segmentation ──────────────────────────────────────────────────────

  it("segmentation: uses native endpoint, model, and combined prompt with image", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        modelVersion: "gemini-2.5-flash-image",
        parts: [{ inlineData: { mimeType: "image/png", data: "MASK" } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 40, totalTokenCount: 70 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-1",
      family: "segmentation",
      input: { image: makeImageAsset() },
      options: { mode: "subject" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "mask",
      mimeType: "image/png",
      data: "data:image/png;base64,MASK",
      label: "subject-mask",
    });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents).toHaveLength(1);

    // Verify combined prompt contains segmentation instruction.
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toBeDefined();
    expect(textPart!.text!.toLowerCase()).toContain("segmentation");
    expect(textPart!.text).toContain("aligned 1:1 with the source image");

    // Verify image is sent as inlineData with stripped base64.
    const imagePart = contents[0].parts.find((p) => "inlineData" in p);
    expect(imagePart?.inlineData?.mimeType).toBe("image/png");
    expect(imagePart?.inlineData?.data).toBe("AAAA");

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );

    // Verify x-goog-api-key header.
    const init = fetchMock.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
  });

  it("segmentation: uses background mode label correctly", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "BGMASK" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-bg",
      family: "segmentation",
      input: { image: makeImageAsset() },
      options: { mode: "background" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({ label: "background-mask" });
  });

  // ── Enhancement ───────────────────────────────────────────────────────

  it("enhancement: uses native endpoint, model, and combined prompt with image", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        modelVersion: "gemini-2.5-flash-image",
        parts: [{ inlineData: { mimeType: "image/png", data: "ENHANCED" } }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25, totalTokenCount: 40 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-1",
      family: "enhancement",
      input: { image: makeImageAsset() },
      options: { operation: "auto-enhance" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,ENHANCED",
      purpose: "enhanced",
    });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents).toHaveLength(1);

    // Verify combined prompt contains enhancement instruction.
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toBeDefined();
    expect(typeof textPart!.text).toBe("string");
    expect(textPart!.text).toContain("Global system instruction:");
    expect(textPart!.text).toContain("Tool workflow instruction:");
    expect(textPart!.text).toContain("User instruction:");
    expect(textPart!.text).toContain("in-context image editor enhancement assistant");
    expect(textPart!.text).toContain("Output only the edited image");

    // Verify image is sent as inlineData with stripped base64.
    const imagePart = contents[0].parts.find((p) => "inlineData" in p);
    expect(imagePart?.inlineData?.data).toBe("AAAA");

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("enhancement: upscale operation produces 'upscaled' purpose", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "UPSCALED" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-up",
      family: "enhancement",
      input: { image: makeImageAsset() },
      options: { operation: "upscale", scaleFactor: 2 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({ purpose: "upscaled" });
  });

  // ── Inpainting ────────────────────────────────────────────────────────

  it("inpainting: uses native endpoint, model, and sends image + mask as inlineData", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        modelVersion: "gemini-2.5-flash-image",
        parts: [{ inlineData: { mimeType: "image/png", data: "INPAINTED" } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 60, totalTokenCount: 110 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiInpaintingTask = {
      id: "inp-1",
      family: "inpainting",
      prompt: "Replace the sky with a starry night",
      input: {
        image: makeImageAsset("data:image/png;base64,SOURCE"),
        mask: makeMaskAsset("data:image/png;base64,MASKDATA"),
      },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,INPAINTED",
      purpose: "inpainted",
    });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents).toHaveLength(1);

    // Verify combined prompt contains mask instruction.
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toBeDefined();
    expect(textPart!.text!.toLowerCase()).toContain("mask");
    expect(textPart!.text).toContain("Output image must be exactly 512x512px");
    expect(textPart!.text).toContain("aligned 1:1 with the source image");

    // Verify both image and mask are sent as inlineData with stripped base64.
    const inlineDataParts = contents[0].parts.filter((p) => "inlineData" in p);
    expect(inlineDataParts).toHaveLength(2);
    expect(inlineDataParts[0].inlineData?.data).toBe("SOURCE");
    expect(inlineDataParts[1].inlineData?.data).toBe("MASKDATA");

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-2.5-flash-image:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ── Error handling ────────────────────────────────────────────────────

  it("returns provider_error when API responds with non-ok status", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 400,
      body: {
        error: { message: "Invalid API key", code: "invalid_api_key" },
      },
    });

    const provider = createGeminiProvider({ apiKey: "bad-key", fetch: fetchMock });

    const task: AiGenerationTask = { id: "err-1", family: "generation", prompt: "test" };
    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("provider_error");
    expect(result.error.message).toBe("Invalid API key");
    expect(result.error.providerCode).toBe("invalid_api_key");
    expect(result.error.retryable).toBe(false);
  });

  it("returns provider_error with retryable=true for 500 status", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 500,
      body: { error: { message: "Internal server error" } },
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "err-500",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("provider_error");
    expect(result.error.retryable).toBe(true);
  });

  it("returns transport_error when fetch throws", async () => {
    const fetchMock = vi.fn<MockFetchFn>(async () => {
      throw new Error("Network timeout");
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = { id: "err-net", family: "generation", prompt: "test" };
    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("transport_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toBe("Network timeout");
  });

  // ── Usage / cost estimation ───────────────────────────────────────────

  it("captioning: returns usage with token counts and estimated cost", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({
        content: "A beautiful landscape.",
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-usage",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens).toBe(100);
    expect(result.usage!.outputTokens).toBe(10);
    expect(result.usage!.totalTokens).toBe(110);
    expect(result.usage!.estimatedCostUsd).toBeCloseTo(110 * 0.0000025, 10);
  });

  it("generation: returns usage with estimated cost per image", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "IMG" } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-cost",
      family: "generation",
      prompt: "test",
      options: { imageCount: 2 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.usage).toBeDefined();
    expect(result.usage!.estimatedCostUsd).toBeCloseTo(0.08, 10);
  });

  it("generation: returns native usage metadata with correct field mapping", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "IMG" } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-usage",
      family: "generation",
      prompt: "test",
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens).toBe(100);
    expect(result.usage!.outputTokens).toBe(200);
    expect(result.usage!.totalTokens).toBe(300);
  });

  // ── Segmentation: additional coverage ─────────────────────────────────

  it("segmentation: object mode with subjectHint includes hint in prompt and labels artifact 'object-mask'", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "OBJMASK" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-obj-hint",
      family: "segmentation",
      input: { image: makeImageAsset(), subjectHint: "the red car" },
      options: { mode: "object" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({ kind: "mask", label: "object-mask" });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toContain("the red car");
  });

  it("segmentation: background-removal mode labels artifact 'subject-mask'", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "BRMASK" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-bgrem",
      family: "segmentation",
      input: { image: makeImageAsset() },
      options: { mode: "background-removal" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({ kind: "mask", label: "subject-mask" });
  });

  it("segmentation: returns invalid_response when response has no images", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ text: "I could not generate a mask." }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-noimg",
      family: "segmentation",
      input: { image: makeImageAsset() },
      options: { mode: "subject" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("invalid_response");
  });

  it("segmentation: returns provider_error when API responds with non-ok status", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 400,
      body: { error: { message: "Bad request for segmentation", code: "bad_request" } },
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-err",
      family: "segmentation",
      input: { image: makeImageAsset() },
      options: { mode: "subject" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("provider_error");
    expect(result.error.message).toBe("Bad request for segmentation");
    expect(result.error.retryable).toBe(false);
  });

  it("segmentation: returns transport_error when fetch throws", async () => {
    const fetchMock = vi.fn<MockFetchFn>(async () => {
      throw new Error("Segmentation network failure");
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiSegmentationTask = {
      id: "seg-transport",
      family: "segmentation",
      input: { image: makeImageAsset() },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("transport_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toBe("Segmentation network failure");
  });

  // ── Inpainting: additional coverage ───────────────────────────────────

  it("inpainting: returns invalid_response when response has no images", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ text: "Unable to inpaint the image." }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiInpaintingTask = {
      id: "inp-noimg",
      family: "inpainting",
      prompt: "Fill in the gap",
      input: {
        image: makeImageAsset(),
        mask: makeMaskAsset(),
      },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("invalid_response");
  });

  it("inpainting: returns provider_error when API responds with 403", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 403,
      body: { error: { message: "Forbidden", code: "forbidden" } },
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiInpaintingTask = {
      id: "inp-err",
      family: "inpainting",
      prompt: "Replace sky",
      input: {
        image: makeImageAsset(),
        mask: makeMaskAsset(),
      },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("provider_error");
    expect(result.error.message).toBe("Forbidden");
    expect(result.error.retryable).toBe(false);
  });

  // ── Enhancement: additional coverage ──────────────────────────────────

  it("enhancement: returns invalid_response when response has no images", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ text: "Could not enhance the image." }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-noimg",
      family: "enhancement",
      input: { image: makeImageAsset() },
      options: { operation: "auto-enhance" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("invalid_response");
  });

  it("enhancement: includes reference images as additional inlineData parts", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "STYLED" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-refs",
      family: "enhancement",
      input: {
        image: makeImageAsset("data:image/png;base64,SRC"),
        referenceImages: [makeImageAsset("data:image/png;base64,REF1")],
      },
      options: { operation: "style-transfer" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    // Parts should be: text + source image + reference image = 3 total
    expect(contents[0].parts).toHaveLength(3);
    const inlineDataParts = contents[0].parts.filter((p) => "inlineData" in p);
    expect(inlineDataParts).toHaveLength(2);
    expect(inlineDataParts[0].inlineData?.data).toBe("SRC");
    expect(inlineDataParts[1].inlineData?.data).toBe("REF1");

    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toContain("Transfer the visual style from the reference image onto the source image");
    expect(textPart?.text).toContain("preserving the source image's subject, content, composition, and framing");
    expect(textPart?.text).toContain("Do not replace the source subject or copy the reference composition");
    expect(textPart?.text).toContain("Tool workflow instruction:");
    expect(textPart?.text).toContain("User instruction:\n");
  });

  it("enhancement: style-transfer without references applies a stylized look instead of claiming reference transfer", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "STYLEONLY" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    await provider.execute({
      task: {
        id: "enh-style-no-ref",
        family: "enhancement",
        input: { image: makeImageAsset() },
        options: { operation: "style-transfer" },
      },
    });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toContain("Apply a stylized look to the source image");
    expect(textPart?.text).not.toContain("Transfer the visual style from the reference image");
  });

  it("enhancement: style-transfer keeps user-entered style direction only in the user instruction section", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "STYLEPROMPT" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    await provider.execute({
      task: {
        id: "enh-style-custom",
        family: "enhancement",
        prompt: "editorial matte film look",
        input: { image: makeImageAsset(), referenceImages: [makeImageAsset("data:image/png;base64,REF1")] },
        options: { operation: "style-transfer" },
      },
    });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toContain("User instruction:\neditorial matte film look");
    expect(textPart?.text).not.toContain("Additional style direction from the user");
    expect(textPart?.text).toContain("Tool workflow instruction:");
    expect(textPart?.text).toContain("Use the provided reference image only as visual style guidance.");
  });

  it("enhancement: style-transfer produces 'styled' purpose", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "STYLEDIMG" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-style",
      family: "enhancement",
      input: { image: makeImageAsset() },
      options: { operation: "style-transfer" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({ purpose: "styled" });
  });

  it("enhancement: upscale includes size hint in combined prompt", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "UPSCALED3X" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-upscale-hint",
      family: "enhancement",
      input: { image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,SMALL", width: 200, height: 100 } },
      options: { operation: "upscale", scaleFactor: 3 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    const textPart = contents[0].parts.find((p) => "text" in p);
    expect(textPart?.text).toContain("600x300");
    expect(textPart?.text).toContain("aligned 1:1 with the source image");
  });

  it("enhancement: returns provider_error when API responds with 429", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 429,
      body: { error: { message: "Rate limit exceeded", code: "rate_limited" } },
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiEnhancementTask = {
      id: "enh-err",
      family: "enhancement",
      input: { image: makeImageAsset() },
      options: { operation: "auto-enhance" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("provider_error");
    expect(result.error.message).toBe("Rate limit exceeded");
    expect(result.error.retryable).toBe(false);
  });

  // ── Captioning: additional coverage ───────────────────────────────────

  it("captioning: uses detailed prompt when detail option is not set", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "A detailed description." }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-detail-default",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const messages = body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    const textPart = userMsg!.content.find((c) => c.type === "text");
    expect(textPart?.text).toBe("Describe this image in detail.");
  });

  it("captioning: uses custom prompt when task.prompt is provided", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "Red, blue, and green." }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-custom-prompt",
      family: "captioning",
      prompt: "What colors are in this image?",
      input: { image: makeImageAsset() },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const messages = body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    const textPart = userMsg!.content.find((c) => c.type === "text");
    expect(textPart?.text).toBe("What colors are in this image?");
  });

  it("captioning: returns transport_error when fetch throws", async () => {
    const fetchMock = vi.fn<MockFetchFn>(async () => {
      throw new Error("Captioning network failure");
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiCaptioningTask = {
      id: "cap-transport",
      family: "captioning",
      input: { image: makeImageAsset() },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("transport_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toBe("Captioning network failure");
  });

  // ── Cross-cutting: additional coverage ────────────────────────────────

  it("generation: uses preferredModel override in native endpoint URL", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "CUSTOM" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-preferred",
      family: "generation",
      prompt: "A custom model image",
    };

    await provider.execute({ task, preferredModel: "gemini-custom-model" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${GEMINI_NATIVE_ENDPOINT}/models/gemini-custom-model:generateContent`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns unsupported_task error for unknown task family", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: {} });
    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task = {
      id: "unknown-1",
      family: "unknown-family" as "generation",
    } as AiGenerationTask;

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.code).toBe("unsupported_task");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain("unknown-family");
  });

  it("no apiKey: native headers omit x-goog-api-key and captioning headers omit Authorization", async () => {
    // Test native (generation) path
    const nativeFetch = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "NOKEY" } }],
      }),
    });

    const nativeProvider = createGeminiProvider({ fetch: nativeFetch });

    const genTask: AiGenerationTask = { id: "nokey-gen", family: "generation", prompt: "test" };
    await nativeProvider.execute({ task: genTask });

    const nativeInit = nativeFetch.mock.calls[0][1];
    const nativeHeaders = nativeInit?.headers as Record<string, string>;
    expect(nativeHeaders["x-goog-api-key"]).toBeUndefined();

    // Test captioning (chat/completions) path
    const chatFetch = mockFetch({
      ok: true,
      status: 200,
      body: makeChatCompletionResponse({ content: "No key caption." }),
    });

    const chatProvider = createGeminiProvider({ fetch: chatFetch });

    const capTask: AiCaptioningTask = {
      id: "nokey-cap",
      family: "captioning",
      input: { image: makeImageAsset() },
    };
    await chatProvider.execute({ task: capTask });

    const chatInit = chatFetch.mock.calls[0][1];
    const chatHeaders = chatInit?.headers as Record<string, string>;
    expect(chatHeaders["Authorization"]).toBeUndefined();
  });

  it("generation: response without usageMetadata still includes estimatedCostUsd", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "NOUSAGE" } }],
        // No usageMetadata provided
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-nousage",
      family: "generation",
      prompt: "test",
      options: { imageCount: 1 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.usage).toBeDefined();
    expect(result.usage!.estimatedCostUsd).toBeCloseTo(0.04, 10);
    expect(result.usage!.inputTokens).toBeUndefined();
    expect(result.usage!.outputTokens).toBeUndefined();
    expect(result.usage!.totalTokens).toBeUndefined();
  });

  it("generation: multiple images in response are returned as separate artifacts", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [
          { inlineData: { mimeType: "image/png", data: "IMG1" } },
          { inlineData: { mimeType: "image/png", data: "IMG2" } },
        ],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-multi",
      family: "generation",
      prompt: "Two variations",
      options: { imageCount: 2 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,IMG1",
      purpose: "generated",
    });
    expect(result.artifacts[1]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,IMG2",
      purpose: "generated",
    });
  });

  // ── Aspect ratio: additional coverage ─────────────────────────────────

  it("generation: maps portrait dimensions to 3:4 aspect ratio", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "PORTRAIT" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-portrait",
      family: "generation",
      prompt: "A portrait image",
      options: { width: 600, height: 800 },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const genConfig = body.generationConfig as { imageConfig?: { aspectRatio?: string } };
    expect(genConfig.imageConfig?.aspectRatio).toBe("3:4");
  });

  it("generation: maps tall portrait dimensions to 9:16 aspect ratio", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "TALL" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-tall",
      family: "generation",
      prompt: "A tall portrait",
      options: { width: 450, height: 800 },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const genConfig = body.generationConfig as { imageConfig?: { aspectRatio?: string } };
    expect(genConfig.imageConfig?.aspectRatio).toBe("9:16");
  });

  // ── Generation: reference images ──────────────────────────────────────

  it("generation: includes reference images as inlineData parts before the text prompt", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "GENERATED" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-refs",
      family: "generation",
      prompt: "Generate a similar image",
      input: {
        referenceImages: [
          makeImageAsset("data:image/png;base64,REF1"),
          makeImageAsset("data:image/png;base64,REF2"),
        ],
      },
      options: { width: 1024, height: 1024 },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents).toHaveLength(1);

    // Parts should be: ref1 image + ref2 image + text prompt = 3 total
    expect(contents[0].parts).toHaveLength(3);

    // Reference images come before the text prompt.
    expect(contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "REF1" } });
    expect(contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "REF2" } });
    expect(contents[0].parts[2].text).toContain("Generate a similar image");
    expect(contents[0].parts[2].text).toContain("Output image must be exactly 1024x1024px");
  });

  it("generation: single reference image is included as inlineData before text", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "OUTPUT" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-single-ref",
      family: "generation",
      prompt: "Outpaint this scene",
      input: {
        referenceImages: [makeImageAsset("data:image/png;base64,DOCIMG")],
      },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(true);

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents[0].parts).toHaveLength(2);
    expect(contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "DOCIMG" } });
    expect(contents[0].parts[1].text).toContain("Outpaint this scene");
    expect(contents[0].parts[1].text).toContain("Preserve the original framing and keep all content aligned 1:1");
  });

  it("generation: uses first reference image dimensions as source size guidance", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "OUTPUT" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-source-size",
      family: "generation",
      prompt: "Generate a reframed version",
      input: {
        referenceImages: [
          {
            kind: "image",
            mimeType: "image/png",
            data: "data:image/png;base64,DOCIMG",
            width: 1600,
            height: 900,
          },
        ],
      },
      options: { width: 512, height: 512 },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents[0].parts[1].text).toContain("Source image size: 1600x900px");
    expect(contents[0].parts[1].text).toContain("Output image must be exactly 512x512px");
  });

  it("generation: without reference images sends only text part (unchanged behavior)", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "TEXTONLY" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-no-refs",
      family: "generation",
      prompt: "A goblin in space",
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string; inlineData?: unknown }> }>;
    expect(contents[0].parts).toHaveLength(1);
    expect(contents[0].parts[0]).toEqual({ text: "A goblin in space" });
  });

  it("generation: empty referenceImages array sends only text part", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: makeNativeResponse({
        parts: [{ inlineData: { mimeType: "image/png", data: "EMPTYREF" } }],
      }),
    });

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });

    const task: AiGenerationTask = {
      id: "gen-empty-refs",
      family: "generation",
      prompt: "Generate something",
      input: { referenceImages: [] },
    };

    await provider.execute({ task });

    const body = parseFetchBody(fetchMock);
    const contents = body.contents as Array<{ parts: Array<{ text?: string }> }>;
    expect(contents[0].parts).toHaveLength(1);
    expect(contents[0].parts[0]).toEqual({ text: "Generate something" });
  });
});
