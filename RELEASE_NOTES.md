# MemoryLane v1.5.0-alpha.1

Alpha prerelease. Task-mining reliability and integration improvements, plus stability fixes.

## What's Changed

- **MCP tools use clusters**: the pattern tools (`list_patterns`, `get_pattern_details`) now serve task-mining clusters instead of legacy pattern data (#226).
- **Per-day mining ledger**: mining runs day by day with a unified sweep (bootstrap, daily, and gap-fill), transactional day commits, and a progress banner in the UI (#221).
- **Clearer activation errors**: network failures during activation now show actionable messages (#222).
- **Stability**: daemon write errors no longer crash the app (#220); frame/video deletion retries on transient Windows file locks (#219).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0...v1.5.0-alpha.1
