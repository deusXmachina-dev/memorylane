# MemoryLane v1.1.0

In-app updates and friendlier custom-endpoint setup, on top of the 1.0 transparency-first foundation.

## What's Changed

- **In-app updates**: when a new version finishes downloading, a "Relaunch to update" banner appears in the sidebar so you can apply it in one click — no need to quit and reopen (#154).
- **Settings**: custom model `baseURL` now accepts `http://` for private/LAN addresses, so you can point MemoryLane at a self-hosted endpoint on your own network (#153).
- **Plugin**: pruned and renamed the MemoryLane Claude Code skills (9 → 6) and bumped the plugin to v0.6.1 (#151).
- **Docs**: added a "Using Your Own Models" guide for running MemoryLane against a self-hosted or third-party model endpoint (#155).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.0.0...v1.1.0
