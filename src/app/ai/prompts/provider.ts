import type {
  AiEnhancementTask,
  AiGenerationTask,
  AiGuideMode,
  AiImageArtifact,
  AiImageAsset,
  AiSegmentationTask,
} from "../types";

// ── Caption prompt ──────────────────────────────────────────────────────

export function defaultCaptionPrompt(detail?: "brief" | "detailed"): string {
  return detail === "brief" ? "Write a brief caption for this image." : "Describe this image in detail.";
}

// ── Segmentation prompt ─────────────────────────────────────────────────

export function defaultSegmentationUserPrompt(): string {
  return "Generate the segmentation mask for this image.";
}

export function buildSegmentationSystemPrompt(
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

// ── Size guidance ───────────────────────────────────────────────────────

export function buildSizeGuidance(
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

// ── Reference / target helpers ──────────────────────────────────────────

export function getReferenceSourceSize(referenceImages?: AiImageAsset[]): { width: number; height: number } | undefined {
  const firstReference = referenceImages?.[0];
  if (!firstReference?.width || !firstReference?.height) {
    return undefined;
  }
  return {
    width: firstReference.width,
    height: firstReference.height,
  };
}

export function getEnhancementTargetSize(task: AiEnhancementTask): { width?: number; height?: number } {
  const width = task.input.image.width;
  const height = task.input.image.height;
  if (task.options?.operation === "upscale" && width && height) {
    const factor = task.options.scaleFactor ?? 2;
    return { width: width * factor, height: height * factor };
  }
  return { width, height };
}

export function enhancementPurpose(
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

// ── Generation prompt ───────────────────────────────────────────────────

export function buildGenerationPrompt(task: AiGenerationTask): string {
  const sourceSize = getReferenceSourceSize(task.input?.referenceImages);
  return `${task.prompt}${buildSizeGuidance(sourceSize?.width, sourceSize?.height, task.options?.width, task.options?.height, (task.input?.referenceImages?.length ?? 0) > 0)}`;
}

// ── Guide semantics prompt ──────────────────────────────────────────────

export function buildGuideSemanticsPrompt(guideMode: AiGuideMode | undefined): string {
  switch (guideMode) {
    case "shadow-add":
      return " You will also receive a dual-colour shadow guide image. In that guide, red pixels mark the existing object casting the shadow and black pixels mark the approximate existing surface region where the shadow should fall. Treat both coloured guides as approximate guides, not exact contours to trace. Infer the correct shadow relationship from the scene, object, surface, and lighting context, with believable perspective, contact, softness, blur, and falloff, rather than copying the painted shapes literally. Treat black guide pixels only as a surface constraint for darkening underlying image content during shadow-related edits. They are not a new object, decal, cutout, silhouette, filled shape, or any other form to generate. Do not invent new geometry or solid forms in black-marked areas.";
    case "shadow-remove":
      return " You will also receive a dual-colour shadow guide image. In that guide, black pixels mark the approximate existing shadow region to clean up, lighten, or remove. Red pixels, if present, are only optional extra context for nearby content that should remain intact; do not depend on red pixels being present. Treat the painted guides as approximate guides, not exact contours to trace. Infer a natural cleanup from the surrounding surface, texture, lighting, and occlusion context so the result remains believable. Treat black guide pixels only as the editable shadow-removal region. They are not a new object, decal, cutout, silhouette, filled shape, or any other form to generate. Do not invent new geometry or solid forms in black-marked areas.";
    case "reflection-add":
      return " You will also receive a dual-colour reflection guide image. In that guide, red pixels mark the source object or bright cause of the reflection or glare, and black pixels mark the approximate target region where the reflection or glare should appear. Treat both coloured guides as approximate semantic guides, not exact contours to trace. Infer a believable reflection or glare relationship from the scene geometry, materials, viewing angle, lighting, blur, distortion, and falloff rather than copying the painted shapes literally. Treat black guide pixels only as the editable target region for integrating reflected or glared image content. They are not a new object, decal, cutout, silhouette, filled shape, or any other form to generate. Do not invent new geometry or solid forms in black-marked areas.";
    case "reflection-remove":
      return " You will also receive a dual-colour reflection guide image. In that guide, black pixels mark the approximate reflection or glare region to clean up, lighten, or remove. Red pixels, if present, are only optional extra context for the likely source object or bright cause nearby; do not depend on red pixels being present. Treat the painted guides as approximate semantic guides, not exact contours to trace. Infer a natural cleanup from the surrounding texture, colour, lighting, perspective, and scene structure so the result remains believable. Treat black guide pixels only as the editable reflection-removal region. They are not a new object, decal, cutout, silhouette, filled shape, or any other form to generate. Do not invent new geometry or solid forms in black-marked areas.";
    case "clone-object":
      return " You will also receive a dual-colour object guide image. In that guide, red pixels mark the source object to clone and black pixels mark the destination region where the cloned object should appear. There may be multiple separate black destination islands in a single guide image; treat that as one request to create one natural copy inside each meaningful black destination island in a single pass. Treat both coloured guides as approximate semantic guides, not exact contours to trace. Preserve the original object's identity while adapting placement, scale, orientation, edges, lighting, and contact naturally to each destination scene context. Keep the original red-marked object in place and do not modify or erase it. The black region is a placement hint, not a literal filled shape to render, and you must not create extra copies outside the black-marked destination regions.";
    case "move-object":
      return " You will also receive a dual-colour object guide image. In that guide, red pixels mark the source object to move and black pixels mark the destination region where the moved object should appear. Treat both coloured guides as approximate semantic guides, not exact contours to trace. Preserve the identity of that exact object while relocating it. Remove the object from the red-marked source area, reconstruct and heal the revealed background plausibly, and leave no duplicate, ghost, outline, residue, or partial remnant behind. Place exactly one instance of the same object inside the black destination region and integrate it naturally with the destination scene's perspective, scale, edges, lighting, contact, and occlusion. The black region is a placement hint, not a literal filled shape to render, and you must not hallucinate unrelated new objects or create multiple destination copies.";
    default:
      return "";
  }
}

// ── Inpainting prompt contract ──────────────────────────────────────────

export function buildInpaintingPromptContract(args: {
  guideMode?: AiGuideMode;
  image: AiImageAsset;
}): { systemPrompt: string; inputOrder: string } {
  const sizeGuidance = buildSizeGuidance(
    args.image.width,
    args.image.height,
    args.image.width,
    args.image.height,
    true,
  );

  if (args.guideMode) {
    return {
      systemPrompt: "You are an image editing assistant. You will receive a source image and a colour-coded guide mask." +
        buildGuideSemanticsPrompt(args.guideMode) +
        " Only modify pixels inside the guide-constrained editable region implied by the task, and preserve all other pixels exactly. Output only the edited image." +
        sizeGuidance,
      inputOrder: "Input order: 1) source image, 2) colour-coded guide mask.",
    };
  }

  return {
    systemPrompt: "You are an image editing assistant. You will receive a source image and a binary edit mask image." +
      " The binary mask shows the region to edit: black pixels mark the area to modify, white pixels mark the area to keep unchanged. Generate a new version of the source image where only the masked region is modified according to the user's prompt. Preserve the unmasked areas exactly. Output only the edited image." +
      sizeGuidance,
    inputOrder: "Input order: 1) source image, 2) binary edit mask.",
  };
}

// ── Enhancement prompt contract ─────────────────────────────────────────

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

// ── Enhancement prompt internals (not exported) ─────────────────────────

function buildEnhancementGlobalSystemInstruction(): string {
  return "You are an in-context image editor enhancement assistant. Output only the edited image.";
}

function buildEnhancementToolWorkflowInstruction(options: BuildEnhancementPromptContractOptions): string {
  const { sourceImage, targetSize, buildSizeGuidance: sizeFn } = options;
  return `${buildOperationWorkflowInstruction(options)}${sizeFn(sourceImage.width, sourceImage.height, targetSize.width, targetSize.height, true)}`;
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
