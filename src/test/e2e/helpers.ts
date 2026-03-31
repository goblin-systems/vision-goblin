/// <reference types="node" />

import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { AiImageAsset, AiMaskAsset } from "../../app/ai/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = resolve(__dirname, "..", "samples");

/**
 * Reads a PNG file from `src/test/samples/` and returns it as an `AiImageAsset`
 * with a `data:image/png;base64,...` data URL.
 */
export function loadSampleImage(filename: string): AiImageAsset {
  const filePath = resolve(SAMPLES_DIR, filename);
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString("base64");
  return {
    kind: "image",
    mimeType: "image/png",
    data: `data:image/png;base64,${base64}`,
  };
}

/**
 * Creates an `AiMaskAsset` by reusing a sample photo file.
 *
 * Any valid image works as a mask — the provider just needs a valid image.
 * Using an existing sample avoids needing canvas or a PNG encoder in Node.js.
 */
export function loadSampleMask(): AiMaskAsset {
  const filePath = resolve(SAMPLES_DIR, "sample_photo_2.png");
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString("base64");
  return {
    kind: "mask",
    mimeType: "image/png",
    data: `data:image/png;base64,${base64}`,
  };
}

/**
 * Returns the value of the given environment variable, or throws if it is
 * not set. Use inside `describe.skipIf` blocks so the throw only fires
 * when the suite is actually meant to run.
 */
export function requireEnvKey(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`Required environment variable ${envVar} is not set.`);
  }
  return value;
}
