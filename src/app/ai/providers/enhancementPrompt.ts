import type { AiEnhancementTask, AiImageAsset } from "../types";

type EnhancementOperation = NonNullable<AiEnhancementTask["options"]>["operation"];
type ReferenceTransport = "embedded-images" | "text-only-hint";

export interface EnhancementPromptContract {
  globalSystemInstruction: string;
  toolWorkflowInstruction: string;
  userInstruction: string;
  combinedPrompt: string;
}

export interface BuildEnhancementPromptContractOptions {
  operation: EnhancementOperation;
  customPrompt?: string;
  sourceImage: AiImageAsset;
  referenceImages?: AiImageAsset[];
  targetSize: {
    width?: number;
    height?: number;
  };
  referenceTransport: ReferenceTransport;
  buildSizeGuidance: (
    sourceWidth?: number,
    sourceHeight?: number,
    targetWidth?: number,
    targetHeight?: number,
    preserveAlignment?: boolean,
  ) => string;
}

export function buildEnhancementPromptContract(options: BuildEnhancementPromptContractOptions): EnhancementPromptContract {
  const globalSystemInstruction = buildEnhancementGlobalSystemInstruction();
  const toolWorkflowInstruction = buildEnhancementToolWorkflowInstruction(options);
  const userInstruction = buildEnhancementUserInstruction(options.customPrompt);

  return {
    globalSystemInstruction,
    toolWorkflowInstruction,
    userInstruction,
    combinedPrompt: [
      "Global system instruction:",
      globalSystemInstruction,
      "",
      "Tool workflow instruction:",
      toolWorkflowInstruction,
      "",
      "User instruction:",
      userInstruction,
    ].join("\n"),
  };
}

function buildEnhancementGlobalSystemInstruction(): string {
  return "You are an in-context image editor enhancement assistant. Output only the edited image.";
}

function buildEnhancementToolWorkflowInstruction(options: BuildEnhancementPromptContractOptions): string {
  const { sourceImage, targetSize, buildSizeGuidance } = options;
  return `${buildOperationWorkflowInstruction(options)}${buildSizeGuidance(sourceImage.width, sourceImage.height, targetSize.width, targetSize.height, true)}`;
}

function buildOperationWorkflowInstruction(options: BuildEnhancementPromptContractOptions): string {
  const { operation, referenceImages, referenceTransport } = options;

  switch (operation) {
    case "auto-enhance":
      return "Enhance the source image by improving lighting, color balance, contrast, and clarity while preserving the original content and composition.";
    case "upscale":
      return "Recreate the source image at higher resolution with stronger detail and sharpness while preserving the original content and composition.";
    case "denoise":
      return "Remove noise and grain from the source image while preserving detail, texture, and sharpness.";
    case "restore":
      return "Restore and repair the source image, fixing visible degradation, artifacts, or damage while preserving the original content and composition.";
    case "colorize":
      return "Add realistic color to the source image while preserving its original details, subject, and composition.";
    case "style-transfer":
      return buildStyleTransferWorkflowInstruction(referenceImages, referenceTransport);
    default:
      return "Enhance the source image while preserving the original content and composition.";
  }
}

function buildEnhancementUserInstruction(customPrompt?: string): string {
  return customPrompt?.trim() ?? "";
}

function buildStyleTransferWorkflowInstruction(
  referenceImages: AiImageAsset[] | undefined,
  referenceTransport: ReferenceTransport,
): string {
  const referenceCount = referenceImages?.length ?? 0;

  if (referenceCount > 0) {
    const referenceInstruction = referenceTransport === "embedded-images"
      ? `Use the provided reference image${referenceCount === 1 ? "" : "s"} only as visual style guidance.`
      : `The user supplied ${referenceCount} reference image${referenceCount === 1 ? "" : "s"} for style guidance, but this endpoint only receives the source image and this text instruction.`;

    return `${referenceInstruction} Transfer the visual style from the reference image${referenceCount === 1 ? "" : "s"} onto the source image while preserving the source image's subject, content, composition, and framing. Do not replace the source subject or copy the reference composition.`;
  }

  return "Apply a stylized look to the source image while preserving the source image's subject, content, composition, and framing.";
}
