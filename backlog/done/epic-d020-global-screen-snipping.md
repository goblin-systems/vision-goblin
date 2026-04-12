# Global Screen Snipping

- Canonical IDs: `D20`
- Legacy feature IDs: `F1.31`
- Status: done
- Summary or outcome: virtual-desktop snipping now captures across multi-monitor and mixed-DPI layouts with clearer recovery guidance when capture fails.

## Shipped scope

- Replaced the remaining primary-monitor path with a shared virtual-desktop capture pipeline.
- Moved snip interaction into a dedicated capture overlay window sized to the full virtual desktop.
- Hardened permission-denied and capture-failed messaging so recovery steps are clearer.

## Acceptance Criteria

- Capture behaves reliably across common single-monitor, multi-monitor, and mixed-DPI setups.

## Related

- Shipped baseline: `backlog/done/epic-d005-native-desktop-utilities.md`
- Done index: `backlog/index-done.md`
- Shared requirements: `backlog/epic-r001-cross-cutting-product-requirements.md`
