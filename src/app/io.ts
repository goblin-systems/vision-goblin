import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { VisionSettings } from "../settings";
import type { DocumentState, SerializedDocument } from "../editor/types";
import { compositeDocumentToBlob, deserializeDocument, serializeDocument } from "../editor/documents";
import { fileNameFromPath } from "../editor/utils";

export const supportedImageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

export type IoController = ReturnType<typeof createIoController>;

export function createIoController() {
  return {
    async openImageDialog() {
      return open({ multiple: false, filters: [{ name: "Images", extensions: supportedImageExtensions }] });
    },
    async openProjectDialog() {
      return open({ multiple: false, filters: [{ name: "Vision Goblin Project", extensions: ["vgob"] }] });
    },
    async readBinary(path: string) {
      return readFile(path);
    },
    async loadProject(path: string) {
      const bytes = await readFile(path);
      const json = new TextDecoder().decode(bytes);
      return deserializeDocument(JSON.parse(json) as SerializedDocument, path, false);
    },
    async saveExport(doc: DocumentState, settings: VisionSettings) {
      const format = settings.exportFormat;
      const outputPath = await save({
        defaultPath: `${doc.name}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!outputPath) return null;
      const blob = await compositeDocumentToBlob(doc, format, settings.exportQuality / 100);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeFile(outputPath, bytes);
      return outputPath;
    },
    async saveProject(doc: DocumentState, saveAs = false) {
      const targetPath = !saveAs ? doc.projectPath : null;
      let outputPath = targetPath;
      if (!outputPath) {
        outputPath = await save({
          defaultPath: `${doc.name}.vgob`,
          filters: [{ name: "Vision Goblin Project", extensions: ["vgob"] }],
        });
      }
      if (!outputPath) return null;
      const payload = serializeDocument(doc);
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      await writeFile(outputPath, encoded);
      return outputPath;
    },
    fileNameFromPath,
  };
}
