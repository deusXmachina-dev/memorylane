# MemoryLane v1.2.0-alpha.2

Alpha preview. Builds on alpha.1 with reworked task mining and internal eval tooling.

> This is a prerelease for manual install only. Stable installs will not auto-update to it.

## What's Changed

- **More reliable task mining**: recurring-task detection now treats individual sightings as the source of truth and derives clusters from them, so patterns stay consistent as new sessions are recorded (#168).
- **Sidebar fix**: the logo is now hidden when the sidebar is collapsed (#166).
- **Internal (Developer mode)**: an in-app eval recorder captures a real session and turns it into a replay fixture for tuning activity summaries — hidden behind Developer mode and inert otherwise (#167, #169, #170).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.2.0-alpha.1...v1.2.0-alpha.2
