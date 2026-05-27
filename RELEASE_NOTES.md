# MemoryLane v0.26.2

Adds the ability to import a previously exported database, replacing the active one.

## What's Changed

- Import Database: replace the active database with a previously exported one (`.zip` or raw `.db`). Useful for migrating a Customer-edition database into an Enterprise install — schema, embedding model, and vector dimensions match across editions. The app validates the file, stages it, and restarts to finish importing; a timestamped backup of the current database is saved automatically. Screenshot/video files aren't part of an export, so imported activities keep summaries/OCR/search/patterns but not their original images.

## Known Issues & Limitations

- Importing a database does not restore the original screenshot/video files; only the activity data is imported.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page (auto-update enabled).
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.26.1...v0.26.2
</content>
</invoke>
