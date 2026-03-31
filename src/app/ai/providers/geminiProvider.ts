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
import type {
  AiArtifact,
  AiCaptioningTask,
  AiEnhancementTask,
  AiGenerationTask,
  AiImageAsset,
  AiImageArtifact,
  AiInpaintingTask,
  AiSegmentationTask,
  AiTask,
  AiTaskFamily,
} from "../types";
import { buildEnhancementPromptContract } from "./enhancementPrompt";

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

const GEMINI_SUPPORTED_FAMILIES = ["segmentation", "inpainting", "enhancement", "generation", "captioning"] as const;

const GEMINI_MODEL_BY_FAMILY: Record<AiTaskFamily, string> = {
  generation: "gemini-2.5-flash-image",
  captioning: "gemini-2.5-flash",
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
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini generation response did not include any images.",
          retryable: false,
          details: payload,
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
    const userPrompt = request.task.prompt ?? "Generate the segmentation mask for this image.";
    const combinedPrompt = `${systemPrompt}${buildSizeGuidance(request.task.input.image.width, request.task.input.image.height, request.task.input.image.width, request.task.input.image.height)}\n\n${userPrompt}`;
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
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini segmentation response did not include a mask image.",
          retryable: false,
          details: payload,
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

    const systemPrompt =
      "You are an image editing assistant. You will receive a source image and a mask image. " +
      "The mask shows the region to edit: white pixels mark the area to modify, black pixels mark the area to keep unchanged. " +
      "Generate a new version of the source image where only the masked region is modified according to the user's prompt. " +
      "Preserve the unmasked areas exactly. Output only the edited image." +
      buildSizeGuidance(
        request.task.input.image.width,
        request.task.input.image.height,
        request.task.input.image.width,
        request.task.input.image.height,
        true,
      );

    const combinedPrompt = `${systemPrompt}\n\n${request.task.prompt}`;
    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: combinedPrompt },
          { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.image.data) } },
          { inlineData: { mimeType: "image/png", data: stripDataUriPrefix(request.task.input.mask.data) } },
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
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini inpainting response did not include an image.",
          retryable: false,
          details: payload,
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
      });
    }

    const parsed = parseNativeResponse(payload);
    if (!parsed.images.length) {
      return createAiFailureResponse(request, {
        providerId: PROVIDER_ID,
        error: {
          code: "invalid_response",
          message: "Gemini enhancement response did not include an image.",
          retryable: false,
          details: payload,
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

// ── Prompt builders ─────────────────────────────────────────────────────

function defaultCaptionPrompt(detail?: "brief" | "detailed"): string {
  return detail === "brief" ? "Write a brief caption for this image." : "Describe this image in detail.";
}

function buildSegmentationSystemPrompt(
  mode: NonNullable<AiSegmentationTask["options"]>["mode"],
  subjectHint?: string,
): string {
  switch (mode) {
    case "subject":
      return "You are an image segmentation assistant. Generate a binary black-and-white mask image where white pixels represent the main subject of the image and black pixels represent everything else. Return a mask aligned 1:1 with the source image at the exact same pixel dimensions so every mask pixel maps to the same source pixel. Output only the mask image.";
    case "background":
      return "You are an image segmentation assistant. Generate a binary black-and-white mask image where white pixels represent the background of the image and black pixels represent the foreground subject. Return a mask aligned 1:1 with the source image at the exact same pixel dimensions so every mask pixel maps to the same source pixel. Output only the mask image.";
    case "object":
      return `You are an image segmentation assistant. Generate a binary black-and-white mask image that isolates a specific object in the image. ${subjectHint ? `The object to isolate: "${subjectHint}".` : "Identify the most prominent object."} White pixels represent the object and black pixels represent everything else. Return a mask aligned 1:1 with the source image at the exact same pixel dimensions so every mask pixel maps to the same source pixel. Output only the mask image.`;
    case "background-removal":
      return "You are an image segmentation assistant. Generate a binary black-and-white mask image where white pixels represent the main subject of the image suitable for background removal. Black pixels represent the background to be removed. Return a mask aligned 1:1 with the source image at the exact same pixel dimensions so every mask pixel maps to the same source pixel. Output only the mask image.";
    default:
      return "You are an image segmentation assistant. Generate a binary black-and-white mask image of the main subject. Return a mask aligned 1:1 with the source image at the exact same pixel dimensions so every mask pixel maps to the same source pixel. Output only the mask image.";
  }
}

function buildGenerationPrompt(task: AiGenerationTask): string {
  const sourceSize = getReferenceSourceSize(task.input?.referenceImages);
  return `${task.prompt}${buildSizeGuidance(sourceSize?.width, sourceSize?.height, task.options?.width, task.options?.height, (task.input?.referenceImages?.length ?? 0) > 0)}`;
}

function buildSizeGuidance(
  sourceWidth?: number,
  sourceHeight?: number,
  targetWidth?: number,
  targetHeight?: number,
  preserveAlignment = false,
): string {
  const parts: string[] = [];
  if (sourceWidth && sourceHeight) {
    parts.push(`Source image size: ${sourceWidth}x${sourceHeight}px.`);
  }
  if (targetWidth && targetHeight) {
    parts.push(`Output image must be exactly ${targetWidth}x${targetHeight}px.`);
  }
  if (preserveAlignment) {
    parts.push("Preserve the original framing and keep all content aligned 1:1 with the source image; do not crop, pad, shift, or re-center the result.");
  }
  return parts.length ? `\n\nLayout requirements: ${parts.join(" ")}` : "";
}

function getReferenceSourceSize(referenceImages?: AiImageAsset[]) {
  const firstReference = referenceImages?.[0];
  if (!firstReference?.width || !firstReference?.height) {
    return undefined;
  }
  return {
    width: firstReference.width,
    height: firstReference.height,
  };
}

function getEnhancementTargetSize(task: AiEnhancementTask): { width?: number; height?: number } {
  const width = task.input.image.width;
  const height = task.input.image.height;
  if (task.options?.operation === "upscale" && width && height) {
    const factor = task.options.scaleFactor ?? 2;
    return { width: width * factor, height: height * factor };
  }
  return { width, height };
}

function enhancementPurpose(
  operation: NonNullable<AiEnhancementTask["options"]>["operation"],
): AiImageArtifact["purpose"] {
  switch (operation) {
    case "upscale":
      return "upscaled";
    case "style-transfer":
      return "styled";
    case "auto-enhance":
    case "denoise":
    case "restore":
    case "colorize":
    default:
      return "enhanced";
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
  if (firstCandidate) {
    const content = firstCandidate.content as { parts?: NativePart[] } | undefined;
    if (content?.parts && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (part.inlineData?.data && typeof part.inlineData.data === "string") {
          const mimeType = part.inlineData.mimeType ?? "image/png";
          images.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
      }
    }
  }

  return {
    model: asOptionalString(raw.modelVersion),
    images,
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
