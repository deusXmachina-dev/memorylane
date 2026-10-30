# Memorylane v1.5.14-alpha.1

Windows capture fixes: no more freeze on pause, fewer capture gaps.

## What's Changed

- **Pause no longer freezes the window on Windows**: frame cleanup no longer blocks the app when a file is briefly locked (#319).
- **Faster resume**: capture no longer waits for frames that can't arrive while paused (#319).
- **Current app is picked up right away**: capture and observation mode see the window already in front when they start, on the right monitor (#319).
- **Google Maps URLs captured on Windows** (#319).
- **Notepad typing stays one activity**: Windows 11 Notepad retitling an unsaved tab as you type no longer splits it per keystroke (#319).
- **Eval recordings keep the first app** (#319).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.13...v1.5.14-alpha.1
