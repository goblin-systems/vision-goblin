import { DEFAULT_GRADIENT_HEADING_DEGREES, gradientStopsToNodes, type GradientConfig } from "./gradient";
import type { GradientStop, GradientType } from "./types";

export interface BuiltInGradientPreset {
  id: string;
  label: string;
  gradientType: GradientType;
  headingDegrees?: number;
  centerX?: number;
  centerY?: number;
  stops: GradientStop[];
}

export const BUILT_IN_GRADIENT_PRESETS: BuiltInGradientPreset[] = [
  {
    id: "sunset-pop",
    label: "Sunset Pop",
    gradientType: "linear",
    headingDegrees: 24,
    stops: [
      { offset: 0, color: "#FF6B6B" },
      { offset: 0.52, color: "#FFD166" },
      { offset: 1, color: "#6C63FF" },
    ],
  },
  {
    id: "ocean-depth",
    label: "Ocean Depth",
    gradientType: "linear",
    headingDegrees: 90,
    stops: [
      { offset: 0, color: "#081C3A" },
      { offset: 0.5, color: "#0E7490" },
      { offset: 1, color: "#CFFAFE" },
    ],
  },
  {
    id: "mono-fade",
    label: "Mono Fade",
    gradientType: "linear",
    headingDegrees: 0,
    stops: [
      { offset: 0, color: "#111827" },
      { offset: 1, color: "#F9FAFB" },
    ],
  },
  {
    id: "spotlight",
    label: "Spotlight",
    gradientType: "radial",
    centerX: 0.5,
    centerY: 0.5,
    stops: [
      { offset: 0, color: "#FFF6CC" },
      { offset: 0.45, color: "#FFCF70" },
      { offset: 1, color: "#2B2D42" },
    ],
  },
  {
    id: "neon-core",
    label: "Neon Core",
    gradientType: "radial",
    centerX: 0.35,
    centerY: 0.42,
    stops: [
      { offset: 0, color: "#FDF2F8" },
      { offset: 0.32, color: "#F72585" },
      { offset: 1, color: "#140152" },
    ],
  },
  {
    id: "mint-glow",
    label: "Mint Glow",
    gradientType: "radial",
    centerX: 0.62,
    centerY: 0.35,
    stops: [
      { offset: 0, color: "#ECFDF5" },
      { offset: 0.38, color: "#6EE7B7" },
      { offset: 1, color: "#064E3B" },
    ],
  },
];

export function createGradientConfigFromPreset(presetId: string): GradientConfig | null {
  const preset = BUILT_IN_GRADIENT_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    return null;
  }
  return {
    gradientType: preset.gradientType,
    nodes: gradientStopsToNodes(preset.stops),
    headingDegrees: preset.headingDegrees ?? DEFAULT_GRADIENT_HEADING_DEGREES,
    centerX: preset.centerX ?? 0.5,
    centerY: preset.centerY ?? 0.5,
  };
}
