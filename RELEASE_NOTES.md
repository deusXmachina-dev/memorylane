# MemoryLane v1.5.0-alpha.3

Alpha prerelease. Task miner becomes the only analysis engine, every pattern gets recipe steps, and managed installs receive model updates remotely.

## What's Changed

- **Task miner cutover**: the legacy pattern detector is fully removed; the task miner is now the only analyzer. Installs that still ran the old detector start a fresh ~60-day backfill on first launch (existing data is kept).
- **Recipe steps everywhere**: every pattern now carries step-by-step recipe lines (app, domain, intent) in the Build AI agent prompt. Existing clusters are re-mined once to gain steps (#235).
- **Remote model config**: managed installs poll the backend for model picks, so degraded or repriced models can be swapped without an app update. BYOK and custom-endpoint installs keep full model control (#233).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.0-alpha.2...v1.5.0-alpha.3
