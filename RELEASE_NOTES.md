# MemoryLane v1.2.0-alpha.4

Alpha preview. Builds on alpha.3 with a UI fix and improved internal eval review tooling.

> This is a prerelease for manual install only. Stable installs will not auto-update to it.

## What's Changed

- **Sidebar layout**: removed the layout jitter when collapsing the sidebar (#173).
- **Internal (Developer mode)**: eval fixture review now has a seekable video, a two-column layout, and a captured interaction-events timeline beside golden.md — hidden behind Developer mode and inert otherwise (#174).

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.2.0-alpha.3...v1.2.0-alpha.4
