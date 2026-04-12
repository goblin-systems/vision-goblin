import type { AiGuideMode } from "../types";
import type { AiMaskSessionResult } from "../aiMaskSession";

// ── Guide-driven inpainting prompt ──────────────────────────────────────

export function buildGuideDrivenInpaintingPrompt(guideMode: AiGuideMode, options: {
  intensity: number;
  lightDirection: AiMaskSessionResult["lightDirection"];
}): string {
  switch (guideMode) {
    case "shadow-add": {
      const intensityDesc = options.intensity < 30 ? "subtle" : options.intensity < 70 ? "moderate" : "strong";
      const lightDesc = options.lightDirection === "auto"
        ? "Analyze the scene to determine the natural light source direction."
        : `The light source is coming from the ${options.lightDirection}.`;
      return `Add a realistic, ${intensityDesc} shadow only inside the black landing guide region. ${lightDesc} Use the dual-colour shadow guide image as approximate guidance for the scene: red marks the existing object casting the shadow, and black marks the approximate existing surface area where the shadow should land and darken the underlying pixels. Do not trace either painted guide as an exact contour. Instead, infer a natural shadow shape from the scene, object, surface, and light relationship, with believable perspective, contact, softness, blur, and falloff. Keep the shadow contained within the black guide region, but let the internal shape and edge treatment vary naturally rather than matching the painted shape exactly. The black region is not a new object and must not be rendered as a decal, cutout, silhouette, solid shape, or any other generated form. Do not invent any new objects or geometry anywhere in the image. Only darken existing content inside the black guide region, and keep all pixels outside that region unchanged. The generated shadow should be cast by objects already present in the scene and read as a believable shadow rather than a painted graphic or replacement form. Shadow intensity: ${options.intensity}%.`;
    }
    case "shadow-remove":
      return `Reduce or remove the existing cast shadow only inside the black guide region. Use the dual-colour shadow guide image as approximate guidance for the scene: black marks the existing shadow area to lighten or remove, and any red markings are optional extra context for nearby content that should remain intact. Do not depend on red markings being present. Do not trace the painted guide as an exact contour. Instead, infer a natural cleanup from the surrounding surface, texture, lighting, and occlusion context so the result remains believable. Reconstruct the underlying background naturally with matching texture, colour variation, noise, blur, and perspective. Do not alter, erase, distort, relight, or replace non-shadow content outside the black-marked area. The black guide is not a new object, decal, cutout, silhouette, filled shape, or painted patch. Do not invent any new objects or geometry anywhere in the image. Only edit pixels inside the black guide region, keep all pixels outside that region unchanged, and preserve overall scene realism. Shadow reduction strength: ${options.intensity}%.`;
    case "reflection-add":
      return "Add a realistic reflection or glare effect only inside the black guide region. Use the dual-colour guide image as approximate guidance for the scene: red marks the source object or bright cause of the reflection or glare, and black marks the target region where that reflection or glare should appear. Treat both guides as approximate semantic guidance rather than exact contours to trace. Infer a believable reflected or glared result from the scene geometry, material, viewing angle, lighting, blur, intensity, distortion, and falloff. The black region is not a new object, decal, cutout, silhouette, or filled shape to render literally. Do not invent unrelated objects or geometry anywhere in the image. Only modify existing content inside the black guide region, keep all pixels outside that region unchanged, and integrate the result naturally with the underlying surface or screen content.";
    case "reflection-remove":
      return "Reduce or remove the existing reflection or glare only inside the black guide region. Use the dual-colour guide image as approximate guidance for the scene: black marks the reflection or glare area to clean up, and any red markings are optional extra context for the likely source object or bright cause nearby. Do not depend on red markings being present. Treat the guides as approximate semantic guidance rather than exact contours to trace. Infer a natural cleanup from surrounding texture, colour, lighting, edges, and scene structure so the result remains believable. Reconstruct the underlying content naturally without leaving haze, bloom, streaks, mirrored residue, or bright artifacts behind. The black guide is not a new object, decal, cutout, silhouette, or filled patch. Do not invent unrelated objects or geometry anywhere in the image. Only edit pixels inside the black guide region and keep all pixels outside that region unchanged.";
    case "clone-object":
      return "Clone the red-marked source object into the black-marked destination region or regions in one pass. Keep the original red-marked object in place and preserve its identity. Multiple separate black destination islands may indicate multiple requested copies; create one natural-looking copy inside each meaningful black destination island as part of this single edit. Treat both guides as approximate semantic guidance rather than exact contours. Integrate every cloned copy naturally with the destination scene's perspective, scale, lighting, contact, edges, and occlusion. Do not erase, move, distort, or replace the original red-marked object. Do not create extra copies outside the black destination regions, and do not render the black guide itself as a literal filled shape, silhouette, decal, or patch.";
    case "move-object":
      return "Move the red-marked source object into the black-marked destination area. Preserve the identity of that exact object while relocating it. Remove the object from the original red source region, heal and reconstruct the revealed background naturally, and leave no duplicate, ghost, outline, residue, or partial remnant behind. Place exactly one instance of the same object inside the black destination region and integrate it believably with the destination scene's perspective, scale, lighting, contact, edges, and occlusion. Treat both guides as approximate semantic guidance rather than exact contours. Do not create multiple destination copies, do not keep the original object in place, and do not hallucinate new objects or unrelated scene content.";
    default:
      return "Apply the requested guide-driven inpainting edit while preserving the rest of the image exactly.";
  }
}

// ── Object removal prompts ──────────────────────────────────────────────

export const REMOVE_OBJECT_DEFAULT_PROMPT = "Remove the selected distraction and reconstruct the background.";

export function buildRemoveObjectPrompt(objectDescription: string): string {
  return `Remove the ${objectDescription} and reconstruct the background naturally.`;
}

// ── Background description ──────────────────────────────────────────────

export const DEFAULT_BACKGROUND_DESCRIPTION = "soft studio backdrop";

// ── Raster text cleanup ─────────────────────────────────────────────────

export const RASTER_TEXT_CLEANUP_PROMPT = "Remove the rasterized text inside the selected region and reconstruct the underlying background cleanly. Do not add any new text, icons, or decorative elements.";

// ── Thumbnail text overlay ──────────────────────────────────────────────

export function buildThumbnailTextOverlayPrompt(basePrompt: string, textOverlay: string, textPosition: string): string {
  return `${basePrompt}. Include the text "${textOverlay}" positioned at the ${textPosition} of the image.`;
}
