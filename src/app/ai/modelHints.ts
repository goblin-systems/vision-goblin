import type { AiTaskFamily } from "./types";

export interface ModelHint {
  pattern: string | RegExp;
  capabilities: readonly AiTaskFamily[];
  displayName?: string;
}

export const OPENAI_MODEL_HINTS: readonly ModelHint[] = [
  // Image generation models
  { pattern: /^gpt-image-1/, capabilities: ["generation", "inpainting", "enhancement"], displayName: "GPT Image 1" },
  { pattern: /^dall-e-3/, capabilities: ["generation"], displayName: "DALL-E 3" },
  { pattern: /^dall-e-2/, capabilities: ["generation"], displayName: "DALL-E 2" },

  // Vision + text models (can do captioning and segmentation)
  { pattern: /^gpt-4o/, capabilities: ["captioning", "segmentation", "inpainting", "enhancement"], displayName: "GPT-4o" },
  { pattern: /^gpt-4\.1/, capabilities: ["captioning", "segmentation"], displayName: "GPT-4.1" },
  { pattern: /^gpt-4-turbo/, capabilities: ["captioning", "segmentation"] },
  { pattern: /^gpt-4-vision/, capabilities: ["captioning", "segmentation"] },

  // Text-only models (no image capabilities relevant to us)
  { pattern: /^gpt-3\.5/, capabilities: [] },
  { pattern: /^gpt-4$/, capabilities: [] },
];

/**
 * Classify an OpenAI model by matching against known hints.
 * Returns the capabilities array, or an empty array if no match.
 */
export function classifyOpenAiModel(modelId: string): readonly AiTaskFamily[] {
  for (const hint of OPENAI_MODEL_HINTS) {
    if (matchesHint(hint.pattern, modelId)) {
      return hint.capabilities;
    }
  }
  return [];
}

/**
 * Get a human-friendly display name for an OpenAI model,
 * or return the raw modelId if no hint matches.
 */
export function getOpenAiModelDisplayName(modelId: string): string {
  for (const hint of OPENAI_MODEL_HINTS) {
    if (matchesHint(hint.pattern, modelId) && hint.displayName) {
      return hint.displayName;
    }
  }
  return modelId;
}

function matchesHint(pattern: string | RegExp, modelId: string): boolean {
  if (typeof pattern === "string") {
    return modelId === pattern;
  }
  return pattern.test(modelId);
}
