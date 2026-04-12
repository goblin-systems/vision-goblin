# Global Color Picker

- Canonical IDs: `D21`
- Legacy feature IDs: `F1.32`
- Status: done
- Summary or outcome: global colour picking now samples from a virtual-desktop capture overlay while keeping the floating HUD workflow intact.

## Shipped scope

- Preserved the floating picker HUD and cursor-adjacent lens inside the dedicated capture overlay window.
- Switched global colour picking to the shared virtual-desktop capture pipeline for multi-monitor and mixed-DPI coverage.
- Improved permission-denied and capture-failed UX with clearer user-facing guidance.
- Screenshot-based sampling remains the shipped approach; live sampling is no longer required for this backlog item.

## Acceptance Criteria

- Off-canvas color picking remains reliable and immediately usable in paint workflows.

## Related

- Shipped baseline: `backlog/done/epic-d005-native-desktop-utilities.md`
- Done index: `backlog/index-done.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
