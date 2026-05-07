# MemoryLane v0.26.1-beta.1

Prerelease covering internal refactors to URL handling, settings validation, and the release workflow. No user-facing feature changes.

## What's Changed

- Tightened how custom vendor `baseURL` values and backend-returned URLs are validated.
- Stricter validation of the database export directory (must be absolute and inside an allowed location).
- Customer checkout and subscription portal now open via short-lived signed URLs minted from the backend.
- Release workflow resolves the input ref to an immutable commit SHA once and reuses it across every job; all GitHub Actions are pinned to commit SHAs and tracked by Dependabot.

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page (auto-update enabled).
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.26.0...v0.26.1-beta.1
