# MemoryLane v1.5.4-alpha.1

Task mining catches up much faster on first launch, and provider outages no longer stall a whole sweep.

## What's Changed

- **Parallel day mining**: When the mining ledger has a backlog, days are analyzed in waves instead of one at a time, so a first launch with weeks of history catches up far faster. Daily sweeps stay serial (#258).
- **Per-day retry cooldown**: A day that fails now cools down on its own (10m, then 20m) while the sweep moves on to the next day. Only repeated consecutive failures pause the sweep (#257).
- **Longer mining request deadline**: Mining calls get 20 minutes; other LLM calls drop to 3 minutes so they fail fast instead of hanging (#258).
- **Clearer mining status**: The banner reads "Waiting to retry" while days are cooling down instead of "Analysis paused" (#257).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.3...v1.5.4-alpha.1
