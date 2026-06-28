# MemoryLane v1.3.0

Centrally-managed exclusions for enterprise, plus more debuggable logging and a more reliable daily upload.

## What's Changed

- **Centrally-synced capture blacklist (enterprise)**: IT can push a managed app/URL exclusion list that's enforced on every device alongside the user's own list. Org-set entries appear in a read-only locked block and update live when the policy changes; they can't be removed locally (#193, #195).
- **More debuggable logging**: bigger log files (10 MB) so several hours of history survive rotation, a quieter `info` level, and capture of previously-unlogged crashes and stats-file errors. Enterprise devices can sync logs to the backend automatically (change-gated, throttled) or on demand via **Sync logs now** for support bundles (#196).
- **Reliable daily database upload (enterprise)**: the managed database upload now runs exactly once per active calendar day via an hourly idempotent poll that survives sleep and clock drift, closing a rare double-upload race (#192).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.2.1...v1.3.0
