# MemoryLane v1.5.4-alpha.2

Recurring tasks now reliably get a happy path, and LLM request timeouts are configurable for slow local endpoints.

## What's Changed

- **Configurable LLM timeouts**: Two sliders under Advanced options bound the long-running model calls — activity summaries (up to 60 min) and task mining (default 20 min). Local endpoints that spend minutes on prompt processing no longer time out mid-request (#263).
- **Reliable task recipes**: The cluster review is split into a small structure call (merges/splits) and batched content rounds that are the sole writer of labels and steps. Oversized reviews no longer time out and discard the whole pass, and labeled tasks that were left without steps get them on the next pass (#262).
- **Legacy tables removed**: The old pattern tables are dropped from the database, which also removes them from enterprise uploads (#262).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.4-alpha.1...v1.5.4-alpha.2
