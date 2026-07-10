# MemoryLane v1.4.0

Stable release. The Patterns experience is unchanged by default; a new task miner is available as an opt-in developer preview.

## What's Changed

- **New task miner (opt-in)**: an experimental sighting-clustering analyzer with a clusters view. It's **off by default** — the familiar pattern detector remains the default experience. Enable "New task miner" in Developer → Tasks and restart to try it (#217).
- **Video model defaults GA**: promoted GA video model defaults, applied once as a versioned override of earlier local picks (#207, #216).
- **Windows install**: one-click per-user installer (no admin needed), and the x64 VC++ runtime is now bundled so on-device inference loads on clean machines.
- **Steadier LLM connectivity**: provider health is checked reactively instead of probing on window focus (DEU-176).
- App version is now reported to the backend for support and diagnostics (#206).

## Known Issues & Limitations

- MCP pattern tools (`list_patterns`, `get_pattern_details`) read the legacy pattern data and won't reflect the new clusters when the miner is opted into.
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

https://github.com/deusXmachina-dev/memorylane/compare/v1.3.1...v1.4.0
