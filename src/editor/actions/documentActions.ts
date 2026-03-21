import { pushHistory } from "../history";
import type { DocumentState, RasterLayer } from "../types";
import { blobToImage, cloneDocument, createBlankDocument, createDocumentFromBlob, createLayerCanvas, getLayerContext, snapshotDocument, syncLayerSource } from "../documents";
import { nextId, stripExtension } from "../utils";

export function makeNewDocument(
  name: string,
  width: number,
  height: number,
  defaultZoom: number,
  background: DocumentState["background"] = "white"
): DocumentState {
  const doc = createBlankDocument(name, width, height, defaultZoom, background);
  doc.dirty = true;
  return doc;
}

export function duplicateDocument(doc: DocumentState): DocumentState {
  return cloneDocument(doc);
}

export async function importDocumentFromBlob(name: string, blob: Blob, sourcePath: string | null, defaultZoom: number) {
  return createDocumentFromBlob(name, blob, sourcePath, defaultZoom);
}

export async function addBlobAsLayer(doc: DocumentState, name: string, blob: Blob): Promise<RasterLayer> {
  const image = await blobToImage(blob);
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const layer: RasterLayer = {
    id: nextId("layer"),
    name: stripExtension(name) || `Layer ${doc.layers.length}`,
    canvas: createLayerCanvas(doc.width, doc.height),
    x: Math.round((doc.width - image.naturalWidth) / 2),
    y: Math.round((doc.height - image.naturalHeight) / 2),
    visible: true,
    opacity: 1,
    locked: false,
  };
  getLayerContext(layer).drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
  syncLayerSource(layer);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Pasted ${layer.name} as new layer`);
  return layer;
}
