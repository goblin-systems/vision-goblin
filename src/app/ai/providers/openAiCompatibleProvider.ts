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

interface OpenAiCompatibleFetch {
  (input: string, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface OpenAiCompatibleProviderOptions {
  id?: string;
  displayName?: string;
  endpoint: string;
  apiKey?: string;
  fetch?: OpenAiCompatibleFetch;
  modelByFamily?: Partial<Record<AiTaskFamily, string>>;
  headers?: Record<string, string>;
  log?: AiDebugLogger;
}

const OPENAI_COMPATIBLE_FAMILIES = ["segmentation", "inpainting", "enhancement", "generation", "captioning"] as const;

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleProviderOptions): AiProviderAdapter {
  const providerId = options.id ?? "openai-compatible";
  const fetchImpl = options.fetch ?? defaultFetch;

  return {
    id: providerId,
    displayName: options.displayName ?? "OpenAI Compatible Provider",
    supportedFamilies: OPENAI_COMPATIBLE_FAMILIES,
    async execute<TTask extends AiTask>(request: AiProviderRequest<TTask>): Promise<AiProviderResponse<TTask>> {
      const family = request.task.family as AiTaskFamily;

      switch (family) {
        case "generation":
          return executeGeneration(fetchImpl, providerId, options, request as AiProviderRequest<AiGenerationTask>) as Promise<AiProviderResponse<TTask>>;
        case "captioning":
          return executeCaptioning(fetchImpl, providerId, options, request as AiProviderRequest<AiCaptioningTask>) as Promise<AiProviderResponse<TTask>>;
        case "segmentation":
          return executeSegmentation(fetchImpl, providerId, options, request as AiProviderRequest<AiSegmentationTask>) as Promise<AiProviderResponse<TTask>>;
        case "inpainting":
          return executeInpainting(fetchImpl, providerId, options, request as AiProviderRequest<AiInpaintingTask>) as Promise<AiProviderResponse<TTask>>;
        case "enhancement":
          return executeEnhancement(fetchImpl, providerId, options, request as AiProviderRequest<AiEnhancementTask>) as Promise<AiProviderResponse<TTask>>;
        default:
          return createAiFailureResponse(request, {
            providerId,
            error: {
              code: "unsupported_task",
              message: `OpenAI compatible provider does not support '${family}' tasks yet.`,
              retryable: false,
            },
          });
      }
    },
  };
}

// ── Generation ──────────────────────────────────────────────────────────

async function executeGeneration(
  fetchImpl: OpenAiCompatibleFetch,
  providerId: string,
  options: OpenAiCompatibleProviderOptions,
  request: AiProviderRequest<AiGenerationTask>,
): Promise<AiProviderResponse<AiGenerationTask>> {
  try {
    const model = request.preferredModel ?? options.modelByFamily?.generation ?? "";
    const hasReferenceImages = (request.task.input?.referenceImages?.length ?? 0) > 0;
    const prompt = buildGenerationPrompt(request.task);

    let response;

    if (hasReferenceImages) {
      // Use /images/edits endpoint when reference images are present.
      const formData = new FormData();
      const imageBlob = dataUrlToBlob(request.task.input!.referenceImages![0].data);
      formData.append("image", imageBlob, "image.png");
      formData.append("prompt", prompt);
      formData.append("model", model);
      formData.append("n", String(request.task.options?.imageCount ?? 1));
      const size = toImageSize(request.task.options?.width, request.task.options?.height);
      if (size) {
        formData.append("size", size);
      }

      const url = buildUrl(options.endpoint, "/images/edits");
      logMultipartRequest(options.log, providerId, url, prompt, {
        model,
        n: String(request.task.options?.imageCount ?? 1),
        ...(size ? { size } : {}),
      }, [
        createBinaryDescriptor("image", imageBlob, "image.png"),
      ]);

      response = await fetchImpl(url, {
        method: "POST",
        signal: request.signal,
        headers: buildAuthHeaders(options),
        body: formData as unknown as BodyInit,
      });
    } else {
      // Use /images/generations endpoint for text-only generation.
      const body = JSON.stringify({
        model,
        prompt,
        n: request.task.options?.imageCount ?? 1,
        size: toImageSize(request.task.options?.width, request.task.options?.height),
        output_format: "png",
      });
      const url = buildUrl(options.endpoint, "/images/generations");
      logJsonRequest(options.log, providerId, url, body);

      response = await fetchImpl(url, {
        method: "POST",
        signal: request.signal,
        headers: buildHeaders(options),
        body,
      });
    }

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId,
        error: extractProviderError(payload, response.status),
      });
    }

    const parsed = parseGenerationResponse(payload);
    return createAiSuccessResponse(request, {
      providerId,
      providerTaskId: parsed.providerTaskId,
      model: parsed.model,
      artifacts: parsed.artifacts.map((artifact) =>
        artifact.kind === "image"
          ? withImageArtifactSize(artifact, request.task.options?.width, request.task.options?.height)
          : artifact,
      ),
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateGenerationCostUsd(request),
          }
        : { estimatedCostUsd: estimateGenerationCostUsd(request) },
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Captioning ──────────────────────────────────────────────────────────

async function executeCaptioning(
  fetchImpl: OpenAiCompatibleFetch,
  providerId: string,
  options: OpenAiCompatibleProviderOptions,
  request: AiProviderRequest<AiCaptioningTask>,
): Promise<AiProviderResponse<AiCaptioningTask>> {
  try {
    const prompt = request.task.prompt ?? defaultCaptionPrompt(request.task.options?.detail);
    const body = JSON.stringify({
      model: request.preferredModel ?? options.modelByFamily?.captioning,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: request.task.input.image.data },
          ],
        },
      ],
    });
    const url = buildUrl(options.endpoint, "/responses");
    logJsonRequest(options.log, providerId, url, body);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildHeaders(options),
      body,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId,
        error: extractProviderError(payload, response.status),
      });
    }

    const parsed = parseCaptioningResponse(payload);
    return createAiSuccessResponse(request, {
      providerId,
      providerTaskId: parsed.providerTaskId,
      model: parsed.model,
      artifacts: parsed.artifacts,
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateCaptioningCostUsd(parsed.usage),
          }
        : undefined,
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

// ── Segmentation ────────────────────────────────────────────────────────

async function executeSegmentation(
  fetchImpl: OpenAiCompatibleFetch,
  providerId: string,
  options: OpenAiCompatibleProviderOptions,
  request: AiProviderRequest<AiSegmentationTask>,
): Promise<AiProviderResponse<AiSegmentationTask>> {
  try {
    const mode = request.task.options?.mode ?? "subject";
    const systemPrompt = buildSegmentationSystemPrompt(mode, request.task.input.subjectHint);
    const userPrompt = request.task.prompt ?? "Generate the segmentation mask for this image.";
    const prompt = `${systemPrompt}${buildSizeGuidance(request.task.input.image.width, request.task.input.image.height, request.task.input.image.width, request.task.input.image.height)}\n\n${userPrompt}`;

    const formData = new FormData();
    const imageBlob = dataUrlToBlob(request.task.input.image.data);
    const model = request.preferredModel ?? options.modelByFamily?.segmentation ?? "";
    formData.append("image", imageBlob, "image.png");
    formData.append("prompt", prompt);
    formData.append("model", model);
    formData.append("n", "1");

    const url = buildUrl(options.endpoint, "/images/edits");
    logMultipartRequest(options.log, providerId, url, prompt, {
      model,
      n: "1",
    }, [
      createBinaryDescriptor("image", imageBlob, "image.png"),
    ]);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildAuthHeaders(options),
      body: formData as unknown as BodyInit,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId,
        error: extractProviderError(payload, response.status),
      });
    }

    const parsed = parseGenerationResponse(payload);
    const modeLabel = mode === "background" ? "background" : mode === "object" ? "object" : "subject";

    return createAiSuccessResponse(request, {
      providerId,
      providerTaskId: parsed.providerTaskId,
      model: parsed.model,
      artifacts: parsed.artifacts.map((a) => ({
        kind: "mask" as const,
        mimeType: a.kind === "image" ? (a as AiImageArtifact).mimeType : "image/png",
        data: a.kind === "image" ? (a as AiImageArtifact).data : "",
        width: request.task.input.image.width,
        height: request.task.input.image.height,
        label: `${modeLabel}-mask`,
      })),
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateSegmentationCostUsd(parsed.usage),
          }
        : undefined,
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
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

// ── Inpainting ──────────────────────────────────────────────────────────

async function executeInpainting(
  fetchImpl: OpenAiCompatibleFetch,
  providerId: string,
  options: OpenAiCompatibleProviderOptions,
  request: AiProviderRequest<AiInpaintingTask>,
): Promise<AiProviderResponse<AiInpaintingTask>> {
  try {
    const prompt = buildInpaintingPrompt(request.task);
    const formData = new FormData();
    const imageBlob = dataUrlToBlob(request.task.input.image.data);
    const maskBlob = dataUrlToBlob(request.task.input.mask.data);
    const model = request.preferredModel ?? options.modelByFamily?.inpainting ?? "";
    formData.append("image", imageBlob, "image.png");
    formData.append("mask", maskBlob, "mask.png");
    formData.append("prompt", prompt);
    formData.append("model", model);
    formData.append("n", "1");

    const url = buildUrl(options.endpoint, "/images/edits");
    logMultipartRequest(options.log, providerId, url, prompt, {
      model,
      n: "1",
    }, [
      createBinaryDescriptor("image", imageBlob, "image.png"),
      createBinaryDescriptor("mask", maskBlob, "mask.png"),
    ]);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildAuthHeaders(options),
      body: formData as unknown as BodyInit,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId,
        error: extractProviderError(payload, response.status),
      });
    }

    const parsed = parseGenerationResponse(payload);
    return createAiSuccessResponse(request, {
      providerId,
      providerTaskId: parsed.providerTaskId,
      model: parsed.model,
      artifacts: parsed.artifacts.map((a) => ({
        ...withImageArtifactSize(a as AiImageArtifact, request.task.input.image.width, request.task.input.image.height),
        purpose: "inpainted" as const,
      })),
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateInpaintingCostUsd(parsed.usage),
          }
        : undefined,
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64Data] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ── Enhancement ─────────────────────────────────────────────────────────

async function executeEnhancement(
  fetchImpl: OpenAiCompatibleFetch,
  providerId: string,
  options: OpenAiCompatibleProviderOptions,
  request: AiProviderRequest<AiEnhancementTask>,
): Promise<AiProviderResponse<AiEnhancementTask>> {
  try {
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
      referenceTransport: "text-only-hint",
      buildSizeGuidance,
    });
    const prompt = promptContract.combinedPrompt;

    const formData = new FormData();
    const imageBlob = dataUrlToBlob(sourceImage.data);
    const model = request.preferredModel ?? options.modelByFamily?.enhancement ?? "";
    formData.append("image", imageBlob, "image.png");
    formData.append("prompt", prompt);
    formData.append("model", model);
    formData.append("n", "1");

    const url = buildUrl(options.endpoint, "/images/edits");
    logMultipartRequest(options.log, providerId, url, prompt, {
      model,
      n: "1",
    }, [
      createBinaryDescriptor("image", imageBlob, "image.png"),
    ]);

    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: buildAuthHeaders(options),
      body: formData as unknown as BodyInit,
    });

    const payload = await response.json();
    if (!response.ok) {
      return createAiFailureResponse(request, {
        providerId,
        error: extractProviderError(payload, response.status),
      });
    }

    const parsed = parseGenerationResponse(payload);
    return createAiSuccessResponse(request, {
      providerId,
      providerTaskId: parsed.providerTaskId,
      model: parsed.model,
      artifacts: parsed.artifacts.map((a) => ({
        ...withImageArtifactSize(a as AiImageArtifact, targetSize.width, targetSize.height),
        purpose,
      })),
      usage: parsed.usage
        ? {
            ...parsed.usage,
            estimatedCostUsd: estimateEnhancementCostUsd(parsed.usage),
          }
        : undefined,
    });
  } catch (error) {
    return createAiFailureResponse(request, {
      providerId,
      error: normalizeAiTaskError(error, {
        code: "transport_error",
        retryable: true,
      }),
    });
  }
}

function buildGenerationPrompt(task: AiGenerationTask): string {
  const sourceSize = getReferenceSourceSize(task.input?.referenceImages);
  const width = task.options?.width;
  const height = task.options?.height;
  const hasReferenceImages = (task.input?.referenceImages?.length ?? 0) > 0;
  const sizeGuidance = buildSizeGuidance(sourceSize?.width, sourceSize?.height, width, height, hasReferenceImages);
  return `${task.prompt}${sizeGuidance}`;
}

function buildInpaintingPrompt(task: AiInpaintingTask): string {
  const sizeGuidance = buildSizeGuidance(
    task.input.image.width,
    task.input.image.height,
    task.input.image.width,
    task.input.image.height,
    true,
  );
  return `${task.prompt}${sizeGuidance}`;
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

function withImageArtifactSize<TArtifact extends AiImageArtifact>(artifact: TArtifact, width?: number, height?: number): TArtifact {
  return {
    ...artifact,
    width: width ?? artifact.width,
    height: height ?? artifact.height,
  };
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

// ── Shared helpers ──────────────────────────────────────────────────────

function buildHeaders(options: OpenAiCompatibleProviderOptions): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    ...options.headers,
  };
}

function buildAuthHeaders(options: OpenAiCompatibleProviderOptions): Record<string, string> {
  return {
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    ...options.headers,
  };
}

function buildUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/$/, "")}${path}`;
}

interface BinaryDescriptor {
  name: string;
  filename: string;
  mimeType: string;
  size: number;
}

function createBinaryDescriptor(name: string, blob: Blob, filename: string): BinaryDescriptor {
  return {
    name,
    filename,
    mimeType: blob.type || "application/octet-stream",
    size: blob.size,
  };
}

function logJsonRequest(log: AiDebugLogger | undefined, providerId: string, url: string, body: string): void {
  log?.(`[AI provider debug][${providerId}] Dispatching JSON request to ${url} with exact serialized body:\n${body}`);
}

function logMultipartRequest(
  log: AiDebugLogger | undefined,
  providerId: string,
  url: string,
  prompt: string,
  textFields: Record<string, string>,
  binaryParts: BinaryDescriptor[],
): void {
  const payload = JSON.stringify({
    prompt,
    textFields,
    binaryParts,
  });
  log?.(
    `[AI provider debug][${providerId}] Dispatching multipart/form-data request to ${url}. Raw multipart body is not directly available from FormData without re-encoding, so this log includes the exact composed prompt, exact text fields, and binary descriptors:\n${payload}`,
  );
}

const OPENAI_IMAGE_SIZES = [
  { w: 1024, h: 1024, label: "1024x1024" },
  { w: 1024, h: 1536, label: "1024x1536" },
  { w: 1536, h: 1024, label: "1536x1024" },
] as const;

function toImageSize(width?: number, height?: number): string | undefined {
  if (!width || !height) {
    return undefined;
  }

  // Find the closest valid size by aspect ratio, then total pixel area.
  const targetAspect = width / height;
  let best: (typeof OPENAI_IMAGE_SIZES)[number] = OPENAI_IMAGE_SIZES[0];
  let bestScore = Infinity;

  for (const size of OPENAI_IMAGE_SIZES) {
    const sizeAspect = size.w / size.h;
    const aspectDiff = Math.abs(targetAspect - sizeAspect);
    const areaDiff = Math.abs(width * height - size.w * size.h);
    // Prioritize aspect ratio match, then area proximity.
    const score = aspectDiff * 10_000_000 + areaDiff;
    if (score < bestScore) {
      bestScore = score;
      best = size;
    }
  }

  return best.label;
}

function defaultCaptionPrompt(detail?: "brief" | "detailed"): string {
  return detail === "brief" ? "Write a brief caption for this image." : "Describe this image in detail.";
}

function parseGenerationResponse(payload: unknown): {
  providerTaskId?: string;
  model?: string;
  artifacts: AiArtifact[];
  usage?: AiTaskUsage;
} {
  if (!payload || typeof payload !== "object") {
    throw {
      code: "invalid_response",
      message: "OpenAI compatible image response was not an object.",
      retryable: false,
      details: payload,
    };
  }

  const data = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: Array<{ b64_json?: string; url?: string }> }).data : [];
  if (!data.length) {
    throw {
      code: "invalid_response",
      message: "OpenAI compatible image response did not include image data.",
      retryable: false,
      details: payload,
    };
  }

  return {
    providerTaskId: stringifyOptionalValue((payload as { created?: number | string }).created),
    model: asOptionalString((payload as { model?: string }).model),
    artifacts: data.map((entry) => ({
      kind: "image" as const,
      mimeType: "image/png",
      data: entry.b64_json ? `data:image/png;base64,${entry.b64_json}` : entry.url ?? "",
      purpose: "generated" as const,
    })),
    usage: extractUsage((payload as { usage?: unknown }).usage),
  };
}

function parseCaptioningResponse(payload: unknown): {
  providerTaskId?: string;
  model?: string;
  artifacts: AiArtifact[];
  usage?: AiTaskUsage;
} {
  if (!payload || typeof payload !== "object") {
    throw {
      code: "invalid_response",
      message: "OpenAI compatible caption response was not an object.",
      retryable: false,
      details: payload,
    };
  }

  const outputText = asOptionalString((payload as { output_text?: string }).output_text);
  const text = outputText ?? findFirstTextOutput((payload as { output?: unknown }).output);
  if (!text) {
    throw {
      code: "invalid_response",
      message: "OpenAI compatible caption response did not include text output.",
      retryable: false,
      details: payload,
    };
  }

  return {
    providerTaskId: asOptionalString((payload as { id?: string }).id),
    model: asOptionalString((payload as { model?: string }).model),
    artifacts: [{ kind: "text", role: "caption", text }],
    usage: extractUsage((payload as { usage?: unknown }).usage),
  };
}

function extractUsage(usage: unknown): AiTaskUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const candidate = usage as { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  return {
    inputTokens: numberOrUndefined(candidate.input_tokens),
    outputTokens: numberOrUndefined(candidate.output_tokens),
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

function findFirstTextOutput(output: unknown): string | undefined {
  if (!Array.isArray(output)) {
    return undefined;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const text = asOptionalString((entry as { text?: string }).text);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringifyOptionalValue(value: unknown): string | undefined {
  if (typeof value === "number") {
    return String(value);
  }
  return asOptionalString(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

async function defaultFetch(input: string, init?: RequestInit) {
  return fetch(input, init);
}

function estimateGenerationCostUsd(request: AiProviderRequest<AiGenerationTask>): number {
  const imageCount = Math.max(1, request.task.options?.imageCount ?? 1);
  return imageCount * 0.04;
}

function estimateCaptioningCostUsd(usage: AiTaskUsage | undefined): number | undefined {
  if (typeof usage?.totalTokens !== "number") {
    return undefined;
  }
  return usage.totalTokens * 0.0000025;
}

function estimateSegmentationCostUsd(usage: AiTaskUsage | undefined): number | undefined {
  if (typeof usage?.totalTokens !== "number") {
    return undefined;
  }
  return usage.totalTokens * 0.0000025;
}

function estimateInpaintingCostUsd(usage: AiTaskUsage | undefined): number | undefined {
  if (typeof usage?.totalTokens !== "number") {
    return undefined;
  }
  return usage.totalTokens * 0.0000025;
}

function estimateEnhancementCostUsd(usage: AiTaskUsage | undefined): number | undefined {
  if (typeof usage?.totalTokens !== "number") {
    return undefined;
  }
  return usage.totalTokens * 0.0000025;
}
