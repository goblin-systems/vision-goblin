import { applyStructuredTextReconstruction, type StructuredTextReconstructionBlock } from "../../../editor/textReconstruction";
import type { DocumentState, RasterLayer } from "../../../editor/types";
import type { AiImageArtifact, AiImageAsset, AiInpaintingTask, AiMaskAsset, AiTextReplacementTask } from "../types";
import { buildInpaintingTask, buildTextReplacementTask, getImageArtifact, getJsonArtifact } from "../editingSupport";
import { RASTER_TEXT_CLEANUP_PROMPT, buildStructuredTextReconstructionPrompt } from "../prompts";
import { parseStructuredTextReconstructionJson } from "./schema";
import type { AiTaskSuccess } from "../contracts";

export interface CombinedTextReplacementRunResult {
  ok: boolean;
  cleanedImageArtifact?: AiImageArtifact;
  blocks?: StructuredTextReconstructionBlock[];
  warnings: string[];
  error?: string;
}

export interface TwoStageTextReplacementDeps {
  runTask: (title: string, request: { task: AiInpaintingTask | AiTextReplacementTask }) => Promise<AiTaskSuccess | null>;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

export async function runTwoStageTextReplacement(
  deps: TwoStageTextReplacementDeps,
  imageAsset: AiImageAsset,
  maskAsset: AiMaskAsset,
): Promise<CombinedTextReplacementRunResult> {
  const warnings: string[] = [];

  // Stage 1: Inpainting — remove text and reconstruct background
  const inpaintingResponse = await deps.runTask("AI replace raster text (inpainting)", {
    task: buildInpaintingTask(imageAsset, maskAsset, RASTER_TEXT_CLEANUP_PROMPT, "remove"),
  });
  if (!inpaintingResponse) {
    return { ok: false, warnings, error: "AI inpainting stage failed." };
  }
  warnings.push(...inpaintingResponse.warnings);

  const imageArtifact = getImageArtifact(inpaintingResponse);
  if (!imageArtifact) {
    return { ok: false, warnings, error: "AI inpainting returned no cleaned image." };
  }

  // Stage 2: Text reconstruction — extract structured text as JSON
  const reconstructionResponse = await deps.runTask("AI replace raster text (text reconstruction)", {
    task: buildTextReplacementTask(imageAsset, maskAsset, buildStructuredTextReconstructionPrompt()),
  });
  if (!reconstructionResponse) {
    return { ok: false, warnings, error: "AI text reconstruction stage failed." };
  }
  warnings.push(...reconstructionResponse.warnings);

  const jsonArtifact = getJsonArtifact(reconstructionResponse, "text-reconstruction");
  if (!jsonArtifact) {
    return { ok: false, warnings, error: "AI text reconstruction returned no structured JSON artifact." };
  }

  const parsed = parseStructuredTextReconstructionJson(jsonArtifact.text);
  if (!parsed.ok) {
    warnings.push(...parsed.warnings);
    return { ok: false, warnings, error: parsed.error };
  }

  warnings.push(...parsed.warnings);
  return {
    ok: true,
    cleanedImageArtifact: imageArtifact,
    blocks: parsed.blocks,
    warnings,
  };
}

export function applyStructuredTextReconstructionResult(
  doc: DocumentState,
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  blocks: StructuredTextReconstructionBlock[],
  historyLabel: string,
) {
  return applyStructuredTextReconstruction(doc, layer, cleanedCanvas, blocks, historyLabel);
}
