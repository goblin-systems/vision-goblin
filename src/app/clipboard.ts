import type { DocumentState } from "../editor/types";
import { renderDocumentClipboardBlob } from "../editor/documents";

export async function copyDocumentToClipboard(doc: DocumentState): Promise<boolean> {
  try {
    const blob = await renderDocumentClipboardBlob(doc);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
