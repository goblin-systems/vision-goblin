import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type {
  AiCaptioningTask,
  AiEnhancementTask,
  AiGenerationTask,
  AiImageAsset,
  AiInpaintingTask,
  AiMaskAsset,
  AiSegmentationTask,
} from "../types";

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

const TEST_ENDPOINT = "https://example.test/v1";

describe("OpenAI compatible provider", () => {
  // ─── Supported families ──────────────────────────────────────────────

  it("supportedFamilies includes all 5 families", () => {
    const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT });
    expect([...provider.supportedFamilies]).toEqual(
      expect.arrayContaining(["segmentation", "inpainting", "enhancement", "generation", "captioning"]),
    );
    expect(provider.supportedFamilies).toHaveLength(5);
  });

  // ─── Generation (regression) ─────────────────────────────────────────

  it("generation: sends correct request and returns image artifact", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: {
        created: "gen-123",
        model: "gpt-image-1",
        data: [{ b64_json: "AAAA" }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    });

    const provider = createOpenAiCompatibleProvider({
      endpoint: TEST_ENDPOINT,
      fetch: fetchMock,
      modelByFamily: { generation: "gpt-image-1" },
    });

    const task: AiGenerationTask = {
      id: "gen-1",
      family: "generation",
      prompt: "A goblin with a paintbrush",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const result = await provider.execute({ task, providerId: "openai-compatible" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.artifacts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAAA",
      purpose: "generated",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${TEST_ENDPOINT}/images/generations`,
      expect.objectContaining({ method: "POST" }),
    );

    const body = parseFetchBody(fetchMock);
    expect(body.output_format).toBe("png");
    expect(body).not.toHaveProperty("response_format");
    expect(body.prompt).toContain("Output image must be exactly 512x512px");
  });

  it("generation: logs the exact serialized JSON body before dispatch", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: {
        created: "gen-log-json",
        model: "gpt-image-1",
        data: [{ b64_json: "AAAA" }],
      },
    });
    const logMock = vi.fn();

    const provider = createOpenAiCompatibleProvider({
      endpoint: TEST_ENDPOINT,
      fetch: fetchMock,
      log: logMock,
      modelByFamily: { generation: "gpt-image-1" },
    });

    const task: AiGenerationTask = {
      id: "gen-log-json",
      family: "generation",
      prompt: "A logged goblin",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    await provider.execute({ task });

    const init = fetchMock.mock.calls[0][1];
    const body = init?.body as string;
    expect(logMock).toHaveBeenCalledWith(
      `[AI provider debug][openai-compatible] Dispatching JSON request to ${TEST_ENDPOINT}/images/generations with exact serialized body:\n${body}`,
    );
  });

  // ─── Generation size mapping ──────────────────────────────────────────

  describe("generation: toImageSize maps to valid OpenAI sizes", () => {
    function mockGenerationResponse() {
      return mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "gen-size",
          model: "gpt-image-1",
          data: [{ b64_json: "AAAA" }],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        },
      });
    }

    function makeGenerationProvider(fetchMock: ReturnType<typeof mockFetch>) {
      return createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { generation: "gpt-image-1" },
      });
    }

    it("maps 512x512 to 1024x1024 (square → square)", async () => {
      const fetchMock = mockGenerationResponse();
      const provider = makeGenerationProvider(fetchMock);

      const task: AiGenerationTask = {
        id: "gen-size-1",
        family: "generation",
        prompt: "test",
        options: { width: 512, height: 512, imageCount: 1 },
      };

      await provider.execute({ task });
      expect(parseFetchBody(fetchMock).size).toBe("1024x1024");
    });

    it("maps 800x1200 to 1024x1536 (portrait → portrait)", async () => {
      const fetchMock = mockGenerationResponse();
      const provider = makeGenerationProvider(fetchMock);

      const task: AiGenerationTask = {
        id: "gen-size-2",
        family: "generation",
        prompt: "test",
        options: { width: 800, height: 1200, imageCount: 1 },
      };

      await provider.execute({ task });
      expect(parseFetchBody(fetchMock).size).toBe("1024x1536");
    });

    it("maps 1600x900 to 1536x1024 (landscape → landscape)", async () => {
      const fetchMock = mockGenerationResponse();
      const provider = makeGenerationProvider(fetchMock);

      const task: AiGenerationTask = {
        id: "gen-size-3",
        family: "generation",
        prompt: "test",
        options: { width: 1600, height: 900, imageCount: 1 },
      };

      await provider.execute({ task });
      expect(parseFetchBody(fetchMock).size).toBe("1536x1024");
    });

    it("omits size when width and height are not provided", async () => {
      const fetchMock = mockGenerationResponse();
      const provider = makeGenerationProvider(fetchMock);

      const task: AiGenerationTask = {
        id: "gen-size-4",
        family: "generation",
        prompt: "test",
        options: { imageCount: 1 },
      };

      await provider.execute({ task });
      expect(parseFetchBody(fetchMock)).not.toHaveProperty("size");
    });
  });

  // ─── Generation with reference images ─────────────────────────────────

  describe("generation: reference images switch to /images/edits", () => {
    function mockEditsResponse(imageData = "EDITED_DATA") {
      return mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "edit-gen-1",
          model: "gpt-image-1",
          data: [{ b64_json: imageData }],
          usage: { input_tokens: 30, output_tokens: 60, total_tokens: 90 },
        },
      });
    }

    it("uses /images/edits endpoint when reference images are present", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { generation: "gpt-image-1" },
      });

      const task: AiGenerationTask = {
        id: "gen-ref-1",
        family: "generation",
        prompt: "Outpaint this scene",
        input: {
          referenceImages: [makeImageAsset("data:image/png;base64,DOCIMG")],
        },
        options: { width: 1024, height: 1024, imageCount: 1 },
      };

      const result = await provider.execute({ task });

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${TEST_ENDPOINT}/images/edits`);
      expect(init?.method).toBe("POST");
    });

    it("sends FormData body with image, prompt, model, n, and size", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { generation: "gpt-image-1" },
      });

      const task: AiGenerationTask = {
        id: "gen-ref-fd",
        family: "generation",
        prompt: "Generate a variation",
        input: {
          referenceImages: [makeImageAsset("data:image/png;base64,REF1")],
        },
        options: { width: 1024, height: 1024, imageCount: 2 },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      expect(formData).toBeInstanceOf(FormData);

      const imageBlob = formData.get("image") as File;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.name).toBe("image.png");

      expect(formData.get("prompt")).toEqual(expect.stringContaining("Generate a variation"));
      expect(formData.get("model")).toBe("gpt-image-1");
      expect(formData.get("n")).toBe("2");
      expect(formData.get("size")).toBe("1024x1024");
    });

    it("logs multipart prompt, text fields, and binary descriptors before dispatch", async () => {
      const fetchMock = mockEditsResponse();
      const logMock = vi.fn();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        log: logMock,
        modelByFamily: { generation: "gpt-image-1" },
      });

      const task: AiGenerationTask = {
        id: "gen-ref-log",
        family: "generation",
        prompt: "Generate a logged variation",
        input: {
          referenceImages: [makeImageAsset("data:image/png;base64,REF1")],
        },
        options: { width: 1024, height: 1024, imageCount: 2 },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const expectedPayload = JSON.stringify({
        prompt: formData.get("prompt"),
        textFields: {
          model: formData.get("model"),
          n: formData.get("n"),
          size: formData.get("size"),
        },
        binaryParts: [
          {
            name: "image",
            filename: "image.png",
            mimeType: "image/png",
            size: (formData.get("image") as Blob).size,
          },
        ],
      });

      expect(logMock).toHaveBeenCalledWith(
        `[AI provider debug][openai-compatible] Dispatching multipart/form-data request to ${TEST_ENDPOINT}/images/edits. Raw multipart body is not directly available from FormData without re-encoding, so this log includes the exact composed prompt, exact text fields, and binary descriptors:\n${expectedPayload}`,
      );
    });

    it("uses first reference image dimensions as source size guidance", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-ref-source-size",
        family: "generation",
        prompt: "Create a thumbnail variation",
        input: {
          referenceImages: [
            {
              kind: "image",
              mimeType: "image/png",
              data: "data:image/png;base64,REF1",
              width: 1600,
              height: 900,
            },
          ],
        },
        options: { width: 512, height: 512, imageCount: 1 },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("Source image size: 1600x900px");
      expect(prompt).toContain("Output image must be exactly 512x512px");
      expect(prompt).toContain("aligned 1:1 with the source image");
    });

    it("uses first reference image as the image parameter", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-ref-first",
        family: "generation",
        prompt: "Modify this",
        input: {
          referenceImages: [
            makeImageAsset("data:image/png;base64,AAAA"),
            makeImageAsset("data:image/png;base64,BBBB"),
          ],
        },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0]?.[1];
      const formData = init?.body as unknown as FormData;
      const imageBlob = formData.get("image") as Blob;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.type).toBe("image/png");
    });

    it("does not set Content-Type header (lets runtime add boundary)", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        apiKey: "sk-test",
      });

      const task: AiGenerationTask = {
        id: "gen-ref-headers",
        family: "generation",
        prompt: "test",
        input: { referenceImages: [makeImageAsset()] },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0][1];
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers).toBeDefined();
      expect(headers!["Content-Type"]).toBeUndefined();
      expect(headers!["Authorization"]).toBe("Bearer sk-test");
    });

    it("omits size in FormData when no dimensions provided", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-ref-nosize",
        family: "generation",
        prompt: "test",
        input: { referenceImages: [makeImageAsset()] },
      };

      await provider.execute({ task });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      expect(formData.get("size")).toBeNull();
    });

    it("returns image artifact with purpose generated", async () => {
      const fetchMock = mockEditsResponse("GEN_EDIT");
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-ref-artifact",
        family: "generation",
        prompt: "Make it better",
        input: { referenceImages: [makeImageAsset()] },
      };

      const result = await provider.execute({ task });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({
        kind: "image",
        mimeType: "image/png",
        data: "data:image/png;base64,GEN_EDIT",
        purpose: "generated",
      });
    });

    it("still uses /images/generations when no reference images", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "gen-nref",
          model: "gpt-image-1",
          data: [{ b64_json: "NOREF" }],
        },
      });

      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-no-ref",
        family: "generation",
        prompt: "A goblin",
      };

      await provider.execute({ task });

      expect(fetchMock).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/images/generations`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("still uses /images/generations when referenceImages is empty array", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "gen-empty",
          model: "gpt-image-1",
          data: [{ b64_json: "EMPTY" }],
        },
      });

      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-empty-refs",
        family: "generation",
        prompt: "A goblin",
        input: { referenceImages: [] },
      };

      await provider.execute({ task });

      expect(fetchMock).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/images/generations`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns failure on API error via /images/edits", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 400,
        body: { error: { message: "Invalid image", code: "bad_request" } },
      });

      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const task: AiGenerationTask = {
        id: "gen-ref-err",
        family: "generation",
        prompt: "test",
        input: { referenceImages: [makeImageAsset()] },
      };

      const result = await provider.execute({ task });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("provider_error");
      expect(result.error.message).toBe("Invalid image");
    });

    it("uses preferredModel when provided with reference images", async () => {
      const fetchMock = mockEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { generation: "gpt-image-1" },
      });

      const task: AiGenerationTask = {
        id: "gen-ref-model",
        family: "generation",
        prompt: "test",
        input: { referenceImages: [makeImageAsset()] },
      };

      await provider.execute({ task, preferredModel: "dall-e-3" });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      expect(formData.get("model")).toBe("dall-e-3");
    });
  });

  // ─── Captioning (regression) ──────────────────────────────────────────

  it("captioning: sends correct request and returns text artifact", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: {
        id: "resp_123",
        model: "gpt-4.1-mini",
        output_text: "A green goblin holding a paintbrush.",
        usage: { input_tokens: 22, output_tokens: 9, total_tokens: 31 },
      },
    });

    const provider = createOpenAiCompatibleProvider({
      endpoint: TEST_ENDPOINT,
      fetch: fetchMock,
      modelByFamily: { captioning: "gpt-4.1-mini" },
    });

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
      text: "A green goblin holding a paintbrush.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${TEST_ENDPOINT}/responses`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ─── Segmentation ────────────────────────────────────────────────────

  describe("segmentation", () => {
    function makeSegmentationTask(
      mode: NonNullable<AiSegmentationTask["options"]>["mode"] = "subject",
      prompt?: string,
    ): AiSegmentationTask {
      return {
        id: "seg-1",
        family: "segmentation",
        prompt,
        input: { image: makeImageAsset(), subjectHint: prompt },
        options: { mode },
      };
    }

    function mockSegmentationResponse(imageData = "MASK_DATA") {
      return mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "edit-seg-1",
          model: "gpt-image-1",
          data: [{ b64_json: imageData }],
          usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
        },
      });
    }

    it("sends request to /images/edits endpoint", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { segmentation: "gpt-image-1" },
      });

      await provider.execute({ task: makeSegmentationTask("subject") });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${TEST_ENDPOINT}/images/edits`);
      expect(init?.method).toBe("POST");
    });

    it("sends FormData body (not JSON)", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { segmentation: "gpt-image-1" },
      });

      await provider.execute({ task: makeSegmentationTask("subject") });

      const init = fetchMock.mock.calls[0][1];
      expect(init?.body).toBeInstanceOf(FormData);
    });

    it("does not set Content-Type header (lets runtime add boundary)", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        apiKey: "sk-test",
      });

      await provider.execute({ task: makeSegmentationTask("subject") });

      const init = fetchMock.mock.calls[0][1];
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers).toBeDefined();
      expect(headers!["Content-Type"]).toBeUndefined();
      expect(headers!["Authorization"]).toBe("Bearer sk-test");
    });

    it("includes image, prompt, model, and n in FormData (no mask)", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { segmentation: "gpt-image-1" },
      });

      await provider.execute({ task: makeSegmentationTask("subject") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;

      expect(formData.get("model")).toBe("gpt-image-1");
      expect(formData.get("n")).toBe("1");
      expect(formData.get("mask")).toBeNull();

      const imageBlob = formData.get("image") as File;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.name).toBe("image.png");

      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("segmentation mask");
      expect(prompt).toContain("aligned 1:1 with the source image");
    });

    it("parses mask artifact from response", async () => {
      const fetchMock = mockSegmentationResponse("MASK_DATA");
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,MASK_DATA",
      });
    });

    it("prompt varies by mode — subject", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeSegmentationTask("subject") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/main subject/i);
    });

    it("prompt varies by mode — background", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeSegmentationTask("background") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/background/i);
    });

    it("prompt varies by mode — object with subjectHint", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeSegmentationTask("object", "the red car") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/specific object/i);
    });

    it("prompt varies by mode — background-removal", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeSegmentationTask("background-removal") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/subject/i);
    });

    it("returns failure on API error", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 400,
        body: { error: { message: "Invalid image", code: "bad_request" } },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("provider_error");
      expect(result.error.message).toBe("Invalid image");
    });

    it("returns failure on transport error", async () => {
      const fetchMock = vi.fn<MockFetchFn>(async () => { throw new Error("network down"); });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("transport_error");
      expect(result.error.retryable).toBe(true);
    });

    it("includes image data as Blob in FormData", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeSegmentationTask("subject") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const imageBlob = formData.get("image") as Blob;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.type).toBe("image/png");
    });

    it("sets correct mask label for subject mode", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({ label: "subject-mask" });
    });

    it("sets correct mask label for background mode", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("background") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({
        kind: "mask",
        label: "background-mask",
      });
    });

    it("sets correct mask label for object mode", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("object", "the red car") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({ label: "object-mask" });
    });

    it("returns failure when response has no image data", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [] },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("invalid_response");
    });

    it("includes token-based cost estimation", async () => {
      const fetchMock = mockSegmentationResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeSegmentationTask("subject") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.usage).toBeDefined();
      expect(result.usage!.totalTokens).toBe(150);
      expect(result.usage!.estimatedCostUsd).toBe(150 * 0.0000025);
    });
  });

  // ─── Inpainting ──────────────────────────────────────────────────────

  describe("inpainting", () => {
    function makeInpaintingTask(prompt = "Replace with flowers"): AiInpaintingTask {
      return {
        id: "inp-1",
        family: "inpainting",
        prompt,
        input: { image: makeImageAsset(), mask: makeMaskAsset() },
        options: { mode: "replace" },
      };
    }

    function mockImagesEditsResponse(imageData = "INPAINTED_DATA") {
      return mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "edit-123",
          model: "gpt-image-1",
          data: [{ b64_json: imageData }],
          usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
        },
      });
    }

    it("sends request to /images/edits endpoint", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { inpainting: "gpt-image-1" },
      });

      await provider.execute({ task: makeInpaintingTask() });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${TEST_ENDPOINT}/images/edits`);
      expect(init?.method).toBe("POST");
    });

    it("sends FormData body (not JSON)", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { inpainting: "gpt-image-1" },
      });

      await provider.execute({ task: makeInpaintingTask() });

      const init = fetchMock.mock.calls[0][1];
      expect(init?.body).toBeInstanceOf(FormData);
    });

    it("does not set Content-Type header (lets runtime add boundary)", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        apiKey: "sk-test",
      });

      await provider.execute({ task: makeInpaintingTask() });

      const init = fetchMock.mock.calls[0][1];
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers).toBeDefined();
      expect(headers!["Content-Type"]).toBeUndefined();
      expect(headers!["Authorization"]).toBe("Bearer sk-test");
    });

    it("includes image, mask, prompt, model, and n in FormData", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { inpainting: "gpt-image-1" },
      });

      await provider.execute({ task: makeInpaintingTask("Replace with flowers") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;

      expect(formData.get("prompt")).toEqual(expect.stringContaining("Replace with flowers"));
      expect(formData.get("model")).toBe("gpt-image-1");
      expect(formData.get("n")).toBe("1");

      const imageBlob = formData.get("image") as File;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.name).toBe("image.png");

      const maskBlob = formData.get("mask") as File;
      expect(maskBlob).toBeInstanceOf(Blob);
      expect(maskBlob.name).toBe("mask.png");
    });

    it("includes explicit size and alignment guidance in inpainting prompt", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { inpainting: "gpt-image-1" },
      });

      await provider.execute({ task: makeInpaintingTask("Replace with flowers") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("Source image size: 512x512px");
      expect(prompt).toContain("Output image must be exactly 512x512px");
      expect(prompt).toContain("Preserve the original framing and keep all content aligned 1:1");
    });

    it("parses image artifact from response with purpose inpainted", async () => {
      const fetchMock = mockImagesEditsResponse("INPAINTED_DATA");
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeInpaintingTask() });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({
        kind: "image",
        mimeType: "image/png",
        data: "data:image/png;base64,INPAINTED_DATA",
        purpose: "inpainted",
      });
    });

    it("includes token-based cost estimation", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeInpaintingTask() });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.usage).toBeDefined();
      expect(result.usage!.totalTokens).toBe(150);
      expect(result.usage!.estimatedCostUsd).toBe(150 * 0.0000025);
    });

    it("returns failure on API error", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 500,
        body: { error: { message: "Server error", code: "internal_error" } },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeInpaintingTask() });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("provider_error");
      expect(result.error.retryable).toBe(true);
    });

    it("returns failure on transport error", async () => {
      const fetchMock = vi.fn<MockFetchFn>(async () => { throw new Error("connection refused"); });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeInpaintingTask() });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("transport_error");
      expect(result.error.retryable).toBe(true);
    });

    it("uses preferredModel when provided", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { inpainting: "gpt-image-1" },
      });

      await provider.execute({ task: makeInpaintingTask(), preferredModel: "dall-e-3" });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      expect(formData.get("model")).toBe("dall-e-3");
    });

    it("converts data URL images to Blobs with correct MIME type", async () => {
      const fetchMock = mockImagesEditsResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
      });

      await provider.execute({ task: makeInpaintingTask() });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const imageBlob = formData.get("image") as Blob;
      expect(imageBlob.type).toBe("image/png");
      const maskBlob = formData.get("mask") as Blob;
      expect(maskBlob.type).toBe("image/png");
    });

    it("returns failure when response has no image data", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [] },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeInpaintingTask() });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("invalid_response");
    });
  });

  // ─── Enhancement ─────────────────────────────────────────────────────

  describe("enhancement", () => {
    function makeEnhancementTask(
      operation: NonNullable<AiEnhancementTask["options"]>["operation"] = "auto-enhance",
      extra: { prompt?: string; scaleFactor?: number; referenceImages?: AiImageAsset[] } = {},
    ): AiEnhancementTask {
      return {
        id: "enh-1",
        family: "enhancement",
        prompt: extra.prompt,
        input: {
          image: makeImageAsset(),
          referenceImages: extra.referenceImages,
        },
        options: {
          operation,
          scaleFactor: extra.scaleFactor,
        },
      };
    }

    function mockImagesEditsEnhancementResponse(imageData = "ENHANCED_DATA") {
      return mockFetch({
        ok: true,
        status: 200,
        body: {
          created: "edit-enh-1",
          model: "gpt-image-1",
          data: [{ b64_json: imageData }],
          usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
        },
      });
    }

    it("sends request to /images/edits endpoint", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { enhancement: "gpt-image-1" },
      });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${TEST_ENDPOINT}/images/edits`);
      expect(init?.method).toBe("POST");
    });

    it("sends FormData body (not JSON)", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { enhancement: "gpt-image-1" },
      });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      const init = fetchMock.mock.calls[0][1];
      expect(init?.body).toBeInstanceOf(FormData);
    });

    it("does not set Content-Type header (lets runtime add boundary)", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        apiKey: "sk-test",
      });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      const init = fetchMock.mock.calls[0][1];
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers).toBeDefined();
      expect(headers!["Content-Type"]).toBeUndefined();
      expect(headers!["Authorization"]).toBe("Bearer sk-test");
    });

    it("includes image, prompt, model, and n in FormData (no mask)", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({
        endpoint: TEST_ENDPOINT,
        fetch: fetchMock,
        modelByFamily: { enhancement: "gpt-image-1" },
      });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;

      expect(formData.get("model")).toBe("gpt-image-1");
      expect(formData.get("n")).toBe("1");
      expect(formData.get("mask")).toBeNull();

      const imageBlob = formData.get("image") as File;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.name).toBe("image.png");

      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("Global system instruction:");
      expect(prompt).toContain("Tool workflow instruction:");
      expect(prompt).toContain("User instruction:");
      expect(prompt).toContain("in-context image editor enhancement assistant");
      expect(prompt).toContain("Output image must be exactly 512x512px");
      expect(prompt).toContain("Output only the edited image");
    });

    it("prompt varies by operation — auto-enhance", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/lighting|color balance|contrast|clarity/i);
    });

    it("prompt varies by operation — upscale", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("upscale", { scaleFactor: 2 }) });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/higher resolution|detail|sharpness/i);
    });

    it("upscale includes target dimensions in prompt", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("upscale", { scaleFactor: 3 }) });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/1536x1536/);
      expect(prompt).toContain("aligned 1:1 with the source image");
    });

    it("prompt varies by operation — denoise", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("denoise") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/noise|grain/i);
    });

    it("prompt varies by operation — restore", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("restore") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/restore|repair/i);
    });

    it("prompt varies by operation — colorize", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("colorize") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toMatch(/color/i);
    });

    it("prompt varies by operation — style-transfer uses custom prompt", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("style-transfer", { prompt: "Apply watercolor style" }) });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("User instruction:\nApply watercolor style");
      expect(prompt).not.toContain("Additional style direction from the user");
    });

    it("returns image artifact with correct purpose for auto-enhance", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse("ENHANCED_DATA");
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({
        kind: "image",
        mimeType: "image/png",
        data: "data:image/png;base64,ENHANCED_DATA",
        purpose: "enhanced",
      });
    });

    it("returns image artifact with purpose upscaled for upscale operation", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("upscale") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({ purpose: "upscaled" });
    });

    it("returns image artifact with purpose styled for style-transfer", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("style-transfer", { prompt: "oil painting" }) });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.artifacts[0]).toMatchObject({ purpose: "styled" });
    });

    it("includes source image as Blob in FormData", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const imageBlob = formData.get("image") as Blob;
      expect(imageBlob).toBeInstanceOf(Blob);
      expect(imageBlob.type).toBe("image/png");
    });

    it("mentions reference images in prompt when provided", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const refImages = [makeImageAsset("data:image/png;base64,REF1"), makeImageAsset("data:image/png;base64,REF2")];
      await provider.execute({ task: makeEnhancementTask("style-transfer", { prompt: "oil painting", referenceImages: refImages }) });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("The user supplied 2 reference images for style guidance, but this endpoint only receives the source image and this text instruction.");
      expect(prompt).toContain("Transfer the visual style from the reference images onto the source image while preserving the source image's subject, content, composition, and framing.");
      expect(prompt).toContain("Do not replace the source subject or copy the reference composition.");
      expect(prompt).toContain("Tool workflow instruction:");
    });

    it("style-transfer without references applies a stylized look without claiming reference transfer", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      await provider.execute({ task: makeEnhancementTask("style-transfer") });

      const init = fetchMock.mock.calls[0][1];
      const formData = init?.body as unknown as FormData;
      const prompt = formData.get("prompt") as string;
      expect(prompt).toContain("Apply a stylized look to the source image while preserving the source image's subject, content, composition, and framing.");
      expect(prompt).not.toContain("Transfer the visual style from the reference image");
    });

    it("includes token-based cost estimation", async () => {
      const fetchMock = mockImagesEditsEnhancementResponse();
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected success");
      expect(result.usage).toBeDefined();
      expect(result.usage!.totalTokens).toBe(150);
      expect(result.usage!.estimatedCostUsd).toBe(150 * 0.0000025);
    });

    it("returns failure on API error", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 429,
        body: { error: { message: "Rate limited", code: "rate_limit" } },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("provider_error");
      expect(result.error.message).toBe("Rate limited");
    });

    it("returns failure on transport error", async () => {
      const fetchMock = vi.fn<MockFetchFn>(async () => { throw new Error("timeout"); });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("transport_error");
      expect(result.error.retryable).toBe(true);
    });

    it("returns failure when response has no image data", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [] },
      });
      const provider = createOpenAiCompatibleProvider({ endpoint: TEST_ENDPOINT, fetch: fetchMock });

      const result = await provider.execute({ task: makeEnhancementTask("auto-enhance") });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("invalid_response");
    });
  });
});
