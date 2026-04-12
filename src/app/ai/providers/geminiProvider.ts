import {
  createAiFailureResponse,
  createAiSuccessResponse,
  normalizeAiTaskError,
  type AiProviderAdapter,
  type AiDebugLogger,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiTaskUsage,
} from "../contracts";
import {
  createInspectionImageAsset,
  createInspectionMaskAsset,
  createInspectionRequestSnapshot,
  createInspectionResponseSnapshot,
} from "../inspection";
import type {
  AiArtifact,
  AiCaptioningTask,
  AiEnhancementTask,
  AiGuideMode,
  AiGenerationTask,
  AiImageAsset,
  AiImageArtifact,
  AiInpaintingTask,
  AiSegmentationTask,
  AiTask,
  AiTaskFamily,
  AiTextReplacementTask,
} from "../types";
import {
  defaultCaptionPrompt,
  defaultSegmentationUserPrompt,
  buildSegmentationSystemPrompt,
  buildSizeGuidance,
  getReferenceSourceSize,
  getEnhancementTargetSize,
  enhancementPurpose,
  buildGenerationPrompt,
  buildGuideSemanticsPrompt,
  buildInpaintingPromptContract,
  buildEnhancementPromptContract,
} from "../prompts";

// ── Types ───────────────────────────────────────────────────────────────

interface GeminiFetch {
  (input: string, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface GeminiProviderOptions {
  apiKey?: string;
  endpoint?: string;
  fetch?: GeminiFetch;
  log?: AiDebugLogger;
}

// ── Constants ───────────────────────────────────────────────────────────

const GEMINI_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_NATIVE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

const GEMINI_SUPPORTED_FAMILIES = ["segmentation", "inpainting", "enhancement", "generation", "captioning", "text-replacement"] as const;

const GEMINI_MODEL_BY_FAMILY: Record<AiTaskFamily, string> = {
  generation: "gemini-2.5-flash-image",
  captioning: "gemini-2.5-flash",
  "text-replacement": "gemini-2.5-flash-image",
  segmentation: "gemini-2.5-flash-image",
  inpainting: "gemini-2.5-flash-image",
  enhancement: "gemini-2.5-flash-image",
};

const PROVIDER_ID = "gemini";

// ── Provider factory ────────────────────────────────────────────────────

export function createGeminiProvider(options: GeminiProviderOptions): AiProviderAdapter {
  const endpoint = options.endpoint ?? GEMINI_DEFAULT_ENDPOINT;
  const fetchImpl = options.fetch ?? defaultFetch;

  return {
    id: PROVIDER_ID,
    displayName: "Google Gemini",
    supportedFamilies: GEMINI_SUPPORTED_FAMILIES,
    async execute<TTask extends AiTask>(request: AiProviderRequest<TTask>): Promise<AiProviderResponse<TTask>> {
      const family = request.task.family as AiTaskFamily;

      switch (family) {
        case "generation":
          return executeGeneration(fetchImpl, endpoint, options, request as AiProviderRequest<AiGenerationTask>) as Promise<AiProviderResponse<TTask>>;
        case "captioning":
          return executeCaptioning(fetchImpl, endpoint, options, request as AiProviderRequest<AiCaptioningTask>) as Promise<AiProviderResponse<TTask>>;
        case "segmentation":
          return executeSegmentation(fetchImpl, endpoint, options, request as AiProviderRequest<AiSegmentationTask>) as Promise<AiProviderResponse<TTask>>;
        case "inpainting":
          return executeInpainting(fetchImpl, endpoint, options, request as AiProviderRequest<AiInpaintingTask>) as Promise<AiProviderResponse<TTask>>;
        case "enhancement":
          return executeEnhancement(fetchImpl, endpoint, options, request as AiProviderRequest<AiEnhancementTask>) as Promise<AiProviderResponse<TTask>>;
        case "text-replacement":
          return executeTextReplacement(fetchImpl, endpoint, options, request as AiProviderRequest<AiTextReplacementTask>) as Promise<AiProviderResponse<TTask>>;
        default:
          return createAiFailureResponse(request, {
            providerId: PROVIDER_ID,
            error: {
              code: "unsupported_task",
              message: `Gemini provider does not support '${family}' tasks.`,
              retryable: false,
            },
          });
      }
    },
  };
}

// ── Generation ──────────────────────────────────────────────────────────

async function executeGeneration(
  fetchImpl: GeminiFetch,
  _endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiGenerationTask>,
): Promise<AiProviderResponse<AiGenerationTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY.generation;
    const aspectRatio = toGeminiAspectRatio(request.task.options?.width, request.task.options?.height);
    const prompt = buildGenerationPrompt(request.task);
    const requestInspection = createInspectionRequestSnapshot(
      prompt,
      (request.task.input?.referenceImages ?? []).map((asset, index) => createInspectionImageAsset(`reference ${index + 1}`, asset)),
    );

    // Build content parts: optional reference images (before text) + text prompt.
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    const referenceImages = request.task.input?.referenceImages;
    if (referenceImages && referenceImages.length > 0) {
      for (const ref of referenceImages) {
        parts.push({ inlineData: { mimeType: "image/png", data: stripDataUriPrefix(ref.data) } });
      }
    }

    parts.push({ text: prompt });

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
      },
    });
    const url = buildNativeUrl(model);
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildNativeHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      options.log?.(`[AI provider debug][gemini] Response payload (no images): ${JSON.stringify(payload)}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: parsed.text
            ? "Gemini did not generate an image. AI response: " + parsed.text
            : "Gemini generation response did not include any images.",
          retryable: false,
          aiMessage: parsed.text,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    const artifacts: AiArtifact[] = parsed.images.map((data) => ({
      kind: "image" as const,
      mimeType: "image/png",
      data,
      width: request.task.options?.width,
      height: request.task.options?.height,
      purpose: "generated" as const,
    }));

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      model: parsed.model,
      artifacts,
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateGenerationCostUsd(request),
          }
        : { estimatedCostUsd: estimateGenerationCostUsd(request) },
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, parsed.text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Captioning ──────────────────────────────────────────────────────────

async function executeCaptioning(
  fetchImpl: GeminiFetch,
  endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiCaptioningTask>,
): Promise<AiProviderResponse<AiCaptioningTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY.captioning;
    const prompt = request.task.prompt ?? defaultCaptionPrompt(request.task.options?.detail);
    const requestInspection = createInspectionRequestSnapshot(prompt, [createInspectionImageAsset("input image", request.task.input.image)]);

    const userContent: ChatContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: request.task.input.image.data } },
    ];

    const body = JSON.stringify({
      model,
      messages: [
        { role: "user", content: userContent },
      ],
    });
    const url = buildUrl(endpoint, "/chat/completions");
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseChatCompletionResponse(payload);
    const text = parsed.choice?.message?.content;
    if (!text) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini captioning response did not include text content.",
          retryable: false,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      providerTaskId: parsed.id,
      model: parsed.model,
      artifacts: [{ kind: "text", role: "caption", text }],
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateTokenCostUsd(parsed.usage),
          }
        : undefined,
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Segmentation ────────────────────────────────────────────────────────

async function executeSegmentation(
  fetchImpl: GeminiFetch,
  _endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiSegmentationTask>,
): Promise<AiProviderResponse<AiSegmentationTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY.segmentation;
    const mode = request.task.options?.mode ?? "subject";
    const systemPrompt = buildSegmentationSystemPrompt(mode, request.task.input.subjectHint);
    const userPrompt = request.task.prompt ?? defaultSegmentationUserPrompt();
    const combinedPrompt = `${systemPrompt}${buildSizeGuidance(request.task.input.image.width, request.task.input.image.height, request.task.input.image.width, request.task.input.image.height)}\n\n${userPrompt}`;
    const requestInspection = createInspectionRequestSnapshot(combinedPrompt, [createInspectionImageAsset("input image", request.task.input.image)]);
    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: combinedPrompt },
          { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.image.data) } },
        ],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    const url = buildNativeUrl(model);
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildNativeHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      options.log?.(`[AI provider debug][gemini] Response payload (no images): ${JSON.stringify(payload)}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: parsed.text
            ? "Gemini did not return a mask. AI response: " + parsed.text
            : "Gemini segmentation response did not include a mask image.",
          retryable: false,
          aiMessage: parsed.text,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    const modeLabel = mode === "background" ? "background" : mode === "object" ? "object" : "subject";

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      model: parsed.model,
      artifacts: [
        {
          kind: "mask",
          mimeType: "image/png",
          data: parsed.images[0],
          width: request.task.input.image.width,
          height: request.task.input.image.height,
          label: `${modeLabel}-mask`,
        },
      ],
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateTokenCostUsd(parsed.usage),
          }
        : undefined,
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, parsed.text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Inpainting ──────────────────────────────────────────────────────────

async function executeInpainting(
  fetchImpl: GeminiFetch,
  _endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiInpaintingTask>,
): Promise<AiProviderResponse<AiInpaintingTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY.inpainting;
    const guideMode = request.task.options?.guideMode;
    const inpaintingPromptContract = buildInpaintingPromptContract({
      guideMode,
      image: request.task.input.image,
    });

    const combinedPrompt = `${inpaintingPromptContract.systemPrompt}\n\n${inpaintingPromptContract.inputOrder}\n\n${request.task.prompt}`;
    const requestInspection = createInspectionRequestSnapshot(combinedPrompt, [
      createInspectionImageAsset("input image", request.task.input.image),
      createInspectionMaskAsset("mask", request.task.input.mask),
    ]);
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: combinedPrompt },
      { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.image.data) } },
      { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.mask.data) } },
    ];
    const body = JSON.stringify({
      contents: [{
        parts,
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    const url = buildNativeUrl(model);
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildNativeHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      options.log?.(`[AI provider debug][gemini] Response payload (no images): ${JSON.stringify(payload)}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: parsed.text
            ? "Gemini did not return an image. AI response: " + parsed.text
            : "Gemini inpainting response did not include an image.",
          retryable: false,
          aiMessage: parsed.text,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      model: parsed.model,
      artifacts: [
        {
          kind: "image",
          mimeType: "image/png",
          data: parsed.images[0],
          width: request.task.input.image.width,
          height: request.task.input.image.height,
          purpose: "inpainted",
        } satisfies AiImageArtifact,
      ],
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateTokenCostUsd(parsed.usage),
          }
        : undefined,
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, parsed.text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Enhancement ─────────────────────────────────────────────────────────

async function executeEnhancement(
  fetchImpl: GeminiFetch,
  _endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiEnhancementTask>,
): Promise<AiProviderResponse<AiEnhancementTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY.enhancement;
    const operation = request.task.options?.operation ?? "auto-enhance";
    const purpose = enhancementPurpose(operation);
    const sourceImage = request.task.input.image;
    const targetSize = getEnhancementTargetSize(request.task);
    const referenceImages = request.task.input.referenceImages;
    const promptContract = buildEnhancementPromptContract({
      operation,
      customPrompt: request.task.prompt,
      sourceImage,
      referenceImages,
      targetSize,
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    const requestInspection = createInspectionRequestSnapshot(promptContract.combinedPrompt, [
      createInspectionImageAsset("input image", sourceImage),
      ...(referenceImages ?? []).map((asset, index) => createInspectionImageAsset(`reference ${index + 1}`, asset)),
    ]);

    // Build content parts: text prompt + source image + optional reference images.
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: promptContract.combinedPrompt },
      { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(sourceImage.data) } },
    ];

    if (referenceImages && referenceImages.length > 0) {
      for (const ref of referenceImages) {
        parts.push({ inlineData: { mimeType: "image/png", data: stripDataUriPrefix(ref.data) } });
      }
    }

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    const url = buildNativeUrl(model);
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildNativeHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      options.log?.(`[AI provider debug][gemini] Response payload (no images): ${JSON.stringify(payload)}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: parsed.text
            ? "Gemini did not return an image. AI response: " + parsed.text
            : "Gemini enhancement response did not include an image.",
          retryable: false,
          aiMessage: parsed.text,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      model: parsed.model,
      artifacts: [
        {
          kind: "image",
          mimeType: "image/png",
          data: parsed.images[0],
          width: targetSize.width,
          height: targetSize.height,
          purpose,
        } satisfies AiImageArtifact,
      ],
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateTokenCostUsd(parsed.usage),
          }
        : undefined,
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, parsed.text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Text Replacement ────────────────────────────────────────────────────

async function executeTextReplacement(
  fetchImpl: GeminiFetch,
  _endpoint: string,
  options: GeminiProviderOptions,
  request: AiProviderRequest<AiTextReplacementTask>,
): Promise<AiProviderResponse<AiTextReplacementTask>> {
  try {
    const model = request.preferredModel ?? GEMINI_MODEL_BY_FAMILY["text-replacement"];
    const requestInspection = createInspectionRequestSnapshot(request.task.prompt, [
      createInspectionImageAsset("input image", request.task.input.image),
      createInspectionMaskAsset("mask", request.task.input.mask),
    ]);

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: request.task.prompt },
      { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.image.data) } },
      { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.mask.data) } },
    ];

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT"],
      },
    });
    const url = buildNativeUrl(model);
    logJsonRequest(options.log, PROVIDER_ID, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildNativeHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: extractProviderError(payload, response.status),
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload),
        },
      });
    }

    const parsed = parseNativeResponse(payload);

    if (!parsed.text) {
      options.log?.(`[AI provider debug][gemini] Response payload (no text): ${JSON.stringify(payload)}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini text replacement response did not include text.",
          retryable: false,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    const jsonText = extractJsonFromText(parsed.text);
    if (!jsonText) {
      options.log?.(`[AI provider debug][gemini] Response text did not contain valid JSON: ${parsed.text}`, "WARN");
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini text replacement response text did not contain valid JSON.",
          retryable: false,
          details: payload,
        },
        inspection: {
          request: requestInspection,
          response: createInspectionResponseSnapshot(payload, parsed.text),
        },
      });
    }

    return createAiSuccessResponse(request, {
      providerId: PROVIDER_ID,
      model: parsed.model,
      artifacts: [{
        kind: "json",
        role: "text-reconstruction",
        mimeType: "application/json",
        text: jsonText,
      }],
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateTokenCostUsd(parsed.usage),
          }
        : undefined,
      inspection: {
        request: requestInspection,
        response: createInspectionResponseSnapshot(payload, parsed.text),
      },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId: PROVIDER_ID,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Chat completion response parsing ────────────────────────────────────

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatChoice {
  message?: {
    content?: string;
    images?: Array<{ type?: string; image_url?: { url?: string } }>;
  };
}

interface ParsedChatCompletion {
  id?: string;
  model?: string;
  choice?: ChatChoice;
  usage?: AiTaskUsage;
}

function parseChatCompletionResponse(payload: unknown): ParsedChatCompletion {
  if (!payload || typeof payload !== "object") {
    throw {
      code: "invalid_response",
      message: "Gemini chat/completions response was not an object.",
      retryable: false,
      details: payload,
    };
  }

  const raw = payload as Record<string, unknown>;
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = choices.length > 0 ? (choices[0] as ChatChoice) : undefined;

  return {
    id: asOptionalString(raw.id),
    model: asOptionalString(raw.model),
    choice: firstChoice,
    usage: extractUsage(raw.usage),
  };
}

// ── Native generateContent response parsing ─────────────────────────────

interface NativePart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface ParsedNativeResponse {
  model?: string;
  images: string[];
  text?: string;
  usage?: AiTaskUsage;
}

function parseNativeResponse(payload: unknown): ParsedNativeResponse {
  if (!payload || typeof payload !== "object") {
    throw {
      code: "invalid_response",
      message: "Gemini generateContent response was not an object.",
      retryable: false,
      details: payload,
    };
  }

  const raw = payload as Record<string, unknown>;
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const firstCandidate = candidates.length > 0 ? (candidates[0] as Record<string, unknown>) : undefined;

  const images: string[] = [];
  const textParts: string[] = [];
  if (firstCandidate) {
    const content = firstCandidate.content as { parts?: NativePart[] } | undefined;
    if (content?.parts && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (part.inlineData?.data && typeof part.inlineData.data === "string") {
          const mimeType = part.inlineData.mimeType ?? "image/png";
          images.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
        if (part.text && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
  }

  let text: string | undefined = textParts.length > 0 ? textParts.join(" ") : undefined;

  if (!text && firstCandidate) {
    text = asOptionalString(firstCandidate.finishMessage);
  }

  if (!text) {
    const fallbackReasons: string[] = [];

    if (firstCandidate) {
      const finishReason = asOptionalString(firstCandidate.finishReason);
      if (finishReason && finishReason !== "STOP") {
        fallbackReasons.push(`Finish reason: ${finishReason}`);
      }
    }

    const promptFeedback = raw.promptFeedback as Record<string, unknown> | undefined;
    if (promptFeedback && typeof promptFeedback === "object") {
      const blockReason = asOptionalString(promptFeedback.blockReason);
      if (blockReason) {
        fallbackReasons.push(`Prompt blocked: ${blockReason}`);
      }
    }

    if (fallbackReasons.length > 0) {
      text = fallbackReasons.join(". ");
    }
  }

  return {
    model: asOptionalString(raw.modelVersion),
    images,
    text,
    usage: extractNativeUsage(raw.usageMetadata),
  };
}

function extractNativeUsage(usageMetadata: unknown): AiTaskUsage | undefined {
  if (!usageMetadata || typeof usageMetadata !== "object") {
    return undefined;
  }

  const candidate = usageMetadata as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  return {
    inputTokens: numberOrUndefined(candidate.promptTokenCount),
    outputTokens: numberOrUndefined(candidate.candidatesTokenCount),
    totalTokens: numberOrUndefined(candidate.totalTokenCount),
  };
}

// ── Native API helpers ──────────────────────────────────────────────────

function stripDataUriPrefix(dataUri: string): string {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex >= 0 && dataUri.startsWith("data:")) {
    return dataUri.slice(commaIndex + 1);
  }
  return dataUri;
}

const GEMINI_ASPECT_RATIOS: Array<{ ratio: string; value: number }> = [
  { ratio: "1:1", value: 1 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "9:16", value: 9 / 16 },
  { ratio: "16:9", value: 16 / 9 },
];

function toGeminiAspectRatio(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) {
    return undefined;
  }

  const target = width / height;
  let closest = GEMINI_ASPECT_RATIOS[0];
  let minDiff = Math.abs(target - closest.value);

  for (let i = 1; i < GEMINI_ASPECT_RATIOS.length; i++) {
    const diff = Math.abs(target - GEMINI_ASPECT_RATIOS[i].value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = GEMINI_ASPECT_RATIOS[i];
    }
  }

  return closest.ratio;
}

function buildNativeHeaders(options: GeminiProviderOptions): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(options.apiKey ? { "x-goog-api-key": options.apiKey } : {}),
  };
}

function buildNativeUrl(model: string): string {
  return `${GEMINI_NATIVE_ENDPOINT}/models/${model}:generateContent`;
}

// ── Shared helpers ──────────────────────────────────────────────────────

function buildHeaders(options: GeminiProviderOptions): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
  };
}

function buildUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/$/, "")}${path}`;
}

function logJsonRequest(log: AiDebugLogger | undefined, providerId: string, url: string, body: string): void {
  log?.(`[AI provider debug][${providerId}] Dispatching JSON request to ${url} with exact serialized body:\n${body}`);
}

function extractUsage(usage: unknown): AiTaskUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const candidate = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  return {
    inputTokens: numberOrUndefined(candidate.prompt_tokens),
    outputTokens: numberOrUndefined(candidate.completion_tokens),
    totalTokens: numberOrUndefined(candidate.total_tokens),
  };
}

function extractProviderError(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const candidate = payload as { error?: { message?: string; code?: string } };
    if (candidate.error) {
      return {
        code: "provider_error" as const,
        message: candidate.error.message ?? `Provider request failed with status ${status}.`,
        retryable: status >= 500,
        providerCode: candidate.error.code,
        details: payload,
      };
    }
  }

  return {
    code: "provider_error" as const,
    message: `Provider request failed with status ${status}.`,
    retryable: status >= 500,
    details: payload,
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

async function defaultFetch(input: string, init?: RequestInit) {
  return fetch(input, init);
}

// ── JSON extraction helper ──────────────────────────────────────────────

function extractJsonFromText(text: string): string | null {
  // Try direct parse first
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not direct JSON
  }

  // Try to extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // Invalid JSON inside fence
    }
  }

  // Try to find a JSON object in the text
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    const candidate = trimmed.slice(braceStart, braceEnd + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not valid JSON
    }
  }

  return null;
}

// ── Cost estimation ─────────────────────────────────────────────────────

function estimateGenerationCostUsd(request: AiProviderRequest<AiGenerationTask>): number {
  const imageCount = Math.max(1, request.task.options?.imageCount ?? 1);
  return imageCount * 0.04;
}

function estimateTokenCostUsd(usage: AiTaskUsage | undefined): number | undefined {
  if (typeof usage?.totalTokens !== "number") {
    return undefined;
  }
  return usage.totalTokens * 0.0000025;
}
