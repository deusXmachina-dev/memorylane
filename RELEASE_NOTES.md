# MemoryLane v1.5.1-alpha.2

Alpha prerelease. Enterprise installs survive silent MDM/RMM update pushes on both platforms, and one app identity (site domain or app name) is used across the UI.

## What's Changed

- **Windows enterprise MSI upgrades**: silent installer pushes stop the running app before replacing files and relaunch it in the user's session when the install finishes — no watchdog, and quitting from the tray keeps the app stopped (#247).
- **macOS enterprise**: the app starts at login and relaunches after crashes or external kills; a tray Quit stays quit.
- Helper processes exit with the app, so installer pushes no longer defer file replacement to reboot.
- **One app identity**: patterns and activities use the site domain (or app name) as a single app concept across the UI, digest, and prompts (#239).
- **Open in Claude**: the "Analyze with Claude" button is now "Open in Claude" with two paths — build a MemoryLane plugin skill or run an analysis (#240, #242).
- **Fix**: LLM requests that hang without a response are aborted instead of stalling the pipeline (#238).

## Known Issues & Limitations

- Existing per-machine Windows installs (v1.3.x and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.0...v1.5.1-alpha.2
