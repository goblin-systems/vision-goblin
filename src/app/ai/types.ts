export const AI_TASK_FAMILIES = ["segmentation", "inpainting", "enhancement", "generation", "captioning"] as const;

export const AI_INPUT_SCOPES = ["selected-layers", "visible-content"] as const;

export type AiInputScope = typeof AI_INPUT_SCOPES[number];

export type AiTaskFamily = typeof AI_TASK_FAMILIES[number];

export interface AiImageAsset {
  kind: "image";
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
}

export interface AiMaskAsset {
  kind: "mask";
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
}

export interface AiTextArtifact {
  kind: "text";
  role: "caption" | "message";
  text: string;
}

export interface AiImageArtifact {
  kind: "image";
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
  purpose?: "generated" | "enhanced" | "inpainted" | "background" | "styled" | "upscaled";
}

export interface AiMaskArtifact {
  kind: "mask";
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
  label?: string;
}

export type AiArtifact = AiTextArtifact | AiImageArtifact | AiMaskArtifact;

export interface AiSegmentationTask {
  id: string;
  family: "segmentation";
  prompt?: string;
  input: {
    image: AiImageAsset;
    subjectHint?: string;
  };
  options?: {
    mode?: "subject" | "background" | "object" | "background-removal";
  };
}

export interface AiInpaintingTask {
  id: string;
  family: "inpainting";
  prompt: string;
  input: {
    image: AiImageAsset;
    mask: AiMaskAsset;
  };
  options?: {
    mode?: "remove" | "replace";
  };
}

export interface AiEnhancementTask {
  id: string;
  family: "enhancement";
  prompt?: string;
  input: {
    image: AiImageAsset;
    referenceImages?: AiImageAsset[];
  };
  options?: {
    operation?: "auto-enhance" | "upscale" | "denoise" | "restore" | "colorize" | "style-transfer";
    intensity?: number;
    scaleFactor?: number;
  };
}

export interface AiGenerationTask {
  id: string;
  family: "generation";
  prompt: string;
  input?: {
    referenceImages?: AiImageAsset[];
  };
  options?: {
    width?: number;
    height?: number;
    imageCount?: number;
  };
}

export interface AiCaptioningTask {
  id: string;
  family: "captioning";
  prompt?: string;
  input: {
    image: AiImageAsset;
  };
  options?: {
    detail?: "brief" | "detailed";
  };
}

export type AiTask =
  | AiSegmentationTask
  | AiInpaintingTask
  | AiEnhancementTask
  | AiGenerationTask
  | AiCaptioningTask;
