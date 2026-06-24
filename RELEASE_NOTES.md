# MemoryLane v1.2.1

Patch release fixing macOS Screen Recording onboarding.

## What's Changed

- **Screen Recording onboarding fix**: during onboarding the Grant button now triggers a throwaway capture so macOS lists MemoryLane in the Screen Recording panel and shows the native consent prompt; repeat grants open System Settings so a previously-denied user can still enable it (#191).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.2.0...v1.2.1
