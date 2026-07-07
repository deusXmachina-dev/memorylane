# MemoryLane v1.4.0-alpha.4

Alpha preview of v1.4.0. The Windows customer installer no longer requires admin rights.

## What's Changed

- **Windows per-user installer**: the customer setup is now one-click and installs to the user profile — install and auto-updates run without admin rights (#213).
- Copyright updated to SenseFlow, Inc.

## Known Issues & Limitations

- Existing per-machine Windows installs (v1.4.0-alpha.3 and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0-alpha.3...v1.4.0-alpha.4
