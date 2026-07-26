# MemoryLane v1.5.3

Managed model configuration is now strict and deterministic, and task miner sweeps run on a stable poll interval with clearer diagnostics.

## What's Changed

- **Managed model config**: Managed slots now fall back to baked vendor presets and take models strictly from remote config. Deterministic startup without idle machinery or first-fetch retry backoff (#250).
- **Task miner sweep polling**: Mining sweeps run on a configurable poll interval instead of being driven by capture triggers. Failed sweeps retry on an internal backoff timer (#251).
- **Task miner diagnostics**: Idle reasons now appear in packaged logs, making stalled mining easier to diagnose (#253).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.2...v1.5.3
