# MemoryLane v1.5.11-alpha.2

Electron 44 and dependency updates, smaller installers.

## What's Changed

- **Electron 44**: upgraded Electron, Node 24, transformers 4 and other dependencies; npm audit fixes.
- **Requires macOS 13+**: macOS 12 no longer receives updates.
- **Smaller installers**: only the current platform's ML runtime is bundled.
- **Import dialog opens in Documents**, where exports are saved.
- **Links open in the system browser** (#296).
- **Fewer false app switches**: title changes of only symbols are ignored (#297).

## Known Issues & Limitations

- Postal addresses are not scrubbed — no reliable pattern separates them from ordinary navigation paths and page text.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.11-alpha.1...v1.5.11-alpha.2
