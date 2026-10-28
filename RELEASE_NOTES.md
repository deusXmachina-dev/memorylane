# MemoryLane v1.5.14-alpha.2

Smaller daily database uploads and a simpler remote sync setting.

## What's Changed

- **Daily upload sends only new data**: the database upload now sends only what changed since the last upload, not the whole database.
- **Remote sync is on/off**: the Off/Summary/Detailed level becomes one switch. Users who had Summary are moved to on, which also sends OCR text.
- **Purge and import clear server data**: purging or importing a database also deletes this device's data on the server.
- **Task-mining failures shown on the Patterns page** (#317).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.13...v1.5.14-alpha.2
