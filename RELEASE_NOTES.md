# MemoryLane v1.5.13

Dock icon fix and more reliable eval recordings.

## What's Changed

- **Dock icon while the window is open**: on macOS, MemoryLane shows in the Dock while its main window is open and hides again when it closes (#310).
- **Eval goldens keep every activity**: each pipeline activity stays in the golden; the step target goes to its longest block, and extra activities keep their live summary (#314).
- **Recording guide no longer splits steps**: clicking the guide during a recording no longer counts as switching apps (#314).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.12...v1.5.13
