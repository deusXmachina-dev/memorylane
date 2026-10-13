# MemoryLane v1.5.11-alpha.4

Main-process cleanup, faster quit, better reading-time windows.

## What's Changed

- **Reading time ends at your last input**: the presence heartbeat is replaced by an idle-aware window close, so windows no longer stretch past when you stopped reading (#303).
- **Faster quit**: the last activity's summary is given 3s at shutdown instead of blocking exit.
- **Periodic export folder removed**: the manual ZIP export stays; a stale folder setting is ignored.
- **Main-process wiring cleanup**: settings apply in one place, background sync has its own module, and the task miner stops cleanly at quit (#304).
- **Removed legacy migrations** for pre-v2 vendor credentials and pre-bundle-id excluded apps.

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.11-alpha.3...v1.5.11-alpha.4
