# MemoryLane v1.5.1-alpha.1

Alpha prerelease. Enterprise installs survive silent MDM/RMM update pushes on both platforms, and one app identity (site domain or app name) is used across the UI.

## What's Changed

- **macOS enterprise pkg self-heals**: preinstall quits the running app before the bundle swap; postinstall installs a machine-level LaunchAgent that relaunches the app at login and after unclean exits, so MDM-pushed updates no longer leave the app stopped.
- **Windows installer pushes no longer break the install**: the app-watcher sidecar exits when the main process dies, so RMM/MSI pushes can replace files immediately instead of deferring to reboot and leaving a broken install.
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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.0...v1.5.1-alpha.1
