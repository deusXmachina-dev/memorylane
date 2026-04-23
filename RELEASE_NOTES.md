# MemoryLane v0.23.6

Claude Desktop integration fix for Windows MSIX installs.

## What's Changed

- **Claude Desktop integration on Windows MSIX**: fresh MSIX-packaged Claude Desktop reads its config from a virtualized sandbox under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\` instead of `%APPDATA%\Claude\`. MemoryLane now discovers every `Claude_*` package and dual-writes, so the tray "Connect to Claude Desktop" button actually shows up in Claude's server list. Users upgraded from an earlier MemoryLane will see a "Reconnect" prompt that backfills the MSIX path.

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS customer (Apple Silicon): install from the latest GitHub release or via the project install script
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.23.5...v0.23.6
