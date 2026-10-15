# MemoryLane v1.5.12

Scripted eval recordings now follow what is on screen instead of a timer.

## What's Changed

- **Steps advance from the foreground window**: the recording guide moves to the next step when you switch to its app or site, with no countdown; hands-off steps keep their timer (#309).
- **Fixtures clip to the script**: frames and activities before step 1 and after the return to MemoryLane are dropped, so goldens align with the steps; detours are marked as strays and never fail the check (#309).
- **Scenario lint on import only**: a saved library with back-to-back same-app steps still loads (#309).
- Internal: runtime UI-refresh signal renamed (#308).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.11...v1.5.12
