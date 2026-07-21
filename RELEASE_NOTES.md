# MemoryLane v1.5.0

Stable release. The task miner replaces the legacy pattern detector as the only analysis engine, patterns get a redesigned UI with step-by-step recipes, and managed installs receive model updates remotely.

## What's Changed

- **Task miner is now the only analyzer**: the legacy pattern detector is fully removed. Installs that still ran the old detector start a fresh ~60-day backfill on first launch (existing data is kept). Mining runs on a per-day ledger with a unified sweep and progress banner (#221).
- **Patterns-first UI**: redesigned patterns view with honest metrics and a weekly trend, refreshed with the shadcn design preset (#227, #229).
- **Recipe steps everywhere**: every pattern carries LLM-generated, sanitized step-by-step recipe lines (app, domain, intent) in the Build AI agent prompt (#228, #235).
- **Remote model config**: managed installs poll the backend for model picks, so degraded or repriced models can be swapped without an app update. BYOK and custom-endpoint installs keep full model control (#233).
- **MCP serves clusters**: the pattern tools (`list_patterns`, `get_pattern_details`) now read task-mining clusters (#226).
- **Fixes**: actionable messages for network failures during activation (#222), recorder no longer crashes on daemon stdin write errors (#220), frame/video deletes retry on transient Windows file locks (#219).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0...v1.5.0
