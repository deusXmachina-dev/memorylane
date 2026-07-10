# MemoryLane v1.4.0-alpha.7

Alpha preview of v1.4.0. This build ships the new task miner as opt-in and sharpens task naming.

## What's Changed

- **Legacy pattern detector by default**: the new task miner + clusters view is now behind a Developer toggle (default off), so a shipped release shows the familiar pattern detector. Enable "New task miner" in Developer → Tasks and restart to opt in (#217).
- **Sharper task names**: clusters use canonical titles, a dedicated subject field, and a known-procedures vocabulary so recurring tasks read consistently (#215).
- **Video model defaults GA**: promoted GA video model defaults, applied once as a versioned override of earlier local picks (#216).

## Known Issues & Limitations

- MCP pattern tools (`list_patterns`, `get_pattern_details`) read the legacy pattern data and won't reflect the new clusters when the miner is opted into.
- Existing per-machine Windows installs (v1.4.0-alpha.3 and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0-alpha.6...v1.4.0-alpha.7
