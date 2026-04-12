import type { AiImageAsset, AiMaskAsset, AiTask } from "./types";
import { buildInpaintingPromptContract } from "./prompts/provider";

export interface AiInspectionAssetSnapshot {
  kind: "image" | "mask";
  label: string;
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
}

export interface AiProviderRequestInspectionSnapshot {
  prompt?: string;
  assets: AiInspectionAssetSnapshot[];
}

export interface AiProviderResponseInspectionSnapshot {
  rawPayload?: unknown;
  returnedContent?: string;
}

export interface AiProviderDebugInspection {
  request?: AiProviderRequestInspectionSnapshot;
  response?: AiProviderResponseInspectionSnapshot;
}

export interface AiJobInspectionData {
  task: AiTask;
  providerId?: string;
  model?: string;
  request?: AiProviderRequestInspectionSnapshot;
  response?: AiProviderResponseInspectionSnapshot;
}

export function snapshotAiTaskForInspection(task: AiTask): AiTask {
  return structuredClone(task);
}

export function createInspectionImageAsset(label: string, asset: AiImageAsset): AiInspectionAssetSnapshot {
  return {
    kind: "image",
    label,
    mimeType: asset.mimeType,
    data: asset.data,
    width: asset.width,
    height: asset.height,
  };
}

export function createInspectionMaskAsset(label: string, asset: AiMaskAsset): AiInspectionAssetSnapshot {
  return {
    kind: "mask",
    label,
    mimeType: asset.mimeType,
    data: asset.data,
    width: asset.width,
    height: asset.height,
  };
}

export function createInspectionRequestSnapshot(
  prompt: string | undefined,
  assets: AiInspectionAssetSnapshot[],
): AiProviderRequestInspectionSnapshot {
  return {
    prompt,
    assets,
  };
}

export function createInspectionRequestSnapshotFromTask(task: AiTask): AiProviderRequestInspectionSnapshot {
  if (task.family === "inpainting") {
    const contract = buildInpaintingPromptContract({
      guideMode: task.options?.guideMode,
      image: task.input.image,
    });
    const combinedPrompt = `${contract.systemPrompt}\n\n${contract.inputOrder}\n\n${task.prompt}`;
    return createInspectionRequestSnapshot(combinedPrompt, createInspectionAssetsFromTask(task));
  }
  return createInspectionRequestSnapshot(task.prompt, createInspectionAssetsFromTask(task));
}

export function createInspectionAssetsFromTask(task: AiTask): AiInspectionAssetSnapshot[] {
  switch (task.family) {
    case "segmentation":
      return [createInspectionImageAsset("input image", task.input.image)];
    case "inpainting":
      return [
        createInspectionImageAsset("input image", task.input.image),
        createInspectionMaskAsset("mask", task.input.mask),
      ];
    case "enhancement":
      return [
        createInspectionImageAsset("input image", task.input.image),
        ...(task.input.referenceImages ?? []).map((asset, index) => createInspectionImageAsset(`reference ${index + 1}`, asset)),
      ];
    case "generation":
      return (task.input?.referenceImages ?? []).map((asset, index) => createInspectionImageAsset(`reference ${index + 1}`, asset));
    case "captioning":
      return [createInspectionImageAsset("input image", task.input.image)];
    default:
      return [];
  }
}

export function createInspectionResponseSnapshot(
  rawPayload: unknown,
  returnedContent?: string,
): AiProviderResponseInspectionSnapshot {
  return {
    rawPayload: sanitizeInspectionPayload(rawPayload),
    returnedContent,
  };
}

export function sanitizeInspectionPayload(payload: unknown): unknown {
  return sanitizeInspectionValue(payload);
}

function sanitizeInspectionValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      const commaIndex = value.indexOf(",");
      const descriptor = commaIndex >= 0 ? value.slice(0, commaIndex) : "data payload";
      return `[omitted ${descriptor}]`;
    }
    if (key === "b64_json" && looksLikeBase64(value)) {
      return `[omitted base64 payload, ${value.length} chars]`;
    }
    if (key === "data" && value.length > 120 && looksLikeBase64(value)) {
      return `[omitted base64 payload, ${value.length} chars]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeInspectionValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(candidate)) {
    sanitized[entryKey] = sanitizeInspectionValue(entryValue, entryKey);
  }
  return sanitized;
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}
