# MemoryLane v1.5.11-alpha.5

Cleaner screen-capture shutdown on macOS.

## What's Changed

- **Clean capture stop on macOS**: the screenshot stream stops before the capture helper exits, quit no longer waits on it, and a stuck helper is force-closed after 0.5s (#305).
- **Sync cleanup**: background sync owns its backend connection and access refresh (#306).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.11-alpha.4...v1.5.11-alpha.5
