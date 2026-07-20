# MemoryLane v1.5.0-alpha.2

Alpha prerelease. Patterns-first UI with honest metrics, sanitized AI agent recipes, and a refreshed design.

## What's Changed

- **Patterns-first UI**: Patterns is now the default landing screen. Cards and details show hands-on time plus an estimated monthly figure, and a new chart tracks the last 4 weeks of sightings (#227).
- **Build AI agent recipe**: patterns now carry a generalized, de-identified step-by-step recipe generated at mining time; the "Build AI agent" button copies it, sanitized (#228).
- **Refreshed design**: new theme across the app (#229).
- **Accurate mining progress**: the progress banner reports the current sweep instead of lifetime totals (#229).

## Known Issues & Limitations

- Existing per-machine Windows installs (v1.3.x and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.0-alpha.1...v1.5.0-alpha.2
