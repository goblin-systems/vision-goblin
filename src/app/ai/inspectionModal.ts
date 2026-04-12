import { applyIcons, openModal } from "@goblin-systems/goblin-design-system";
import type { AiArtifact } from "./types";
import type { AiJobInspectionData, AiInspectionAssetSnapshot } from "./inspection";

let modalCounter = 0;

export function openAiJobInspectionModal(title: string, inspection: AiJobInspectionData, artifacts: AiArtifact[] = []): void {
  const id = `ai-job-inspection-${++modalCounter}`;
  const backdrop = document.createElement("div");
  backdrop.id = id;
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = buildModalMarkup(title, inspection, artifacts);
  document.body.appendChild(backdrop);
  applyIcons();
  openModal({
    backdrop,
    onReject: () => backdrop.remove(),
    onAccept: () => backdrop.remove(),
  });
}

function buildModalMarkup(title: string, inspection: AiJobInspectionData, artifacts: AiArtifact[]): string {
  return `<div class="modal-card modal-card--wide ai-inspection-modal-card">
    <div class="modal-header">
      <h3>${escapeHtml(title)}</h3>
      <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
        <i data-lucide="x"></i>
      </button>
    </div>
    <div class="modal-body ai-inspection-modal-body">
      ${buildModelSection(inspection)}
      ${buildPromptSection(inspection)}
      ${buildAssetsSection("Sent assets", inspection.request?.assets ?? [])}
      ${buildArtifactsSection(artifacts)}
      ${buildResponseSection(inspection)}
    </div>
    <div class="modal-footer">
      <button class="secondary-btn modal-btn-accept">Close</button>
    </div>
  </div>`;
}

function buildModelSection(inspection: AiJobInspectionData): string {
  const provider = inspection.providerId ?? "Unknown";
  const model = inspection.model ?? "Unknown";
  return buildSection(
    "Execution",
    `<dl class="ai-inspection-meta"><div><dt>Provider</dt><dd>${escapeHtml(provider)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div></dl>`,
  );
}

function buildPromptSection(inspection: AiJobInspectionData): string {
  const prompt = inspection.request?.prompt ?? inspection.task.prompt ?? "No prompt captured.";
  return buildSection("Prompt", `<pre class="ai-inspection-code">${escapeHtml(prompt)}</pre>`);
}

function buildAssetsSection(title: string, assets: AiInspectionAssetSnapshot[]): string {
  if (assets.length === 0) {
    return buildSection(title, `<div class="ai-inspection-empty">None</div>`);
  }
  return buildSection(title, `<div class="ai-inspection-asset-grid">${assets.map((asset) => buildPreviewCard(asset.label, asset.data, asset.kind, asset.width, asset.height)).join("")}</div>`);
}

function buildArtifactsSection(artifacts: AiArtifact[]): string {
  const previews = artifacts.flatMap((artifact) => {
    if (artifact.kind === "image") {
      return [buildPreviewCard(artifact.purpose ?? "returned image", artifact.data, "image", artifact.width, artifact.height)];
    }
    if (artifact.kind === "mask") {
      return [buildPreviewCard(artifact.label ?? "returned mask", artifact.data, "mask", artifact.width, artifact.height)];
    }
    return [];
  });
  return buildSection("Received artifacts", previews.length > 0 ? `<div class="ai-inspection-asset-grid">${previews.join("")}</div>` : `<div class="ai-inspection-empty">None</div>`);
}

function buildResponseSection(inspection: AiJobInspectionData): string {
  const returnedContent = inspection.response?.returnedContent;
  const rawPayload = inspection.response?.rawPayload;
  return buildSection(
    "Raw provider response",
    `${returnedContent ? `<pre class="ai-inspection-code">${escapeHtml(returnedContent)}</pre>` : ""}${rawPayload === undefined ? `<div class="ai-inspection-empty">No raw payload captured.</div>` : `<pre class="ai-inspection-code">${escapeHtml(JSON.stringify(rawPayload, null, 2))}</pre>`}`,
  );
}

function buildSection(title: string, body: string): string {
  return `<section class="ai-inspection-section"><h4>${escapeHtml(title)}</h4>${body}</section>`;
}

function buildPreviewCard(label: string, data: string, kind: "image" | "mask", width?: number, height?: number): string {
  const dimensions = width && height ? `${width}×${height}` : "unknown size";
  return `<figure class="ai-inspection-preview-card">
    <img src="${escapeAttr(data)}" alt="${escapeAttr(label)}" class="ai-inspection-preview ${kind === "mask" ? "is-mask" : ""}" />
    <figcaption><strong>${escapeHtml(label)}</strong><span>${escapeHtml(dimensions)}</span></figcaption>
  </figure>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}
