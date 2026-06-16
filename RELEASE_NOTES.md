# MemoryLane v1.2.0-alpha.3

Alpha preview. Builds on alpha.2 with an enterprise sync fix and more internal eval tooling.

> This is a prerelease for manual install only. Stable installs will not auto-update to it.

## What's Changed

- **Enterprise DB upload reliability**: enterprise database uploads now run on a regular catch-up schedule, so a missed window is retried rather than skipped (#171).
- **Internal (Developer mode)**: a Tasks tab in the in-app eval tooling builds task-mining goldens from real detected sightings — hidden behind Developer mode and inert otherwise (#172).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.2.0-alpha.2...v1.2.0-alpha.3
